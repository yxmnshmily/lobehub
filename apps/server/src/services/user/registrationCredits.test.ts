// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { LobeChatDatabase } from '@lobechat/database';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { platformCreditRouter } from '@/server/routers/lambda/platformCredit';

import { getRegistrationCredits, grantRegistrationCredits } from './registrationCredits';

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: (opts: any) => opts.next({ ctx: opts.ctx }),
}));

const { PGlite } = createRequire(path.resolve(process.cwd(), 'packages/database/package.json'))(
  '@electric-sql/pglite',
);

let client: InstanceType<typeof PGlite>;
let db: LobeChatDatabase;

beforeEach(async () => {
  client = new PGlite();
  await client.exec(`CREATE TABLE users (id text PRIMARY KEY, created_at timestamptz NOT NULL, banned boolean DEFAULT false);
    INSERT INTO users (id, created_at) VALUES ('new-user', '2026-09-07T00:00:00Z'), ('old-user', '2026-09-01T00:00:00Z');`);
  const migration = readFileSync(
    path.resolve(process.cwd(), 'packages/database/migrations/0156_platform_credit_ledger.sql'),
    'utf8',
  );
  for (const statement of migration.split('--> statement-breakpoint').filter((s) => s.trim()))
    await client.exec(statement);
  db = drizzle(client) as unknown as LobeChatDatabase;
});
afterEach(async () => {
  await client.close();
});

it('only exposes the authenticated user gift and rejects caller-selected users', async () => {
  await grantRegistrationCredits(db, 'new-user');
  const caller = platformCreditRouter.createCaller({ serverDB: db, userId: 'old-user' } as any);
  expect(await caller.getOwnRegistrationCredits()).toEqual({
    remainingCredits: 0,
    totalCredits: 0,
  });
  await expect(
    caller.getOwnRegistrationCredits({ userId: 'new-user' } as never),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  await expect(
    platformCreditRouter.createCaller({ serverDB: db } as any).getOwnRegistrationCredits(),
  ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
});

it('tracks remaining gift credits through usage and refunds without counting recharges', async () => {
  await grantRegistrationCredits(db, 'new-user');
  expect(await getRegistrationCredits(db, 'new-user')).toEqual({
    remainingCredits: 5_000_000,
    totalCredits: 5_000_000,
  });
  await client.exec(`INSERT INTO platform_credit_entries
    (account_id, user_id_snapshot, type, amount_credits, balance_after_credits, reason, idempotency_key, actor_user_id_snapshot, provider, model, generation_id, token_usage, cost_usd)
    SELECT id, 'new-user', 'usage_charge', -2000000, 3000000, 'usage', 'usage-1', 'new-user', 'test', 'test', 'test', '{}', 2 FROM platform_credit_accounts;
    UPDATE platform_credit_accounts SET balance_credits = 3000000;`);
  expect(await getRegistrationCredits(db, 'new-user')).toEqual({
    remainingCredits: 3_000_000,
    totalCredits: 5_000_000,
  });
  await client.exec('UPDATE platform_credit_accounts SET balance_credits = 13000000');
  expect(await getRegistrationCredits(db, 'new-user')).toEqual({
    remainingCredits: 3_000_000,
    totalCredits: 5_000_000,
  });
  await client.exec(`INSERT INTO platform_credit_entries (account_id, user_id_snapshot, type, amount_credits, balance_after_credits, reason, idempotency_key, reversal_of_entry_id)
    SELECT account_id, 'new-user', 'reversal', 2000000, 15000000, 'refund', 'refund-1', id FROM platform_credit_entries WHERE idempotency_key = 'usage-1';
    UPDATE platform_credit_accounts SET balance_credits = 15000000;`);
  expect(await getRegistrationCredits(db, 'new-user')).toEqual({
    remainingCredits: 5_000_000,
    totalCredits: 5_000_000,
  });
  expect(await getRegistrationCredits(db, 'old-user')).toEqual({
    remainingCredits: 0,
    totalCredits: 0,
  });
});

it('grants a new account 5 million credits without a recharge, once under concurrent retries', async () => {
  await Promise.all(Array.from({ length: 5 }, () => grantRegistrationCredits(db, 'new-user')));
  expect((await client.query('SELECT balance_credits FROM platform_credit_accounts')).rows).toEqual(
    [{ balance_credits: 5_000_000 }],
  );
  expect(
    (
      await client.query(
        'SELECT amount_credits, type, operator_user_id FROM platform_credit_entries',
      )
    ).rows,
  ).toEqual([{ amount_credits: 5_000_000, type: 'adjustment', operator_user_id: null }]);
  await client.exec('UPDATE platform_credit_accounts SET balance_credits = 4000000');
  await grantRegistrationCredits(db, 'new-user');
  expect((await client.query('SELECT balance_credits FROM platform_credit_accounts')).rows).toEqual(
    [{ balance_credits: 4_000_000 }],
  );
});

it('does not backfill old users or credit missing/banned users', async () => {
  await grantRegistrationCredits(db, 'old-user');
  await grantRegistrationCredits(db, 'missing');
  await client.exec("UPDATE users SET banned = true WHERE id = 'new-user'");
  await grantRegistrationCredits(db, 'new-user');
  expect((await client.query('SELECT * FROM platform_credit_accounts')).rows).toEqual([]);
});

it('rolls back on invalid balance and can safely retry later', async () => {
  await client.exec(
    "INSERT INTO platform_credit_accounts (user_id, user_id_snapshot, balance_credits) VALUES ('new-user', 'new-user', 9007199254740991)",
  );
  await expect(grantRegistrationCredits(db, 'new-user')).rejects.toThrow();
  expect((await client.query('SELECT * FROM platform_credit_entries')).rows).toEqual([]);
  await client.exec('UPDATE platform_credit_accounts SET balance_credits = 12');
  await grantRegistrationCredits(db, 'new-user');
  expect((await client.query('SELECT balance_credits FROM platform_credit_accounts')).rows).toEqual(
    [{ balance_credits: 5_000_012 }],
  );
});
