// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = path.join(__dirname, '../../../migrations');
const migrationPaths = [
  '0156_platform_credit_ledger.sql',
  '0161_platform_credit_reservations.sql',
  '0162_platform_credit_sponsored_membership_purchase.sql',
  '0163_group_sponsored_default_member_template.sql',
].map((name) => path.join(migrationsDirectory, name));
const migrationPath = migrationPaths.at(-1)!;
const journalPath = path.join(migrationsDirectory, 'meta/_journal.json');
const previousSnapshotPath = path.join(migrationsDirectory, 'meta/0162_snapshot.json');
const snapshotPath = path.join(migrationsDirectory, 'meta/0163_snapshot.json');

const statementsFrom = (filePath: string) =>
  readFileSync(filePath, 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);

const applyMigration = async (client: PGlite, filePath: string) => {
  for (const statement of statementsFrom(filePath)) await client.exec(statement);
};

describe('group-sponsored default member template migration metadata', () => {
  it('appends 0163 without replacing 0162', () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(existsSync(snapshotPath)).toBe(true);
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries.at(-2)).toMatchObject({
      idx: 162,
      tag: '0162_platform_credit_sponsored_membership_purchase',
    });
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 163,
      tag: '0163_group_sponsored_default_member_template',
    });
    const previousSnapshot = JSON.parse(readFileSync(previousSnapshotPath, 'utf8')) as {
      id: string;
    };
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as { prevId: string };
    expect(snapshot.prevId).toBe(previousSnapshot.id);
  });
});

describe.runIf(existsSync(migrationPath))(
  'group-sponsored default member template migration',
  () => {
    it('backfills legacy policies and invitations to explicit disabled snapshots', async () => {
      const client = new PGlite();
      try {
        await client.exec(`
        CREATE TABLE users (id text PRIMARY KEY);
        CREATE TABLE chat_groups (
          id text PRIMARY KEY,
          user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE
        );
      `);
        for (const filePath of migrationPaths.slice(0, -1)) await applyMigration(client, filePath);
        await client.exec(`
        INSERT INTO users (id) VALUES ('owner'), ('member');
        INSERT INTO chat_groups (id, user_id) VALUES ('group', 'owner');
        INSERT INTO platform_credit_accounts (
          id, user_id, user_id_snapshot, balance_credits
        ) VALUES (
          '00000000-0000-4000-8000-000000001631', 'owner', 'owner', 1000
        );
        INSERT INTO chat_group_sponsored_credit_policies (
          chat_group_id, payer_account_id, payer_user_id, payer_user_id_snapshot,
          enabled, group_period_limit_credits, period_started_at, period_ends_at,
          period_duration_seconds
        ) VALUES (
          'group', '00000000-0000-4000-8000-000000001631', 'owner', 'owner',
          true, 10000, now(), now() + interval '1 day', 86400
        );
        INSERT INTO chat_group_user_invitations (
          id, chat_group_id, inviter_user_id, invitee_user_id, token_hash, expires_at
        ) VALUES (
          'invite', 'group', 'owner', 'member', repeat('a', 64), now() + interval '1 day'
        );
      `);

        await applyMigration(client, migrationPath);

        const policies = await client.query(`
        SELECT default_member_sponsorship_enabled,
               default_member_request_limit_credits,
               default_member_period_limit_credits
        FROM chat_group_sponsored_credit_policies
      `);
        expect(policies.rows).toEqual([
          {
            default_member_period_limit_credits: null,
            default_member_request_limit_credits: null,
            default_member_sponsorship_enabled: false,
          },
        ]);
        const invitations = await client.query(`
        SELECT sponsorship_mode_snapshot, sponsor_policy_version_snapshot,
               sponsor_request_limit_credits_snapshot,
               sponsor_period_limit_credits_snapshot
        FROM chat_group_user_invitations
      `);
        expect(invitations.rows).toEqual([
          {
            sponsor_period_limit_credits_snapshot: null,
            sponsor_policy_version_snapshot: null,
            sponsor_request_limit_credits_snapshot: null,
            sponsorship_mode_snapshot: 'none',
          },
        ]);
      } finally {
        await client.close();
      }
    }, 20_000);

    it('rejects partial or unsafe policy and invitation snapshots', async () => {
      const client = new PGlite();
      try {
        await client.exec(`
        CREATE TABLE users (id text PRIMARY KEY);
        CREATE TABLE chat_groups (
          id text PRIMARY KEY,
          user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE
        );
      `);
        for (const filePath of migrationPaths) await applyMigration(client, filePath);
        await client.exec(`
        INSERT INTO users (id) VALUES ('owner'), ('member');
        INSERT INTO chat_groups (id, user_id) VALUES ('group', 'owner');
        INSERT INTO platform_credit_accounts (
          id, user_id, user_id_snapshot, balance_credits
        ) VALUES (
          '00000000-0000-4000-8000-000000001632', 'owner', 'owner', 1000
        );
        INSERT INTO chat_group_sponsored_credit_policies (
          chat_group_id, payer_account_id, payer_user_id, payer_user_id_snapshot,
          enabled, group_period_limit_credits, period_started_at, period_ends_at,
          period_duration_seconds
        ) VALUES (
          'group', '00000000-0000-4000-8000-000000001632', 'owner', 'owner',
          true, 10000, now(), now() + interval '1 day', 86400
        );
      `);

        await expect(
          client.exec(`
          UPDATE chat_group_sponsored_credit_policies
          SET default_member_sponsorship_enabled = true,
              default_member_request_limit_credits = 501,
              default_member_period_limit_credits = 500
          WHERE chat_group_id = 'group'
        `),
        ).rejects.toThrow(/default_member_template_ch/);
        await expect(
          client.exec(`
          INSERT INTO chat_group_user_invitations (
            id, chat_group_id, inviter_user_id, invitee_user_id, token_hash, expires_at,
            sponsorship_mode_snapshot, sponsor_policy_version_snapshot
          ) VALUES (
            'unsafe', 'group', 'owner', 'member', repeat('b', 64), now() + interval '1 day',
            'group_owner', 1
          )
        `),
        ).rejects.toThrow(/sponsorship_snapshot_check/);
      } finally {
        await client.close();
      }
    }, 20_000);
  },
);
