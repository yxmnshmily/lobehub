import type { ModelUsage } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { timestamps, timestamptz } from './_helpers';
import { users } from './user';

export type PlatformCreditEntryType = 'adjustment' | 'reversal' | 'top_up' | 'usage_charge';
export type PlatformCreditTokenUsage = Omit<ModelUsage, 'cost'>;
export type PlatformCreditBudgetStatus = 'active' | 'expired' | 'released' | 'settled';
export type PlatformCreditBudgetAuthorizationKind = 'group_member_sponsored' | 'self';
export type PlatformCreditReservationCallKind = 'call_llm' | 'compress_context' | 'image';
export type PlatformCreditReservationStatus =
  'expired' | 'provider_completed' | 'provider_started' | 'released' | 'reserved' | 'settled';
export type PlatformCreditCompletionUsage = PlatformCreditTokenUsage & { cost: number };

export const platformCreditAccounts = pgTable(
  'platform_credit_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Retains the account owner identity after a user is removed. */
    userIdSnapshot: text('user_id_snapshot').notNull(),
    balanceCredits: bigint('balance_credits', { mode: 'number' }).default(0).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('platform_credit_accounts_user_snapshot_unique').on(table.userIdSnapshot),
    index('platform_credit_accounts_user_id_idx').on(table.userId),
    check('platform_credit_accounts_balance_non_negative', sql`${table.balanceCredits} >= 0`),
  ],
);

