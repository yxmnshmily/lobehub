// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = path.join(__dirname, '../../../migrations');
const baseMigrationPaths = [
  path.join(migrationsDirectory, '0156_platform_credit_ledger.sql'),
  path.join(migrationsDirectory, '0158_platform_admin_operation_audit.sql'),
  path.join(migrationsDirectory, '0160_platform_admin_travel_group_repair_audit.sql'),
];
const reservationMigrationPath = path.join(
  migrationsDirectory,
  '0161_platform_credit_reservations.sql',
);
const reservationSnapshotPath = path.join(migrationsDirectory, 'meta/0161_snapshot.json');
const previousSnapshotPath = path.join(migrationsDirectory, 'meta/0160_snapshot.json');
const journalPath = path.join(migrationsDirectory, 'meta/_journal.json');

const statementsFrom = (migrationPath: string) =>
  readFileSync(migrationPath, 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);

const applyMigration = async (client: PGlite, migrationPath: string) => {
  for (const statement of statementsFrom(migrationPath)) await client.exec(statement);
};

const createUpgradedClient = async () => {
  const client = new PGlite();
  await client.exec('CREATE TABLE users (id text PRIMARY KEY)');
  for (const migrationPath of baseMigrationPaths) await applyMigration(client, migrationPath);
  return client;
};

describe('platform credit reservation migration metadata', () => {
  it('appends migration 0161 after the existing 0160 snapshot without replacing it', () => {
    expect(existsSync(reservationMigrationPath)).toBe(true);
    expect(existsSync(reservationSnapshotPath)).toBe(true);

    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const previousIndex = journal.entries.findIndex(({ idx }) => idx === 160);
    const reservationIndex = journal.entries.findIndex(({ idx }) => idx === 161);
    expect(journal.entries[previousIndex]).toMatchObject({
      idx: 160,
      tag: '0160_platform_admin_travel_group_repair_audit',
    });
    expect(journal.entries[reservationIndex]).toMatchObject({
      idx: 161,
      tag: '0161_platform_credit_reservations',
    });
    expect(reservationIndex).toBe(previousIndex + 1);

    const previousSnapshot = JSON.parse(readFileSync(previousSnapshotPath, 'utf8')) as {
      id: string;
    };
    const reservationSnapshot = JSON.parse(readFileSync(reservationSnapshotPath, 'utf8')) as {
      prevId: string;
    };
    expect(reservationSnapshot.prevId).toBe(previousSnapshot.id);
  });
});

