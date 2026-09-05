// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  path.join(__dirname, '../../../migrations/0156_platform_credit_ledger.sql'),
  'utf8',
);
const migrationStatements = migrationSql
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter(Boolean);

const createMigratedClient = async () => {
  const client = new PGlite();
  await client.exec('CREATE TABLE users (id text PRIMARY KEY)');
  for (const statement of migrationStatements) await client.exec(statement);
  return client;
};

describe('platform credit ledger migration', () => {
  it('creates the ledger tables with their database constraints and indexes', async () => {
    const client = await createMigratedClient();

    try {
      const tables = await client.query<{ tablename: string }>(`
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('platform_credit_accounts', 'platform_credit_entries')
        ORDER BY tablename
      `);
      expect(tables.rows.map(({ tablename }) => tablename)).toEqual([
        'platform_credit_accounts',
        'platform_credit_entries',
      ]);

      const constraints = await client.query<{ conname: string }>(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid IN (
          'public.platform_credit_accounts'::regclass,
          'public.platform_credit_entries'::regclass
        )
      `);
      expect(constraints.rows.map(({ conname }) => conname)).toEqual(
        expect.arrayContaining([
          'platform_credit_accounts_balance_non_negative',
          'platform_credit_accounts_user_id_users_id_fk',
          'platform_credit_entries_account_id_platform_credit_accounts_id_',
          'platform_credit_entries_amount_matches_type',
          'platform_credit_entries_balance_non_negative',
          'platform_credit_entries_reason_non_empty',
          'platform_credit_entries_reversal_of_entry_id_platform_credit_en',
          'platform_credit_entries_type_valid',
          'platform_credit_entries_usage_metadata_complete',
          'platform_credit_entries_user_id_users_id_fk',
        ]),
      );

      const indexes = await client.query<{ indexname: string }>(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename IN ('platform_credit_accounts', 'platform_credit_entries')
      `);
      expect(indexes.rows.map(({ indexname }) => indexname)).toEqual(
        expect.arrayContaining([
          'platform_credit_accounts_user_id_idx',
          'platform_credit_accounts_user_snapshot_unique',
          'platform_credit_entries_account_idempotency_unique',
          'platform_credit_entries_actor_created_at_idx',
          'platform_credit_entries_generation_idx',
          'platform_credit_entries_reversal_once_unique',
          'platform_credit_entries_type_created_at_idx',
          'platform_credit_entries_user_created_at_idx',
        ]),
      );
    } finally {
      await client.close();
    }
  });

  it('keeps account and entry snapshots after the referenced user is deleted', async () => {
    const client = await createMigratedClient();

    try {
      await client.exec(`
        INSERT INTO users (id) VALUES ('deleted-customer');
        INSERT INTO platform_credit_accounts (
          id, user_id, user_id_snapshot, balance_credits
        ) VALUES (
          '00000000-0000-4000-8000-000000000101',
          'deleted-customer',
          'deleted-customer',
          500
        );
        INSERT INTO platform_credit_entries (
          id,
          account_id,
          user_id,
          user_id_snapshot,
          actor_user_id,
          actor_user_id_snapshot,
          operator_user_id,
          type,
          amount_credits,
          balance_after_credits,
          reason,
          idempotency_key
        ) VALUES (
          '00000000-0000-4000-8000-000000000102',
          '00000000-0000-4000-8000-000000000101',
          'deleted-customer',
          'deleted-customer',
          'deleted-customer',
          'deleted-customer',
          'deleted-customer',
          'top_up',
          500,
          500,
          '已核对的历史充值',
          'deleted-customer-top-up'
        );
        DELETE FROM users WHERE id = 'deleted-customer';
      `);

      const accounts = await client.query<{
        balance_credits: number;
        user_id: null | string;
        user_id_snapshot: string;
      }>('SELECT balance_credits, user_id, user_id_snapshot FROM platform_credit_accounts');
      expect(accounts.rows).toEqual([
        { balance_credits: 500, user_id: null, user_id_snapshot: 'deleted-customer' },
      ]);

      const entries = await client.query<{
        actor_user_id: null | string;
        actor_user_id_snapshot: string;
        operator_user_id: null | string;
        user_id: null | string;
        user_id_snapshot: string;
      }>(`
        SELECT
          actor_user_id,
          actor_user_id_snapshot,
          operator_user_id,
          user_id,
          user_id_snapshot
        FROM platform_credit_entries
      `);
      expect(entries.rows).toEqual([
        {
          actor_user_id: null,
          actor_user_id_snapshot: 'deleted-customer',
          operator_user_id: null,
          user_id: null,
          user_id_snapshot: 'deleted-customer',
        },
      ]);
    } finally {
      await client.close();
    }
  });

  it('rejects negative account and entry balances at the database boundary', async () => {
    const client = await createMigratedClient();

    try {
      await client.exec("INSERT INTO users (id) VALUES ('credit-customer')");

      await expect(
        client.exec(`
          INSERT INTO platform_credit_accounts (
            id, user_id, user_id_snapshot, balance_credits
          ) VALUES (
            '00000000-0000-4000-8000-000000000103',
            'credit-customer',
            'credit-customer-negative',
            -1
          )
        `),
      ).rejects.toThrow(/platform_credit_accounts_balance_non_negative/);

      await client.exec(`
        INSERT INTO platform_credit_accounts (
          id, user_id, user_id_snapshot, balance_credits
        ) VALUES (
          '00000000-0000-4000-8000-000000000104',
          'credit-customer',
          'credit-customer',
          0
        )
      `);
      await expect(
        client.exec(`
          INSERT INTO platform_credit_entries (
            account_id,
            user_id,
            user_id_snapshot,
            actor_user_id_snapshot,
            type,
            amount_credits,
            balance_after_credits,
            reason,
            idempotency_key,
            provider,
            model,
            generation_id,
            token_usage,
            cost_usd
          ) VALUES (
            '00000000-0000-4000-8000-000000000104',
            'credit-customer',
            'credit-customer',
            'credit-customer',
            'usage_charge',
            0,
            -1,
            '不应通过的负余额',
            'negative-balance-entry',
            'deepseek',
            'deepseek-chat',
            'generation-negative-balance',
            '{"input": 1, "output": 1}'::jsonb,
            0
          )
        `),
      ).rejects.toThrow(/platform_credit_entries_balance_non_negative/);
    } finally {
      await client.close();
    }
  });
});
