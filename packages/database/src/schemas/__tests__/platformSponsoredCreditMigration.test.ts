// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = path.join(__dirname, '../../../migrations');
const creditLedgerMigrationPath = path.join(migrationsDirectory, '0156_platform_credit_ledger.sql');
const reservationMigrationPath = path.join(
  migrationsDirectory,
  '0161_platform_credit_reservations.sql',
);
const sponsoredMigrationPath = path.join(
  migrationsDirectory,
  '0162_platform_credit_sponsored_membership_purchase.sql',
);
const sponsoredSnapshotPath = path.join(migrationsDirectory, 'meta/0162_snapshot.json');
const previousSnapshotPath = path.join(migrationsDirectory, 'meta/0161_snapshot.json');
const journalPath = path.join(migrationsDirectory, 'meta/_journal.json');

const statementsFrom = (migrationPath: string) =>
  readFileSync(migrationPath, 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);

const applyMigration = async (client: PGlite, migrationPath: string) => {
  for (const statement of statementsFrom(migrationPath)) await client.exec(statement);
};

const create0161Client = async () => {
  const client = new PGlite();
  await client.exec(`
    CREATE TABLE users (id text PRIMARY KEY);
    CREATE TABLE chat_groups (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  await applyMigration(client, creditLedgerMigrationPath);
  await applyMigration(client, reservationMigrationPath);
  return client;
};

const seedLegacyBudget = async (client: PGlite) => {
  await client.exec(`
    INSERT INTO users (id) VALUES ('migration-owner'), ('migration-member');
    INSERT INTO chat_groups (id, user_id) VALUES ('migration-group', 'migration-owner');
    INSERT INTO platform_credit_accounts (
      id, user_id, user_id_snapshot, balance_credits
    ) VALUES (
      '00000000-0000-4000-8000-000000001621',
      'migration-owner',
      'migration-owner',
      1000
    );
    INSERT INTO platform_credit_budgets (
      id, account_id, user_id, user_id_snapshot, source_type, source_id,
      idempotency_key, request_hash, authorized_credits, status, expires_at
    ) VALUES (
      '00000000-0000-4000-8000-000000001622',
      '00000000-0000-4000-8000-000000001621',
      'migration-owner',
      'migration-owner',
      'agent-operation',
      'legacy-self-operation',
      'legacy-self-budget',
      'legacy-self-hash',
      400,
      'active',
      now() + interval '5 minutes'
    );
  `);
};

describe('platform sponsored Credits migration metadata', () => {
  it('appends 0162 after 0161 without replacing the previous snapshot', () => {
    expect(existsSync(sponsoredMigrationPath)).toBe(true);
    expect(existsSync(sponsoredSnapshotPath)).toBe(true);

    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries.at(-2)).toMatchObject({
      idx: 161,
      tag: '0161_platform_credit_reservations',
    });
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 162,
      tag: '0162_platform_credit_sponsored_membership_purchase',
    });

    const previousSnapshot = JSON.parse(readFileSync(previousSnapshotPath, 'utf8')) as {
      id: string;
    };
    const sponsoredSnapshot = JSON.parse(readFileSync(sponsoredSnapshotPath, 'utf8')) as {
      prevId: string;
    };
    expect(sponsoredSnapshot.prevId).toBe(previousSnapshot.id);
  });
});

describe.runIf(existsSync(sponsoredMigrationPath))('platform sponsored Credits migration', () => {
  it('fails before schema mutation when legacy budgets contain duplicate source identities', async () => {
    const client = await create0161Client();

    try {
      await seedLegacyBudget(client);
      await client.exec(`
        INSERT INTO platform_credit_budgets (
          id, account_id, user_id, user_id_snapshot, source_type, source_id,
          idempotency_key, request_hash, authorized_credits, status, expires_at
        ) VALUES (
          '00000000-0000-4000-8000-000000001625',
          '00000000-0000-4000-8000-000000001621',
          'migration-owner',
          'migration-owner',
          'agent-operation',
          'legacy-self-operation',
          'legacy-duplicate-budget',
          'legacy-duplicate-hash',
          100,
          'active',
          now() + interval '5 minutes'
        );
      `);

      await expect(applyMigration(client, sponsoredMigrationPath)).rejects.toThrow(
        /duplicate account source identities/,
      );
      const tables = await client.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'chat_group_user_memberships'
      `);
      expect(tables.rows).toEqual([{ count: 0 }]);
    } finally {
      await client.close();
    }
  }, 20_000);

  it('upgrades a populated 0161 budget to an immutable self-authorization snapshot', async () => {
    const client = await create0161Client();

    try {
      await seedLegacyBudget(client);
      await applyMigration(client, sponsoredMigrationPath);

      const budget = await client.query<{
        actor_user_id: string | null;
        actor_user_id_snapshot: string;
        authorization_kind: string;
        sponsor_chat_group_id_snapshot: string | null;
      }>(`
        SELECT actor_user_id, actor_user_id_snapshot, authorization_kind,
               sponsor_chat_group_id_snapshot
        FROM platform_credit_budgets
        WHERE id = '00000000-0000-4000-8000-000000001622'
      `);
      expect(budget.rows).toEqual([
        {
          actor_user_id: 'migration-owner',
          actor_user_id_snapshot: 'migration-owner',
          authorization_kind: 'self',
          sponsor_chat_group_id_snapshot: null,
        },
      ]);

      const tables = await client.query<{ tablename: string }>(`
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN (
            'chat_group_user_memberships',
            'chat_group_user_invitations',
            'chat_group_sponsored_credit_policies',
            'chat_group_sponsored_credit_audits',
            'platform_credit_purchase_orders',
            'platform_credit_payment_events'
          )
        ORDER BY tablename
      `);
      expect(tables.rows.map(({ tablename }) => tablename)).toEqual([
        'chat_group_sponsored_credit_audits',
        'chat_group_sponsored_credit_policies',
        'chat_group_user_invitations',
        'chat_group_user_memberships',
        'platform_credit_payment_events',
        'platform_credit_purchase_orders',
      ]);
    } finally {
      await client.close();
    }
  }, 20_000);

  it('accepts valid self and sponsored budgets but rejects malformed authorization snapshots', async () => {
    const client = await create0161Client();

    try {
      await seedLegacyBudget(client);
      await applyMigration(client, sponsoredMigrationPath);

      await client.exec(`
        INSERT INTO platform_credit_budgets (
          id, account_id, user_id, user_id_snapshot, actor_user_id,
          actor_user_id_snapshot, authorization_kind, source_type, source_id,
          idempotency_key, request_hash, authorized_credits, status, expires_at
        ) VALUES (
          '00000000-0000-4000-8000-000000001623',
          '00000000-0000-4000-8000-000000001621',
          'migration-owner',
          'migration-owner',
          'migration-owner',
          'migration-owner',
          'self',
          'agent-operation',
          'new-self-operation',
          'new-self-budget',
          'new-self-hash',
          100,
          'active',
          now() + interval '5 minutes'
        );
        INSERT INTO platform_credit_budgets (
          id, account_id, user_id, user_id_snapshot, actor_user_id,
          actor_user_id_snapshot, authorization_kind,
          sponsor_chat_group_id_snapshot, sponsor_policy_version_snapshot,
          sponsor_membership_version_snapshot, sponsor_period_started_at_snapshot,
          sponsor_period_ends_at_snapshot, sponsor_group_period_limit_credits_snapshot,
          sponsor_member_period_limit_credits_snapshot,
          sponsor_member_request_limit_credits_snapshot,
          source_type, source_id, idempotency_key, request_hash,
          authorized_credits, status, expires_at
        ) VALUES (
          '00000000-0000-4000-8000-000000001624',
          '00000000-0000-4000-8000-000000001621',
          'migration-owner',
          'migration-owner',
          'migration-member',
          'migration-member',
          'group_member_sponsored',
          'migration-group',
          1,
          1,
          now(),
          now() + interval '1 day',
          1000,
          500,
          100,
          'group-chat',
          'sponsored-operation',
          'sponsored-budget',
          'sponsored-hash',
          100,
          'active',
          now() + interval '5 minutes'
        );
      `);

      await expect(
        client.exec(`
          INSERT INTO platform_credit_budgets (
            account_id, user_id, user_id_snapshot, actor_user_id,
            actor_user_id_snapshot, authorization_kind, source_type, source_id,
            idempotency_key, request_hash, authorized_credits, status, expires_at
          ) VALUES (
            '00000000-0000-4000-8000-000000001621',
            'migration-owner',
            'migration-owner',
            'migration-member',
            'migration-member',
            'self',
            'agent-operation',
            'malformed-self-operation',
            'malformed-self-budget',
            'malformed-self-hash',
            100,
            'active',
            now() + interval '5 minutes'
          )
        `),
      ).rejects.toThrow(/platform_credit_budgets_authorization_snapshot_valid/);

      await expect(
        client.exec(`
          INSERT INTO platform_credit_budgets (
            account_id, user_id, user_id_snapshot, actor_user_id,
            actor_user_id_snapshot, authorization_kind,
            sponsor_chat_group_id_snapshot, sponsor_policy_version_snapshot,
            sponsor_membership_version_snapshot, sponsor_period_started_at_snapshot,
            sponsor_period_ends_at_snapshot, sponsor_group_period_limit_credits_snapshot,
            sponsor_member_period_limit_credits_snapshot,
            sponsor_member_request_limit_credits_snapshot,
            source_type, source_id, idempotency_key, request_hash,
            authorized_credits, status, expires_at
          ) VALUES (
            '00000000-0000-4000-8000-000000001621',
            'migration-owner',
            'migration-owner',
            'migration-owner',
            'migration-owner',
            'group_member_sponsored',
            'migration-group', 1, 1, now(), now() + interval '1 day',
            1000, 500, 100,
            'group-chat', 'malformed-sponsored-operation',
            'malformed-sponsored-budget', 'malformed-sponsored-hash',
            100, 'active', now() + interval '5 minutes'
          )
        `),
      ).rejects.toThrow(/platform_credit_budgets_authorization_snapshot_valid/);
    } finally {
      await client.close();
    }
  }, 20_000);

  it('applies the complete migration journal to a fresh database', async () => {
    const client = new PGlite({ extensions: { vector } });

    try {
      const migrations = readMigrationFiles({ migrationsFolder: migrationsDirectory });
      for (const migration of migrations) {
        const skipSql = migration.sql.some(
          (statement) =>
            statement.toLowerCase().includes('pg_search') ||
            statement.toLowerCase().includes('bm25'),
        );
        if (!skipSql) {
          for (const statement of migration.sql) await client.exec(statement);
        }
      }

      await client.exec(`
        INSERT INTO users (id, email) VALUES ('fresh-sponsored-owner', 'fresh@example.test');
        INSERT INTO platform_credit_accounts (user_id, user_id_snapshot)
        VALUES ('fresh-sponsored-owner', 'fresh-sponsored-owner');
      `);
      const result = await client.query<{ authorization_kind: string }>(
        'SELECT authorization_kind FROM platform_credit_budgets LIMIT 1',
      );
      expect(result.rows).toEqual([]);
    } finally {
      await client.close();
    }
  }, 60_000);
});
