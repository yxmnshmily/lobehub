import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './user';

export type PlatformModerationSourceType = 'chat' | 'copy' | 'document' | 'image' | 'video';
export type PlatformModerationVerdict = 'allow' | 'block' | 'review';
export type PlatformModerationDisposition = 'ban_recommended' | 'cleared' | 'pending' | 'reviewed';
export type PlatformModerationCategory =
  'credential' | 'email' | 'government_id' | 'phone' | 'provider_moderation';
export type PlatformModerationSeverity = 'critical' | 'high' | 'medium';

export interface PlatformModerationCategoryFinding {
  category: PlatformModerationCategory;
  count: number;
  severity: PlatformModerationSeverity;
}

export const platformModerationAudits = pgTable(
  'platform_moderation_audits',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Preserves audit ownership after the account is removed. */
    userIdSnapshot: text('user_id_snapshot').notNull(),
    sourceType: text('source_type').$type<PlatformModerationSourceType>().notNull(),
    /** An opaque generation/message identifier, never user-provided content. */
    sourceId: text('source_id').notNull(),
    verdict: text('verdict').$type<PlatformModerationVerdict>().notNull(),
    categories: jsonb('categories').$type<PlatformModerationCategoryFinding[]>().notNull(),
    fingerprint: text('fingerprint').notNull(),
    redactedPreview: text('redacted_preview').notNull(),
    detectedAt: timestamp('detected_at', { withTimezone: true }).defaultNow().notNull(),
    disposition: text('disposition')
      .$type<PlatformModerationDisposition>()
      .default('pending')
      .notNull(),
    disposedAt: timestamp('disposed_at', { withTimezone: true }),
    /** Kept as an immutable audit identifier rather than an account FK. */
    operatorUserId: text('operator_user_id'),
  },
  (table) => [
    index('platform_moderation_audits_user_detected_idx').on(
      table.userIdSnapshot,
      table.detectedAt,
    ),
    index('platform_moderation_audits_disposition_detected_idx').on(
      table.disposition,
      table.detectedAt,
    ),
    index('platform_moderation_audits_verdict_detected_idx').on(table.verdict, table.detectedAt),
    index('platform_moderation_audits_source_idx').on(table.sourceType, table.sourceId),
    index('platform_moderation_audits_fingerprint_idx').on(table.fingerprint),
    check(
      'platform_moderation_audits_source_type_valid',
      sql`${table.sourceType} IN ('chat', 'copy', 'document', 'image', 'video')`,
    ),
    check(
      'platform_moderation_audits_verdict_valid',
      sql`${table.verdict} IN ('allow', 'block', 'review')`,
    ),
    check(
      'platform_moderation_audits_disposition_valid',
      sql`${table.disposition} IN ('pending', 'reviewed', 'cleared', 'ban_recommended')`,
    ),
    check(
      'platform_moderation_audits_disposition_metadata',
      sql`(
        (${table.disposition} = 'pending' AND ${table.disposedAt} IS NULL AND ${table.operatorUserId} IS NULL)
        OR (${table.disposition} <> 'pending' AND ${table.disposedAt} IS NOT NULL AND ${table.operatorUserId} IS NOT NULL)
      )`,
    ),
    check(
      'platform_moderation_audits_categories_array',
      sql`jsonb_typeof(${table.categories}) = 'array'`,
    ),
    check(
      'platform_moderation_audits_fingerprint_sha256',
      sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'platform_moderation_audits_preview_length',
      sql`char_length(${table.redactedPreview}) <= 240`,
    ),
    check(
      'platform_moderation_audits_user_snapshot_non_empty',
      sql`length(trim(${table.userIdSnapshot})) BETWEEN 1 AND 255`,
    ),
    check(
      'platform_moderation_audits_source_id_non_empty',
      sql`length(trim(${table.sourceId})) BETWEEN 1 AND 500`,
    ),
  ],
);

export type PlatformModerationAuditItem = typeof platformModerationAudits.$inferSelect;
