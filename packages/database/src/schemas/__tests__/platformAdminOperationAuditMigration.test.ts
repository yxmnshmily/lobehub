// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const initialMigrationPath = path.join(
  __dirname,
  '../../../migrations/0158_platform_admin_operation_audit.sql',
);
const actionMigrationPath = path.join(
  __dirname,
  '../../../migrations/0160_platform_admin_travel_group_repair_audit.sql',
);

const createMigratedClient = async () => {
  const client = new PGlite();
  for (const migrationPath of [initialMigrationPath, actionMigrationPath]) {
    const statements = readFileSync(migrationPath, 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) await client.exec(statement);
  }
  return client;
};

describe('platform administrator operation audit migration', () => {
  it('creates the dedicated append-only migration', () => {
    expect(existsSync(initialMigrationPath)).toBe(true);
    expect(existsSync(actionMigrationPath)).toBe(true);
  });

  it('stores only the fixed audit envelope with action, phase, and time constraints', async () => {
    const client = await createMigratedClient();

    try {
      const columns = await client.query<{ column_name: string }>(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'platform_admin_operation_audits'
        ORDER BY ordinal_position
      `);
      expect(columns.rows.map(({ column_name }) => column_name)).toEqual([
        'id',
        'operator_user_id',
        'target_user_id',
        'operation_id',
        'action',
        'phase',
        'occurred_at',
      ]);

      const constraints = await client.query<{ conname: string }>(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.platform_admin_operation_audits'::regclass
      `);
      expect(constraints.rows.map(({ conname }) => conname)).toEqual(
        expect.arrayContaining([
          'platform_admin_operation_audits_action_valid',
          'platform_admin_operation_audits_operation_id_non_empty',
          'platform_admin_operation_audits_operator_user_id_non_empty',
          'platform_admin_operation_audits_phase_valid',
          'platform_admin_operation_audits_target_user_id_non_empty',
        ]),
      );
    } finally {
      await client.close();
    }
  }, 15_000);

  it('deduplicates each operation phase and rejects mutation or unsupported values', async () => {
    const client = await createMigratedClient();

    try {
      const insert = (action: string, phase: string) =>
        client.exec(`
          INSERT INTO platform_admin_operation_audits (
            operator_user_id, target_user_id, operation_id, action, phase
          ) VALUES ('admin-1', 'target-1', 'operation-1', '${action}', '${phase}')
        `);

      await insert('user.profile_updated', 'requested');
      await insert('user.sessions_revoked', 'requested');
      await insert('user.travel_group_repaired', 'requested');
      await expect(insert('user.profile_updated', 'requested')).rejects.toThrow(
        /platform_admin_operation_audits_operation_action_phase_unique/,
      );
      await expect(insert('user.email_body_captured', 'succeeded')).rejects.toThrow(
        /platform_admin_operation_audits_action_valid/,
      );
      await expect(insert('user.profile_updated', 'unknown')).rejects.toThrow(
        /platform_admin_operation_audits_phase_valid/,
      );
      await expect(
        client.exec(`UPDATE platform_admin_operation_audits SET phase = 'succeeded'`),
      ).rejects.toThrow(/append-only/);
      await expect(client.exec(`DELETE FROM platform_admin_operation_audits`)).rejects.toThrow(
        /append-only/,
      );
    } finally {
      await client.close();
    }
  }, 15_000);
});