export const platformCreditEntries = pgTable(
  'platform_credit_entries',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    accountId: uuid('account_id')
      .references(() => platformCreditAccounts.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    userIdSnapshot: text('user_id_snapshot').notNull(),
    /** Customer whose model invocation consumed the credits. */
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorUserIdSnapshot: text('actor_user_id_snapshot'),
    /** Administrator responsible for a top-up, adjustment, or reversal. */
    operatorUserId: text('operator_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reversalOfEntryId: uuid('reversal_of_entry_id').references(
      (): AnyPgColumn => platformCreditEntries.id,
      { onDelete: 'restrict' },
    ),
    type: text('type').$type<PlatformCreditEntryType>().notNull(),
    /** Signed integer Credits: charges are negative and credits are positive. */
    amountCredits: bigint('amount_credits', { mode: 'number' }).notNull(),
    balanceAfterCredits: bigint('balance_after_credits', { mode: 'number' }).notNull(),
    reason: text('reason').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    provider: text('provider'),
    model: text('model'),
    generationId: text('generation_id'),
    generationType: text('generation_type'),
    workspaceId: text('workspace_id'),
    tokenUsage: jsonb('token_usage').$type<PlatformCreditTokenUsage>(),
    /** Authoritative USD cost emitted by LobeHub's model runtime. */
    costUsd: numeric('cost_usd', { mode: 'number', precision: 30, scale: 15 }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('platform_credit_entries_account_idempotency_unique').on(
      table.accountId,
      table.idempotencyKey,
    ),
    uniqueIndex('platform_credit_entries_reversal_once_unique')
      .on(table.reversalOfEntryId)
      .where(sql`${table.reversalOfEntryId} IS NOT NULL`),
    index('platform_credit_entries_user_created_at_idx').on(table.userId, table.createdAt),
    index('platform_credit_entries_actor_created_at_idx').on(table.actorUserId, table.createdAt),
    index('platform_credit_entries_generation_idx').on(table.generationId),
    index('platform_credit_entries_type_created_at_idx').on(table.type, table.createdAt),
    check(
      'platform_credit_entries_type_valid',
      sql`${table.type} IN ('top_up', 'usage_charge', 'adjustment', 'reversal')`,
    ),
    check(
      'platform_credit_entries_amount_matches_type',
      sql`(
        (${table.type} = 'top_up' AND ${table.amountCredits} > 0)
        OR (${table.type} = 'usage_charge' AND ${table.amountCredits} <= 0)
        OR (${table.type} = 'adjustment' AND ${table.amountCredits} <> 0)
        OR (${table.type} = 'reversal' AND ${table.reversalOfEntryId} IS NOT NULL)
      )`,
    ),
    check(
      'platform_credit_entries_usage_metadata_complete',
      sql`${table.type} <> 'usage_charge' OR (
        ${table.actorUserIdSnapshot} IS NOT NULL
        AND ${table.provider} IS NOT NULL
        AND length(trim(${table.provider})) > 0
        AND ${table.model} IS NOT NULL
        AND length(trim(${table.model})) > 0
        AND ${table.generationId} IS NOT NULL
        AND length(trim(${table.generationId})) > 0
        AND ${table.tokenUsage} IS NOT NULL
        AND ${table.costUsd} IS NOT NULL
        AND ${table.costUsd} >= 0
      )`,
    ),
    check('platform_credit_entries_balance_non_negative', sql`${table.balanceAfterCredits} >= 0`),
    check('platform_credit_entries_reason_non_empty', sql`length(trim(${table.reason})) > 0`),
  ],
);

/**
 * Durable request-level authorization. The posted account balance is not mutated while funds are
 * held; available Credits are the posted balance minus every active budget's unconsumed amount.
 */
export const platformCreditBudgets = pgTable(
  'platform_credit_budgets',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    accountId: uuid('account_id')
      .references(() => platformCreditAccounts.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    userIdSnapshot: text('user_id_snapshot').notNull(),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorUserIdSnapshot: text('actor_user_id_snapshot').notNull(),
    authorizationKind: text('authorization_kind')
      .$type<PlatformCreditBudgetAuthorizationKind>()
      .notNull(),
    sponsorChatGroupIdSnapshot: text('sponsor_chat_group_id_snapshot'),
    sponsorPolicyVersionSnapshot: integer('sponsor_policy_version_snapshot'),
    sponsorMembershipVersionSnapshot: integer('sponsor_membership_version_snapshot'),
    sponsorPeriodStartedAtSnapshot: timestamptz('sponsor_period_started_at_snapshot'),
    sponsorPeriodEndsAtSnapshot: timestamptz('sponsor_period_ends_at_snapshot'),
    sponsorGroupPeriodLimitCreditsSnapshot: bigint('sponsor_group_period_limit_credits_snapshot', {
      mode: 'number',
    }),
    sponsorMemberPeriodLimitCreditsSnapshot: bigint(
      'sponsor_member_period_limit_credits_snapshot',
      { mode: 'number' },
    ),
    sponsorMemberRequestLimitCreditsSnapshot: bigint(
      'sponsor_member_request_limit_credits_snapshot',
      { mode: 'number' },
    ),
    workspaceId: text('workspace_id'),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    authorizedCredits: bigint('authorized_credits', { mode: 'number' }).notNull(),
    consumedCredits: bigint('consumed_credits', { mode: 'number' }).default(0).notNull(),
    status: text('status').$type<PlatformCreditBudgetStatus>().notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    leaseVersion: bigint('lease_version', { mode: 'number' }).default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('platform_credit_budgets_account_idempotency_unique').on(
      table.accountId,
      table.idempotencyKey,
    ),
    uniqueIndex('platform_credit_budgets_account_source_unique').on(
      table.accountId,
      table.sourceType,
      table.sourceId,
    ),
    index('platform_credit_budgets_account_status_idx').on(table.accountId, table.status),
    index('platform_credit_budgets_actor_status_idx').on(table.actorUserId, table.status),
    index('platform_credit_budgets_sponsor_group_period_status_idx').on(
      table.sponsorChatGroupIdSnapshot,
      table.sponsorPeriodStartedAtSnapshot,
      table.status,
    ),
    index('platform_credit_budgets_sponsor_actor_period_status_idx').on(
      table.sponsorChatGroupIdSnapshot,
      table.actorUserIdSnapshot,
      table.sponsorPeriodStartedAtSnapshot,
      table.status,
    ),
    index('platform_credit_budgets_status_expires_at_idx').on(table.status, table.expiresAt),
    check(
      'platform_credit_budgets_amounts_valid',
      sql`${table.authorizedCredits} > 0 AND ${table.consumedCredits} >= 0 AND ${table.consumedCredits} <= ${table.authorizedCredits}`,
    ),
    check(
      'platform_credit_budgets_status_valid',
      sql`${table.status} IN ('active', 'settled', 'released', 'expired')`,
    ),
    check(
      'platform_credit_budgets_authorization_kind_valid',
      sql`${table.authorizationKind} IN ('self', 'group_member_sponsored')`,
    ),
    check(
      'platform_credit_budgets_authorization_snapshot_valid',
      sql`(
        ${table.authorizationKind} = 'self'
        AND ${table.actorUserIdSnapshot} = ${table.userIdSnapshot}
        AND ${table.sponsorChatGroupIdSnapshot} IS NULL
        AND ${table.sponsorPolicyVersionSnapshot} IS NULL
        AND ${table.sponsorMembershipVersionSnapshot} IS NULL
        AND ${table.sponsorPeriodStartedAtSnapshot} IS NULL
        AND ${table.sponsorPeriodEndsAtSnapshot} IS NULL
        AND ${table.sponsorGroupPeriodLimitCreditsSnapshot} IS NULL
        AND ${table.sponsorMemberPeriodLimitCreditsSnapshot} IS NULL
        AND ${table.sponsorMemberRequestLimitCreditsSnapshot} IS NULL
      ) OR (
        ${table.authorizationKind} = 'group_member_sponsored'
        AND ${table.actorUserIdSnapshot} <> ${table.userIdSnapshot}
        AND ${table.sponsorChatGroupIdSnapshot} IS NOT NULL
        AND length(trim(${table.sponsorChatGroupIdSnapshot})) > 0
        AND ${table.sponsorPolicyVersionSnapshot} IS NOT NULL
        AND ${table.sponsorPolicyVersionSnapshot} > 0
        AND ${table.sponsorMembershipVersionSnapshot} IS NOT NULL
        AND ${table.sponsorMembershipVersionSnapshot} > 0
        AND ${table.sponsorPeriodStartedAtSnapshot} IS NOT NULL
        AND ${table.sponsorPeriodEndsAtSnapshot} IS NOT NULL
        AND ${table.sponsorPeriodEndsAtSnapshot} > ${table.sponsorPeriodStartedAtSnapshot}
        AND ${table.sponsorGroupPeriodLimitCreditsSnapshot} IS NOT NULL
        AND ${table.sponsorGroupPeriodLimitCreditsSnapshot} > 0
        AND ${table.sponsorGroupPeriodLimitCreditsSnapshot} <= 9007199254740991
        AND ${table.sponsorMemberPeriodLimitCreditsSnapshot} IS NOT NULL
        AND ${table.sponsorMemberPeriodLimitCreditsSnapshot} > 0
        AND ${table.sponsorMemberPeriodLimitCreditsSnapshot} <= 9007199254740991
        AND ${table.sponsorMemberRequestLimitCreditsSnapshot} IS NOT NULL
        AND ${table.sponsorMemberRequestLimitCreditsSnapshot} > 0
        AND ${table.sponsorMemberRequestLimitCreditsSnapshot} <= ${table.sponsorMemberPeriodLimitCreditsSnapshot}
        AND ${table.sponsorMemberRequestLimitCreditsSnapshot} <= ${table.sponsorGroupPeriodLimitCreditsSnapshot}
      )`,
    ),
    check('platform_credit_budgets_lease_valid', sql`${table.leaseVersion} > 0`),
    check(
      'platform_credit_budgets_identity_non_empty',
      sql`
      length(trim(${table.userIdSnapshot})) > 0
      AND length(trim(${table.actorUserIdSnapshot})) > 0
      AND length(trim(${table.sourceType})) > 0
      AND length(trim(${table.sourceId})) > 0
      AND length(trim(${table.idempotencyKey})) > 0
      AND length(trim(${table.requestHash})) > 0
    `,
    ),
  ],
);

/** Per-provider-call allocation within a request budget. */
export const platformCreditReservations = pgTable(
  'platform_credit_reservations',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    budgetId: uuid('budget_id')
      .references(() => platformCreditBudgets.id, { onDelete: 'cascade' })
      .notNull(),
    accountId: uuid('account_id')
      .references(() => platformCreditAccounts.id, { onDelete: 'cascade' })
      .notNull(),
    generationId: text('generation_id').notNull(),
    generationType: text('generation_type'),
    callKind: text('call_kind').$type<PlatformCreditReservationCallKind>().notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    workspaceId: text('workspace_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    reservedCredits: bigint('reserved_credits', { mode: 'number' }).notNull(),
    settledCredits: bigint('settled_credits', { mode: 'number' }).default(0).notNull(),
    status: text('status').$type<PlatformCreditReservationStatus>().notNull(),
    leaseVersion: bigint('lease_version', { mode: 'number' }).default(1).notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    providerRequestId: text('provider_request_id'),
    actualUsage: jsonb('actual_usage').$type<PlatformCreditCompletionUsage>(),
    usageEntryId: uuid('usage_entry_id').references(() => platformCreditEntries.id, {
      onDelete: 'restrict',
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('platform_credit_reservations_account_idempotency_unique').on(
      table.accountId,
      table.idempotencyKey,
    ),
    uniqueIndex('platform_credit_reservations_usage_entry_unique')
      .on(table.usageEntryId)
      .where(sql`${table.usageEntryId} IS NOT NULL`),
    index('platform_credit_reservations_budget_status_idx').on(table.budgetId, table.status),
    index('platform_credit_reservations_status_expires_at_idx').on(table.status, table.expiresAt),
    check(
      'platform_credit_reservations_amounts_valid',
      sql`${table.reservedCredits} > 0 AND ${table.settledCredits} >= 0 AND ${table.settledCredits} <= ${table.reservedCredits}`,
    ),
    check(
      'platform_credit_reservations_call_kind_valid',
      sql`${table.callKind} IN ('call_llm', 'compress_context', 'image')`,
    ),
    check(
      'platform_credit_reservations_status_valid',
      sql`${table.status} IN ('reserved', 'provider_started', 'provider_completed', 'settled', 'released', 'expired')`,
    ),
    check(
      'platform_credit_reservations_completion_valid',
      sql`(
        ${table.status} NOT IN ('provider_completed', 'settled')
        OR ${table.actualUsage} IS NOT NULL
      ) AND (${table.status} <> 'settled' OR ${table.usageEntryId} IS NOT NULL)`,
    ),
    check('platform_credit_reservations_lease_valid', sql`${table.leaseVersion} > 0`),
    check(
      'platform_credit_reservations_identity_non_empty',
      sql`
      length(trim(${table.generationId})) > 0
      AND length(trim(${table.provider})) > 0
      AND length(trim(${table.model})) > 0
      AND length(trim(${table.idempotencyKey})) > 0
    `,
    ),
  ],
);

export type PlatformCreditAccountItem = typeof platformCreditAccounts.$inferSelect;
export type PlatformCreditBudgetItem = typeof platformCreditBudgets.$inferSelect;
export type PlatformCreditEntryItem = typeof platformCreditEntries.$inferSelect;
export type PlatformCreditReservationItem = typeof platformCreditReservations.$inferSelect;