describe.runIf(existsSync(reservationMigrationPath))(
  'platform credit reservation migration',
  () => {
    it('initializes reservation storage on a fresh Credits schema', async () => {
      const client = await createUpgradedClient();

      try {
        await applyMigration(client, reservationMigrationPath);
        await client.exec(`
        INSERT INTO users (id) VALUES ('fresh-credit-user');
        INSERT INTO platform_credit_accounts (
          id, user_id, user_id_snapshot, balance_credits
        ) VALUES (
          '00000000-0000-4000-8000-000000001601',
          'fresh-credit-user',
          'fresh-credit-user',
          100
        );
        INSERT INTO platform_credit_budgets (
          id, account_id, user_id, user_id_snapshot, source_type, source_id,
          idempotency_key, request_hash, authorized_credits, status, expires_at
        ) VALUES (
          '00000000-0000-4000-8000-000000001602',
          '00000000-0000-4000-8000-000000001601',
          'fresh-credit-user',
          'fresh-credit-user',
          'agent-operation',
          'fresh-operation',
          'fresh-budget-key',
          'fresh-request-hash',
          50,
          'active',
          now() + interval '5 minutes'
        );
        INSERT INTO platform_credit_reservations (
          budget_id, account_id, generation_id, call_kind, provider, model,
          idempotency_key, reserved_credits, status, expires_at
        ) VALUES (
          '00000000-0000-4000-8000-000000001602',
          '00000000-0000-4000-8000-000000001601',
          'fresh-operation:step:0:call_llm',
          'call_llm',
          'provider',
          'model',
          'fresh-call-key',
          50,
          'reserved',
          now() + interval '1 minute'
        );
      `);

        const reservation = await client.query<{
          lease_version: number;
          settled_credits: number;
          status: string;
        }>(`
        SELECT lease_version, settled_credits, status
        FROM platform_credit_reservations
        WHERE idempotency_key = 'fresh-call-key'
      `);
        expect(reservation.rows).toEqual([
          { lease_version: 1, settled_credits: 0, status: 'reserved' },
        ]);
      } finally {
        await client.close();
      }
    }, 15_000);

    it('upgrades the 0160 schema with both reservation tables and preserves posted Credits', async () => {
      const client = await createUpgradedClient();

      try {
        await client.exec(`
        INSERT INTO users (id) VALUES ('existing-credit-user');
        INSERT INTO platform_credit_accounts (
          id, user_id, user_id_snapshot, balance_credits
        ) VALUES (
          '00000000-0000-4000-8000-000000001601',
          'existing-credit-user',
          'existing-credit-user',
          900
        );
        INSERT INTO platform_credit_entries (
          id, account_id, user_id, user_id_snapshot, type, amount_credits,
          balance_after_credits, reason, idempotency_key
        ) VALUES (
          '00000000-0000-4000-8000-000000001602',
          '00000000-0000-4000-8000-000000001601',
          'existing-credit-user',
          'existing-credit-user',
          'top_up',
          900,
          900,
          'existing top up',
          'existing-top-up'
        );
      `);

        await applyMigration(client, reservationMigrationPath);

        const tables = await client.query<{ tablename: string }>(`
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('platform_credit_budgets', 'platform_credit_reservations')
        ORDER BY tablename
      `);
        expect(tables.rows.map(({ tablename }) => tablename)).toEqual([
          'platform_credit_budgets',
          'platform_credit_reservations',
        ]);

        const posted = await client.query<{
          amount_credits: number;
          balance_after_credits: number;
          balance_credits: number;
        }>(`
        SELECT a.balance_credits, e.amount_credits, e.balance_after_credits
        FROM platform_credit_accounts a
        JOIN platform_credit_entries e ON e.account_id = a.id
        WHERE a.id = '00000000-0000-4000-8000-000000001601'
      `);
        expect(posted.rows).toEqual([
          { amount_credits: 900, balance_after_credits: 900, balance_credits: 900 },
        ]);

        const constraints = await client.query<{ conname: string }>(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid IN (
          'public.platform_credit_budgets'::regclass,
          'public.platform_credit_reservations'::regclass
        )
      `);
        expect(constraints.rows.map(({ conname }) => conname)).toEqual(
          expect.arrayContaining([
            'platform_credit_budgets_amounts_valid',
            'platform_credit_budgets_identity_non_empty',
            'platform_credit_budgets_lease_valid',
            'platform_credit_budgets_status_valid',
            'platform_credit_reservations_amounts_valid',
            'platform_credit_reservations_call_kind_valid',
            'platform_credit_reservations_completion_valid',
            'platform_credit_reservations_identity_non_empty',
            'platform_credit_reservations_lease_valid',
            'platform_credit_reservations_status_valid',
          ]),
        );

        const indexes = await client.query<{ indexname: string }>(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename IN ('platform_credit_budgets', 'platform_credit_reservations')
      `);
        expect(indexes.rows.map(({ indexname }) => indexname)).toEqual(
          expect.arrayContaining([
            'platform_credit_budgets_account_idempotency_unique',
            'platform_credit_budgets_account_status_idx',
            'platform_credit_budgets_status_expires_at_idx',
            'platform_credit_reservations_account_idempotency_unique',
            'platform_credit_reservations_budget_status_idx',
            'platform_credit_reservations_status_expires_at_idx',
            'platform_credit_reservations_usage_entry_unique',
          ]),
        );
      } finally {
        await client.close();
      }
    }, 15_000);

    it('enforces reservation identities, amounts, states, and foreign keys', async () => {
      const client = await createUpgradedClient();

      try {
        await applyMigration(client, reservationMigrationPath);
        await client.exec(`
        INSERT INTO users (id) VALUES ('reservation-user');
        INSERT INTO platform_credit_accounts (
          id, user_id, user_id_snapshot, balance_credits
        ) VALUES (
          '00000000-0000-4000-8000-000000001611',
          'reservation-user',
          'reservation-user',
          100
        );
        INSERT INTO platform_credit_budgets (
          id, account_id, user_id, user_id_snapshot, source_type, source_id,
          idempotency_key, request_hash, authorized_credits, status, expires_at
        ) VALUES (
          '00000000-0000-4000-8000-000000001612',
          '00000000-0000-4000-8000-000000001611',
          'reservation-user',
          'reservation-user',
          'agent-operation',
          'operation-1',
          'budget-key-1',
          'request-hash-1',
          80,
          'active',
          now() + interval '5 minutes'
        );
        INSERT INTO platform_credit_reservations (
          id, budget_id, account_id, generation_id, call_kind, provider, model,
          idempotency_key, reserved_credits, status, expires_at
        ) VALUES (
          '00000000-0000-4000-8000-000000001613',
          '00000000-0000-4000-8000-000000001612',
          '00000000-0000-4000-8000-000000001611',
          'operation-1:step:0:call_llm',
          'call_llm',
          'provider',
          'model',
          'call-key-1',
          80,
          'reserved',
          now() + interval '1 minute'
        );
      `);

        await expect(
          client.exec(`
          INSERT INTO platform_credit_budgets (
            account_id, user_id_snapshot, source_type, source_id, idempotency_key,
            request_hash, authorized_credits, status, expires_at
          ) VALUES (
            '00000000-0000-4000-8000-000000001611', 'reservation-user',
            'agent-operation', 'operation-2', 'budget-key-1', 'request-hash-2',
            20, 'active', now() + interval '5 minutes'
          )
        `),
        ).rejects.toThrow(/platform_credit_budgets_account_idempotency_unique/);
        await expect(
          client.exec(`
          INSERT INTO platform_credit_budgets (
            account_id, user_id_snapshot, source_type, source_id, idempotency_key,
            request_hash, authorized_credits, status, expires_at
          ) VALUES (
            '00000000-0000-4000-8000-000000001611', 'reservation-user',
            'agent-operation', 'operation-3', 'budget-key-3', 'request-hash-3',
            0, 'active', now() + interval '5 minutes'
          )
        `),
        ).rejects.toThrow(/platform_credit_budgets_amounts_valid/);
        await expect(
          client.exec(`
          INSERT INTO platform_credit_reservations (
            budget_id, account_id, generation_id, call_kind, provider, model,
            idempotency_key, reserved_credits, status, expires_at
          ) VALUES (
            '00000000-0000-4000-8000-000000001612',
            '00000000-0000-4000-8000-000000001611',
            'operation-1:step:1:unknown', 'unknown', 'provider', 'model',
            'call-key-2', 10, 'reserved', now() + interval '1 minute'
          )
        `),
        ).rejects.toThrow(/platform_credit_reservations_call_kind_valid/);
        await expect(
          client.exec(`
          UPDATE platform_credit_reservations
          SET status = 'provider_started'
          WHERE id = '00000000-0000-4000-8000-000000001613'
        `),
        ).resolves.toBeDefined();
        await expect(
          client.exec(`
          UPDATE platform_credit_reservations
          SET status = 'provider_completed'
          WHERE id = '00000000-0000-4000-8000-000000001613'
        `),
        ).rejects.toThrow(/platform_credit_reservations_completion_valid/);
        await expect(
          client.exec(`
          INSERT INTO platform_credit_reservations (
            budget_id, account_id, generation_id, call_kind, provider, model,
            idempotency_key, reserved_credits, status, expires_at
          ) VALUES (
            '00000000-0000-4000-8000-000000009999',
            '00000000-0000-4000-8000-000000001611',
            'operation-1:step:2:call_llm', 'call_llm', 'provider', 'model',
            'call-key-3', 10, 'reserved', now() + interval '1 minute'
          )
        `),
        ).rejects.toThrow(/platform_credit_reservations_budget_id_platform_credit_budgets/);
      } finally {
        await client.close();
      }
    }, 15_000);

    it('fails a direct duplicate SQL application without changing existing reservation data', async () => {
      const client = await createUpgradedClient();

      try {
        await applyMigration(client, reservationMigrationPath);
        await client.exec(`
        INSERT INTO users (id) VALUES ('rerun-user');
        INSERT INTO platform_credit_accounts (
          id, user_id, user_id_snapshot, balance_credits
        ) VALUES (
          '00000000-0000-4000-8000-000000001621',
          'rerun-user',
          'rerun-user',
          75
        );
      `);

        await expect(applyMigration(client, reservationMigrationPath)).rejects.toThrow(
          /platform_credit_budgets.*already exists/i,
        );
        const account = await client.query<{ balance_credits: number }>(`
        SELECT balance_credits
        FROM platform_credit_accounts
        WHERE id = '00000000-0000-4000-8000-000000001621'
      `);
        expect(account.rows).toEqual([{ balance_credits: 75 }]);
      } finally {
        await client.close();
      }
    }, 15_000);
  },
);
