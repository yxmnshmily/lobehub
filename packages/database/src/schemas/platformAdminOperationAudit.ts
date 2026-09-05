import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export type PlatformAdminOperationAction =
  | 'user.banned'
  | 'user.password_reset_requested'
  | 'user.profile_updated'
  | 'user.sessions_revoked'
  | 'user.travel_group_repaired'
  | 'user.unbanned';

export type PlatformAdminOperationPhase = 'failed' | 'requested' | 'succeeded';

export const platformAdminOperationAudits = pgTable(
  'platform_admin_operation_audits',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    /** Immutable identifier retained even if the administrator account is removed. */
    operatorUserId: text('operator_user_id').notNull(),
    /** Immutable identifier retained even if the managed account is removed. */
    targetUserId: text('target_user_id').notNull(),
    operationId: text('operation_id').notNull(),
    action: text('action').$type<PlatformAdminOperationAction>().notNull(),
    phase: text('phase').$type<PlatformAdminOperationPhase>().notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('platform_admin_operation_audits_operation_action_phase_unique').on(
      table.operationId,
      table.action,
      table.phase,
    ),
    index('platform_admin_operation_audits_target_occurred_idx').on(
      table.targetUserId,
      table.occurredAt,
    ),
    index('platform_admin_operation_audits_operator_occurred_idx').on(
      table.operatorUserId,
      table.occurredAt,
    ),
    index('platform_admin_operation_audits_action_occurred_idx').on(table.action, table.occurredAt),
    check(
      'platform_admin_operation_audits_action_valid',
      sql`${table.action} IN ('user.profile_updated', 'user.banned', 'user.unbanned', 'user.password_reset_requested', 'user.sessions_revoked', 'user.travel_group_repaired')`,
    ),
    check(
      'platform_admin_operation_audits_phase_valid',
      sql`${table.phase} IN ('requested', 'succeeded', 'failed')`,
    ),
    check(
      'platform_admin_operation_audits_operator_user_id_non_empty',
      sql`length(trim(${table.operatorUserId})) BETWEEN 1 AND 255`,
    ),
    check(
      'platform_admin_operation_audits_target_user_id_non_empty',
      sql`length(trim(${table.targetUserId})) BETWEEN 1 AND 255`,
    ),
    check(
      'platform_admin_operation_audits_operation_id_non_empty',
      sql`length(trim(${table.operationId})) BETWEEN 1 AND 128`,
    ),
  ],
);

export type PlatformAdminOperationAuditItem = typeof platformAdminOperationAudits.$inferSelect;
