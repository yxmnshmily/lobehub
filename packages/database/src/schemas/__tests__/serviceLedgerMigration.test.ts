// @vitest-environment node
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { describe, expect, it } from 'vitest';

const migrations = readMigrationFiles({
  migrationsFolder: path.join(__dirname, '../../../migrations'),
});
const ledgerMigration = migrations.find((migration) =>
  migration.sql.some((statement) => statement.includes('CREATE TABLE "travel_service_accounts"')),
);
const retentionMigration = migrations.find((migration) =>
  migration.sql.some((statement) =>
    statement.includes('travel_service_orders_account_idempotency_unique'),
  ),
);

if (!ledgerMigration || !retentionMigration) throw new Error('Travel service migrations not found');

const applyMigration = async (client: PGlite, statements: string[]) => {
  for (const statement of statements) await client.exec(statement);
};

describe('travel service ledger migrations', () => {
  it('backfills existing users and preserves their existing audit rows after deletion', async () => {
    const client = new PGlite();
    try {
      await client.exec(`
        CREATE TABLE users (id text PRIMARY KEY);
        INSERT INTO users (id) VALUES ('legacy-customer');
      `);
      await applyMigration(client, ledgerMigration.sql);

      const backfilled = await client.query<{ balance_fen: number; user_id: string }>(
        `SELECT balance_fen, user_id FROM travel_service_accounts WHERE user_id = 'legacy-customer'`,
      );
      expect(backfilled.rows).toEqual([{ balance_fen: 0, user_id: 'legacy-customer' }]);

      await client.exec(`
        DELETE FROM travel_service_accounts;
        INSERT INTO travel_service_accounts (id, user_id)
        VALUES ('00000000-0000-4000-8000-000000000001', 'legacy-customer');
        INSERT INTO travel_service_orders (
          id, account_id, user_id, title, amount_fen
        ) VALUES (
          '00000000-0000-4000-8000-000000000002',
          '00000000-0000-4000-8000-000000000001',
          'legacy-customer',
          '历史行程订单',
          8800
        );
        INSERT INTO travel_service_ledger_entries (
          id, account_id, user_id, type, amount_fen, balance_after_fen, reason, idempotency_key
        ) VALUES (
          '00000000-0000-4000-8000-000000000003',
          '00000000-0000-4000-8000-000000000001',
          'legacy-customer',
          'manual_adjustment',
          8800,
          8800,
          '历史线下收款',
          'legacy-adjustment'
        );
      `);

      await applyMigration(client, retentionMigration.sql);
      await client.exec(`DELETE FROM users WHERE id = 'legacy-customer'`);

      const accounts = await client.query<{
        user_id: null | string;
        user_id_snapshot: string;
      }>('SELECT user_id, user_id_snapshot FROM travel_service_accounts');
      const orders = await client.query<{ idempotency_key: string; user_id: null | string }>(
        'SELECT user_id, idempotency_key FROM travel_service_orders',
      );
      const entries = await client.query<{ reason: string; user_id: null | string }>(
        'SELECT user_id, reason FROM travel_service_ledger_entries',
      );

      expect(accounts.rows).toEqual([{ user_id: null, user_id_snapshot: 'legacy-customer' }]);
      expect(orders.rows).toEqual([
        {
          idempotency_key: 'legacy-order:00000000-0000-4000-8000-000000000002',
          user_id: null,
        },
      ]);
      expect(entries.rows).toEqual([{ reason: '历史线下收款', user_id: null }]);
    } finally {
      await client.close();
    }
  });
});
