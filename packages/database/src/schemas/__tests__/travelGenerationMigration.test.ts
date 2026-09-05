// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

describe('0159 travel generation idempotency migration', () => {
  it('upgrades many duplicate legacy rows with null idempotency metadata without conflicts', async () => {
    const client = new PGlite();
    try {
      await client.exec(`
        CREATE TABLE travel_generation_tasks (
          id text PRIMARY KEY,
          user_id text NOT NULL,
          workspace_id text,
          group_id text NOT NULL,
          type text NOT NULL
        );
        INSERT INTO travel_generation_tasks (id, user_id, workspace_id, group_id, type)
        SELECT 'legacy-' || value, 'legacy-user', NULL, 'legacy-group', 'image'
        FROM generate_series(1, 128) AS value;
      `);

      const migration = await readFile(
        path.join(__dirname, '../../../migrations/0159_travel_generation_idempotency.sql'),
        'utf8',
      );
      for (const statement of migration.split('--> statement-breakpoint')) {
        if (statement.trim()) await client.exec(statement);
      }

      const result = await client.query<{
        idempotency_count: number;
        legacy_count: number;
        request_hash_count: number;
      }>(`
        SELECT
          count(*)::int AS legacy_count,
          count(idempotency_key)::int AS idempotency_count,
          count(request_hash)::int AS request_hash_count
        FROM travel_generation_tasks;
      `);
      expect(result.rows).toEqual([
        { idempotency_count: 0, legacy_count: 128, request_hash_count: 0 },
      ]);

      const inserted = await client.exec(`
        INSERT INTO travel_generation_tasks (id, user_id, workspace_id, group_id, type)
        VALUES ('legacy-after-upgrade', 'legacy-user', NULL, 'legacy-group', 'image');
      `);
      expect(inserted[0]?.affectedRows).toBe(1);
    } finally {
      await client.close();
    }
  });
});
