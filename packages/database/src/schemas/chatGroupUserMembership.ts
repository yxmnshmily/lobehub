import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { createNanoId } from '../utils/idGenerator';
import { createdAt, timestamptz, updatedAt } from './_helpers';
import { chatGroups } from './chatGroup';
import { users } from './user';

/** Human membership is intentionally separate from the AI roster in chat_groups_agents. */
export const chatGroupUserMemberships = pgTable(
  'chat_group_user_memberships',
  {
    chatGroupId: text('chat_group_id')
      .references(() => chatGroups.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    invitedByUserId: text('invited_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    role: text('role', { enum: ['member'] })
      .default('member')
      .notNull(),
    /** Paid hosted AI stays unavailable until owner limits and payer resolution are implemented. */
    canUsePaidAi: boolean('can_use_paid_ai').default(false).notNull(),
    maxCreditsPerRequest: bigint('max_credits_per_request', { mode: 'number' }),
    maxCreditsPerPeriod: bigint('max_credits_per_period', { mode: 'number' }),
    membershipVersion: integer('membership_version').default(1).notNull(),
    joinedAt: timestamptz('joined_at').defaultNow().notNull(),
    removedAt: timestamptz('removed_at'),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.chatGroupId, table.userId] }),
    index('chat_group_user_memberships_user_id_idx').on(table.userId),
    check('chat_group_user_memberships_role_check', sql`${table.role} = 'member'`),
    check(
      'chat_group_user_memberships_paid_ai_limits_check',
      sql`(
        ${table.canUsePaidAi} = false
        AND ${table.maxCreditsPerRequest} IS NULL
        AND ${table.maxCreditsPerPeriod} IS NULL
      ) OR (
        ${table.canUsePaidAi} = true
        AND ${table.maxCreditsPerRequest} IS NOT NULL
        AND ${table.maxCreditsPerPeriod} IS NOT NULL
        AND ${table.maxCreditsPerRequest} > 0
        AND ${table.maxCreditsPerPeriod} > 0
        AND ${table.maxCreditsPerRequest} <= ${table.maxCreditsPerPeriod}
        AND ${table.maxCreditsPerPeriod} <= 9007199254740991
      )`,
    ),
    check('chat_group_user_memberships_version_check', sql`${table.membershipVersion} > 0`),
  ],
);

export type ChatGroupUserMembershipItem = typeof chatGroupUserMemberships.$inferSelect;
export type NewChatGroupUserMembership = typeof chatGroupUserMemberships.$inferInsert;

export const chatGroupUserInvitations = pgTable(
  'chat_group_user_invitations',
  {
    id: text('id')
      .$defaultFn(() => createNanoId(16)())
      .primaryKey()
      .notNull(),
    chatGroupId: text('chat_group_id')
      .references(() => chatGroups.id, { onDelete: 'cascade' })
      .notNull(),
    inviterUserId: text('inviter_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    inviteeUserId: text('invitee_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    tokenHash: text('token_hash').notNull(),
    role: text('role', { enum: ['member'] })
      .default('member')
      .notNull(),
    status: text('status', { enum: ['accepted', 'expired', 'pending', 'revoked'] })
      .default('pending')
      .notNull(),
    /** Server-issued authority snapshot. Clients never select payer or limits. */
    sponsorshipModeSnapshot: text('sponsorship_mode_snapshot', {
      enum: ['group_owner', 'none'],
    })
      .default('none')
      .notNull(),
    sponsorPolicyVersionSnapshot: integer('sponsor_policy_version_snapshot'),
    sponsorRequestLimitCreditsSnapshot: bigint('sponsor_request_limit_credits_snapshot', {
      mode: 'number',
    }),
    sponsorPeriodLimitCreditsSnapshot: bigint('sponsor_period_limit_credits_snapshot', {
      mode: 'number',
    }),
    expiresAt: timestamptz('expires_at').notNull(),
    acceptedAt: timestamptz('accepted_at'),
    revokedAt: timestamptz('revoked_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('chat_group_user_invitations_token_hash_unique').on(table.tokenHash),
    uniqueIndex('chat_group_user_invitations_pending_unique')
      .on(table.chatGroupId, table.inviteeUserId)
      .where(sql`${table.status} = 'pending'`),
    index('chat_group_user_invitations_invitee_status_idx').on(table.inviteeUserId, table.status),
    check('chat_group_user_invitations_role_check', sql`${table.role} = 'member'`),
    check(
      'chat_group_user_invitations_status_check',
      sql`${table.status} IN ('pending', 'accepted', 'revoked', 'expired')`,
    ),
    check(
      'chat_group_user_invitations_token_hash_check',
      sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'chat_group_user_invitations_sponsorship_snapshot_check',
      sql`(
        ${table.sponsorshipModeSnapshot} = 'none'
        AND ${table.sponsorPolicyVersionSnapshot} IS NULL
        AND ${table.sponsorRequestLimitCreditsSnapshot} IS NULL
        AND ${table.sponsorPeriodLimitCreditsSnapshot} IS NULL
      ) OR (
        ${table.sponsorshipModeSnapshot} = 'group_owner'
        AND ${table.sponsorPolicyVersionSnapshot} IS NOT NULL
        AND ${table.sponsorPolicyVersionSnapshot} > 0
        AND ${table.sponsorRequestLimitCreditsSnapshot} IS NOT NULL
        AND ${table.sponsorRequestLimitCreditsSnapshot} > 0
        AND ${table.sponsorPeriodLimitCreditsSnapshot} IS NOT NULL
        AND ${table.sponsorPeriodLimitCreditsSnapshot} > 0
        AND ${table.sponsorRequestLimitCreditsSnapshot} <= ${table.sponsorPeriodLimitCreditsSnapshot}
        AND ${table.sponsorPeriodLimitCreditsSnapshot} <= 9007199254740991
      )`,
    ),
  ],
);

export type ChatGroupUserInvitationItem = typeof chatGroupUserInvitations.$inferSelect;
export type NewChatGroupUserInvitation = typeof chatGroupUserInvitations.$inferInsert;

/** Transferable, expiring links. Only hashes are persisted; joining still requires authentication. */
export const chatGroupInvitationLinks = pgTable(
  'chat_group_invitation_links',
  {
    tokenHash: text('token_hash').primaryKey().notNull(),
    chatGroupId: text('chat_group_id')
      .references(() => chatGroups.id, { onDelete: 'cascade' })
      .notNull(),
    inviterUserId: text('inviter_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    revokedAt: timestamptz('revoked_at'),
    createdAt: createdAt(),
  },
  (table) => [index('chat_group_invitation_links_group_idx').on(table.chatGroupId)],
);
