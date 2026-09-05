import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { createNanoId } from '../utils/idGenerator';
import { createdAt, timestamptz, updatedAt } from './_helpers';
import { chatGroups } from './chatGroup';
import { platformCreditAccounts } from './platformCredit';
import { users } from './user';

export type ChatGroupSponsoredCreditAuditAction =
  | 'member_granted'
  | 'member_limits_updated'
  | 'member_revoked'
  | 'policy_disabled'
  | 'policy_default_member_template_updated'
  | 'policy_enabled'
  | 'policy_limit_updated';

export const chatGroupSponsoredCreditPolicies = pgTable(
  'chat_group_sponsored_credit_policies',
  {
    chatGroupId: text('chat_group_id')
      .references(() => chatGroups.id, { onDelete: 'cascade' })
      .primaryKey()
      .notNull(),
    payerAccountId: uuid('payer_account_id')
      .references(() => platformCreditAccounts.id, { onDelete: 'restrict' })
      .notNull(),
    payerUserId: text('payer_user_id').references(() => users.id, { onDelete: 'set null' }),
    payerUserIdSnapshot: text('payer_user_id_snapshot').notNull(),
    enabled: boolean('enabled').default(false).notNull(),
    groupPeriodLimitCredits: bigint('group_period_limit_credits', { mode: 'number' }).notNull(),
    defaultMemberSponsorshipEnabled: boolean('default_member_sponsorship_enabled')
      .default(false)
      .notNull(),
    defaultMemberRequestLimitCredits: bigint('default_member_request_limit_credits', {
      mode: 'number',
    }),
    defaultMemberPeriodLimitCredits: bigint('default_member_period_limit_credits', {
      mode: 'number',
    }),
    periodStartedAt: timestamptz('period_started_at').notNull(),
    periodEndsAt: timestamptz('period_ends_at').notNull(),
    periodDurationSeconds: integer('period_duration_seconds').notNull(),
    policyVersion: integer('policy_version').default(1).notNull(),
    disabledAt: timestamptz('disabled_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('chat_group_sponsored_credit_policies_payer_account_idx').on(table.payerAccountId),
    index('chat_group_sponsored_credit_policies_enabled_idx').on(table.enabled),
    check(
      'chat_group_sponsored_credit_policies_limits_check',
      sql`${table.groupPeriodLimitCredits} > 0 AND ${table.groupPeriodLimitCredits} <= 9007199254740991`,
    ),
    check(
      'chat_group_sponsored_credit_policies_period_check',
      sql`${table.periodDurationSeconds} > 0 AND ${table.periodDurationSeconds} <= 31536000
        AND ${table.periodEndsAt} > ${table.periodStartedAt}`,
    ),
    check(
      'chat_group_sponsored_credit_policies_default_member_template_check',
      sql`(
        ${table.defaultMemberSponsorshipEnabled} = false
        AND ${table.defaultMemberRequestLimitCredits} IS NULL
        AND ${table.defaultMemberPeriodLimitCredits} IS NULL
      ) OR (
        ${table.defaultMemberSponsorshipEnabled} = true
        AND ${table.enabled} = true
        AND ${table.defaultMemberRequestLimitCredits} IS NOT NULL
        AND ${table.defaultMemberPeriodLimitCredits} IS NOT NULL
        AND ${table.defaultMemberRequestLimitCredits} > 0
        AND ${table.defaultMemberPeriodLimitCredits} > 0
        AND ${table.defaultMemberRequestLimitCredits} <= ${table.defaultMemberPeriodLimitCredits}
        AND ${table.defaultMemberPeriodLimitCredits} <= ${table.groupPeriodLimitCredits}
        AND ${table.defaultMemberPeriodLimitCredits} <= 9007199254740991
      )`,
    ),
    check('chat_group_sponsored_credit_policies_version_check', sql`${table.policyVersion} > 0`),
    check(
      'chat_group_sponsored_credit_policies_identity_check',
      sql`length(trim(${table.payerUserIdSnapshot})) > 0`,
    ),
  ],
);

export type ChatGroupSponsoredCreditPolicyItem =
  typeof chatGroupSponsoredCreditPolicies.$inferSelect;
export type NewChatGroupSponsoredCreditPolicy =
  typeof chatGroupSponsoredCreditPolicies.$inferInsert;

/** Immutable, deliberately narrow policy audit. Generated content and credentials never belong here. */
export const chatGroupSponsoredCreditAudits = pgTable(
  'chat_group_sponsored_credit_audits',
  {
    id: text('id')
      .$defaultFn(() => createNanoId(16)())
      .primaryKey()
      .notNull(),
    chatGroupIdSnapshot: text('chat_group_id_snapshot').notNull(),
    actorUserIdSnapshot: text('actor_user_id_snapshot').notNull(),
    payerUserIdSnapshot: text('payer_user_id_snapshot').notNull(),
    targetUserIdSnapshot: text('target_user_id_snapshot'),
    action: text('action').$type<ChatGroupSponsoredCreditAuditAction>().notNull(),
    enabled: boolean('enabled'),
    groupPeriodLimitCredits: bigint('group_period_limit_credits', { mode: 'number' }),
    memberRequestLimitCredits: bigint('member_request_limit_credits', { mode: 'number' }),
    memberPeriodLimitCredits: bigint('member_period_limit_credits', { mode: 'number' }),
    policyVersion: integer('policy_version'),
    membershipVersion: integer('membership_version'),
    createdAt: createdAt(),
  },
  (table) => [
    index('chat_group_sponsored_credit_audits_group_created_idx').on(
      table.chatGroupIdSnapshot,
      table.createdAt,
    ),
    check(
      'chat_group_sponsored_credit_audits_action_check',
      sql`${table.action} IN (
        'member_granted', 'member_limits_updated', 'member_revoked',
        'policy_disabled', 'policy_default_member_template_updated',
        'policy_enabled', 'policy_limit_updated'
      )`,
    ),
    check(
      'chat_group_sponsored_credit_audits_limit_check',
      sql`(${table.groupPeriodLimitCredits} IS NULL OR (${table.groupPeriodLimitCredits} > 0 AND ${table.groupPeriodLimitCredits} <= 9007199254740991))
        AND (${table.memberRequestLimitCredits} IS NULL OR (${table.memberRequestLimitCredits} > 0 AND ${table.memberRequestLimitCredits} <= 9007199254740991))
        AND (${table.memberPeriodLimitCredits} IS NULL OR (${table.memberPeriodLimitCredits} > 0 AND ${table.memberPeriodLimitCredits} <= 9007199254740991))`,
    ),
    check(
      'chat_group_sponsored_credit_audits_version_check',
      sql`(${table.policyVersion} IS NULL OR ${table.policyVersion} > 0)
        AND (${table.membershipVersion} IS NULL OR ${table.membershipVersion} > 0)`,
    ),
    check(
      'chat_group_sponsored_credit_audits_identity_check',
      sql`length(trim(${table.chatGroupIdSnapshot})) > 0
        AND length(trim(${table.actorUserIdSnapshot})) > 0
        AND length(trim(${table.payerUserIdSnapshot})) > 0`,
    ),
  ],
);

export type ChatGroupSponsoredCreditAuditItem = typeof chatGroupSponsoredCreditAudits.$inferSelect;
export type NewChatGroupSponsoredCreditAudit = typeof chatGroupSponsoredCreditAudits.$inferInsert;
