// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  path.join(__dirname, '../../../migrations/0157_platform_moderation_audit.sql'),
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

describe('platform moderation audit migration', () => {
  it('creates the audit table with retention and data-minimisation constraints', async () => {
    const client = await createMigratedClient();

    try {
      const constraints = await client.query<{ conname: string }>(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.platform_moderation_audits'::regclass
      `);
      expect(constraints.rows.map(({ conname }) => conname)).toEqual(
        expect.arrayContaining([
          'platform_moderation_audits_categories_array',
          'platform_moderation_audits_disposition_valid',
          'platform_moderation_audits_disposition_metadata',
          'platform_moderation_audits_fingerprint_sha256',
          'platform_moderation_audits_preview_length',
          'platform_moderation_audits_source_type_valid',
          'platform_moderation_audits_user_id_users_id_fk',
          'platform_moderation_audits_verdict_valid',
        ]),
      );

      const indexes = await client.query<{ indexname: string }>(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'platform_moderation_audits'
      `);
      expect(indexes.rows.map(({ indexname }) => indexname)).toEqual(
        expect.arrayContaining([
          'platform_moderation_audits_disposition_detected_idx',
          'platform_moderation_audits_fingerprint_idx',
          'platform_moderation_audits_source_idx',
          'platform_moderation_audits_user_detected_idx',
          'platform_moderation_audits_verdict_detected_idx',
        ]),
      );
    } finally {
      await client.close();
    }
  });

  it('retains the user snapshot and redacted metadata after user deletion', async () => {
    const client = await createMigratedClient();

    try {
      await client.exec(`
        INSERT INTO users (id) VALUES ('deleted-customer');
        INSERT INTO platform_moderation_audits (
          id, user_id, user_id_snapshot, source_type, source_id, verdict, categories,
          fingerprint, redacted_preview
        ) VALUES (
          '00000000-0000-4000-8000-000000000201', 'deleted-customer', 'deleted-customer',
          'copy', 'copy-1', 'block', '[{"category":"credential","count":1,"severity":"critical"}]',
          '${'a'.repeat(64)}', 'OPENAI_[CREDENTIAL]'
        );
        DELETE FROM users WHERE id = 'deleted-customer';
      `);

      const result = await client.query<{
        redacted_preview: string;
        user_id: null | string;
        user_id_snapshot: string;
      }>('SELECT user_id, user_id_snapshot, redacted_preview FROM platform_moderation_audits');
      expect(result.rows).toEqual([
        {
          redacted_preview: 'OPENAI_[CREDENTIAL]',
          user_id: null,
          user_id_snapshot: 'deleted-customer',
        },
      ]);
    } finally {
      await client.close();
    }
  });

  it('rejects raw-sized previews, malformed fingerprints, and incomplete dispositions', async () => {
    const client = await createMigratedClient();

    try {
      const base = `
        INSERT INTO platform_moderation_audits (
          user_id_snapshot, source_type, source_id, verdict, categories, fingerprint, redacted_preview
        ) VALUES
      `;
      await expect(
        client.exec(
          `${base} ('u1', 'chat', 's1', 'review', '[]', '${'a'.repeat(64)}', '${'x'.repeat(241)}')`,
        ),
      ).rejects.toThrow(/platform_moderation_audits_preview_length/);
      await expect(
        client.exec(`${base} ('u1', 'chat', 's1', 'review', '[]', 'not-sha256', 'safe')`),
      ).rejects.toThrow(/platform_moderation_audits_fingerprint_sha256/);

      await client.exec(
        `${base} ('u1', 'chat', 's1', 'review', '[]', '${'b'.repeat(64)}', 'safe')`,
      );
      await expect(
        client.exec(`
          UPDATE platform_moderation_audits
          SET disposition = 'reviewed', disposed_at = NULL, operator_user_id = NULL
        `),
      ).rejects.toThrow(/platform_moderation_audits_disposition_metadata/);
    } finally {
      await client.close();
    }
  });
});
