import { createHash } from 'node:crypto';

import { INVITATION_EXPIRY_DAYS } from '@lobechat/const';
import { and, asc, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { chatGroups } from '../schemas/chatGroup';
import {
  chatGroupSponsoredCreditAudits,
  chatGroupSponsoredCreditPolicies,
} from '../schemas/chatGroupSponsoredCredit';
import {
  chatGroupUserInvitations,
  chatGroupUserMemberships,
} from '../schemas/chatGroupUserMembership';
import { users } from '../schemas/user';
import type { LobeChatDatabase } from '../type';

export const CHAT_GROUP_MEMBERSHIP_FORBIDDEN = 'CHAT_GROUP_MEMBERSHIP_FORBIDDEN';
export const CHAT_GROUP_INVITATION_INVALID = 'CHAT_GROUP_INVITATION_INVALID';
export const CHAT_GROUP_INVITATION_ALREADY_PENDING = 'CHAT_GROUP_INVITATION_ALREADY_PENDING';
export const CHAT_GROUP_INVITATION_SPONSORSHIP_CONFLICT =
  'CHAT_GROUP_INVITATION_SPONSORSHIP_CONFLICT';
export const CHAT_GROUP_INVITEE_INVALID = 'CHAT_GROUP_INVITEE_INVALID';
export const CHAT_GROUP_MEMBERSHIP_ALREADY_ACTIVE = 'CHAT_GROUP_MEMBERSHIP_ALREADY_ACTIVE';
export const CHAT_GROUP_MEMBERSHIP_PAGINATION_INVALID = 'CHAT_GROUP_MEMBERSHIP_PAGINATION_INVALID';
export const CHAT_GROUP_MEMBERSHIP_VERSION_CONFLICT = 'CHAT_GROUP_MEMBERSHIP_VERSION_CONFLICT';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

const normalizePagination = (offset = 0, limit = DEFAULT_LIST_LIMIT) => {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_LIST_LIMIT
  ) {
    throw new Error(CHAT_GROUP_MEMBERSHIP_PAGINATION_INVALID);
  }
  return { limit, offset };
};

const maskEmail = (email: string | null) => {
  if (!email) return null;
  const separator = email.lastIndexOf('@');
  if (separator < 1 || separator === email.length - 1) return null;
  return `${email[0]}***${email.slice(separator)}`;
};

const hashInvitationToken = (token: string) =>
  createHash('sha256').update(token, 'utf8').digest('hex');

const isPendingInvitationConflict = (error: unknown) => {
  let current = error;
  for (let depth = 0; depth < 3 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as { cause?: unknown; code?: string; constraint?: string };
    if (
      candidate.code === '23505' &&
      candidate.constraint === 'chat_group_user_invitations_pending_unique'
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
};

export class ChatGroupUserMembershipModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly actorUserId: string,
  ) {}

  private assertOwner = async (chatGroupId: string, db = this.db) => {
    const [group] = await db
      .select({ id: chatGroups.id })
      .from(chatGroups)
      .where(and(eq(chatGroups.id, chatGroupId), eq(chatGroups.userId, this.actorUserId)))
      .limit(1);

    if (!group) throw new Error(CHAT_GROUP_MEMBERSHIP_FORBIDDEN);
  };

  createInvitation = async (params: { chatGroupId: string; inviteeUserId: string }) => {
    try {
      return await this.db.transaction(async (tx) => {
        await this.assertOwner(params.chatGroupId, tx);

        if (params.inviteeUserId === this.actorUserId) {
          throw new Error(CHAT_GROUP_INVITEE_INVALID);
        }

        const [invitee] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, params.inviteeUserId))
          .limit(1);
        if (!invitee) throw new Error(CHAT_GROUP_INVITEE_INVALID);

        const now = new Date();
        await tx
          .update(chatGroupUserInvitations)
          .set({ status: 'expired', updatedAt: now })
          .where(
            and(
              eq(chatGroupUserInvitations.chatGroupId, params.chatGroupId),
              eq(chatGroupUserInvitations.inviteeUserId, params.inviteeUserId),
              eq(chatGroupUserInvitations.status, 'pending'),
              lte(chatGroupUserInvitations.expiresAt, now),
            ),
          );

        const [livePending] = await tx
          .select({ id: chatGroupUserInvitations.id })
          .from(chatGroupUserInvitations)
          .where(
            and(
              eq(chatGroupUserInvitations.chatGroupId, params.chatGroupId),
              eq(chatGroupUserInvitations.inviteeUserId, params.inviteeUserId),
              eq(chatGroupUserInvitations.status, 'pending'),
            ),
          )
          .for('update');
        if (livePending) throw new Error(CHAT_GROUP_INVITATION_ALREADY_PENDING);

        const [activeMember] = await tx
          .select({ userId: chatGroupUserMemberships.userId })
          .from(chatGroupUserMemberships)
          .where(
            and(
              eq(chatGroupUserMemberships.chatGroupId, params.chatGroupId),
              eq(chatGroupUserMemberships.userId, params.inviteeUserId),
              isNull(chatGroupUserMemberships.removedAt),
            ),
          )
          .limit(1);
        if (activeMember) throw new Error(CHAT_GROUP_MEMBERSHIP_ALREADY_ACTIVE);

        // Keep the same invitation -> group -> policy lock order used by acceptInvitationRecord.
        const [group] = await tx
          .select({ id: chatGroups.id, ownerUserId: chatGroups.userId })
          .from(chatGroups)
          .where(eq(chatGroups.id, params.chatGroupId))
          .for('update');
        if (!group || group.ownerUserId !== this.actorUserId) {
          throw new Error(CHAT_GROUP_MEMBERSHIP_FORBIDDEN);
        }

        const token = nanoid(48);
        const expiresAt = new Date(now);
        expiresAt.setUTCDate(expiresAt.getUTCDate() + INVITATION_EXPIRY_DAYS);
        const [policy] = await tx
          .select()
          .from(chatGroupSponsoredCreditPolicies)
          .where(eq(chatGroupSponsoredCreditPolicies.chatGroupId, params.chatGroupId))
          .for('update');
        const useOwnerTemplate = Boolean(
          policy?.enabled &&
          policy.defaultMemberSponsorshipEnabled &&
          policy.payerUserIdSnapshot === group.ownerUserId &&
          policy.defaultMemberRequestLimitCredits !== null &&
          policy.defaultMemberPeriodLimitCredits !== null,
        );

        const [invitation] = await tx
          .insert(chatGroupUserInvitations)
          .values({
            chatGroupId: params.chatGroupId,
            expiresAt,
            inviteeUserId: params.inviteeUserId,
            inviterUserId: this.actorUserId,
            sponsorPeriodLimitCreditsSnapshot: useOwnerTemplate
              ? policy!.defaultMemberPeriodLimitCredits
              : null,
            sponsorPolicyVersionSnapshot: useOwnerTemplate ? policy!.policyVersion : null,
            sponsorRequestLimitCreditsSnapshot: useOwnerTemplate
              ? policy!.defaultMemberRequestLimitCredits
              : null,
            sponsorshipModeSnapshot: useOwnerTemplate ? 'group_owner' : 'none',
            tokenHash: hashInvitationToken(token),
          })
          .returning({
            chatGroupId: chatGroupUserInvitations.chatGroupId,
            expiresAt: chatGroupUserInvitations.expiresAt,
            id: chatGroupUserInvitations.id,
            inviteeUserId: chatGroupUserInvitations.inviteeUserId,
            inviterUserId: chatGroupUserInvitations.inviterUserId,
            role: chatGroupUserInvitations.role,
            status: chatGroupUserInvitations.status,
          });

        return { ...invitation, token };
      });
    } catch (error) {
      if (isPendingInvitationConflict(error)) {
        throw new Error(CHAT_GROUP_INVITATION_ALREADY_PENDING, { cause: error });
      }
      throw error;
    }
  };

  acceptInvitation = async (token: string) => {
    return this.acceptInvitationRecord({ tokenHash: hashInvitationToken(token) });
  };

  acceptInvitationById = async (invitationId: string) => {
    return this.acceptInvitationRecord({ invitationId });
  };

  private acceptInvitationRecord = async (
    selector: { invitationId: string } | { tokenHash: string },
  ) => {
    const invitationSelector =
      'invitationId' in selector
        ? eq(chatGroupUserInvitations.id, selector.invitationId)
        : eq(chatGroupUserInvitations.tokenHash, selector.tokenHash);

    return this.db.transaction(async (tx) => {
      const [invitation] = await tx
        .select()
        .from(chatGroupUserInvitations)
        .where(
          and(invitationSelector, eq(chatGroupUserInvitations.inviteeUserId, this.actorUserId)),
        )
        .for('update');

      if (!invitation || invitation.status !== 'pending') {
        throw new Error(CHAT_GROUP_INVITATION_INVALID);
      }

      const now = new Date();
      if (invitation.expiresAt.getTime() <= now.getTime()) {
        await tx
          .update(chatGroupUserInvitations)
          .set({ status: 'expired', updatedAt: now })
          .where(
            and(
              eq(chatGroupUserInvitations.id, invitation.id),
              eq(chatGroupUserInvitations.status, 'pending'),
            ),
          );
        return { status: 'expired' as const };
      }

      const [currentOwner] = await tx
        .select({ userId: chatGroups.userId })
        .from(chatGroups)
        .where(eq(chatGroups.id, invitation.chatGroupId))
        .for('update');
      if (!currentOwner) {
        throw new Error(CHAT_GROUP_INVITATION_INVALID);
      }
      if (currentOwner.userId !== invitation.inviterUserId) {
        throw new Error(
          invitation.sponsorshipModeSnapshot === 'group_owner'
            ? CHAT_GROUP_INVITATION_SPONSORSHIP_CONFLICT
            : CHAT_GROUP_INVITATION_INVALID,
        );
      }

      let sponsoredLimits:
        | { maxCreditsPerPeriod: number; maxCreditsPerRequest: number; policyVersion: number }
        | undefined;
      if (invitation.sponsorshipModeSnapshot === 'group_owner') {
        const [policy] = await tx
          .select()
          .from(chatGroupSponsoredCreditPolicies)
          .where(eq(chatGroupSponsoredCreditPolicies.chatGroupId, invitation.chatGroupId))
          .for('update');
        if (
          !policy ||
          !policy.enabled ||
          !policy.defaultMemberSponsorshipEnabled ||
          policy.payerUserIdSnapshot !== currentOwner.userId ||
          policy.policyVersion !== invitation.sponsorPolicyVersionSnapshot ||
          policy.defaultMemberRequestLimitCredits !==
            invitation.sponsorRequestLimitCreditsSnapshot ||
          policy.defaultMemberPeriodLimitCredits !== invitation.sponsorPeriodLimitCreditsSnapshot ||
          invitation.sponsorPolicyVersionSnapshot === null ||
          invitation.sponsorRequestLimitCreditsSnapshot === null ||
          invitation.sponsorPeriodLimitCreditsSnapshot === null
        ) {
          throw new Error(CHAT_GROUP_INVITATION_SPONSORSHIP_CONFLICT);
        }
        sponsoredLimits = {
          maxCreditsPerPeriod: invitation.sponsorPeriodLimitCreditsSnapshot,
          maxCreditsPerRequest: invitation.sponsorRequestLimitCreditsSnapshot,
          policyVersion: invitation.sponsorPolicyVersionSnapshot,
        };
      }

      const [accepted] = await tx
        .update(chatGroupUserInvitations)
        .set({ acceptedAt: now, status: 'accepted', updatedAt: now })
        .where(
          and(
            eq(chatGroupUserInvitations.id, invitation.id),
            eq(chatGroupUserInvitations.status, 'pending'),
          ),
        )
        .returning({ id: chatGroupUserInvitations.id });
      if (!accepted) throw new Error(CHAT_GROUP_INVITATION_INVALID);

      const [membership] = await tx
        .insert(chatGroupUserMemberships)
        .values({
          canUsePaidAi: Boolean(sponsoredLimits),
          chatGroupId: invitation.chatGroupId,
          invitedByUserId: invitation.inviterUserId,
          maxCreditsPerPeriod: sponsoredLimits?.maxCreditsPerPeriod ?? null,
          maxCreditsPerRequest: sponsoredLimits?.maxCreditsPerRequest ?? null,
          userId: this.actorUserId,
        })
        .onConflictDoUpdate({
          set: {
            canUsePaidAi: Boolean(sponsoredLimits),
            invitedByUserId: invitation.inviterUserId,
            joinedAt: now,
            maxCreditsPerPeriod: sponsoredLimits?.maxCreditsPerPeriod ?? null,
            maxCreditsPerRequest: sponsoredLimits?.maxCreditsPerRequest ?? null,
            membershipVersion: sql`${chatGroupUserMemberships.membershipVersion} + 1`,
            removedAt: null,
            role: 'member',
            updatedAt: now,
          },
          target: [chatGroupUserMemberships.chatGroupId, chatGroupUserMemberships.userId],
        })
        .returning();

      if (sponsoredLimits) {
        await tx.insert(chatGroupSponsoredCreditAudits).values({
          action: 'member_granted',
          actorUserIdSnapshot: invitation.inviterUserId,
          chatGroupIdSnapshot: invitation.chatGroupId,
          enabled: true,
          memberPeriodLimitCredits: sponsoredLimits.maxCreditsPerPeriod,
          memberRequestLimitCredits: sponsoredLimits.maxCreditsPerRequest,
          membershipVersion: membership.membershipVersion,
          payerUserIdSnapshot: currentOwner.userId,
          policyVersion: sponsoredLimits.policyVersion,
          targetUserIdSnapshot: this.actorUserId,
        });
      }

      return { membership, status: 'accepted' as const };
    });
  };

  revokeInvitation = async (params: { chatGroupId: string; invitationId: string }) => {
    await this.assertOwner(params.chatGroupId);
    const now = new Date();
    const [revoked] = await this.db
      .update(chatGroupUserInvitations)
      .set({ revokedAt: now, status: 'revoked', updatedAt: now })
      .where(
        and(
          eq(chatGroupUserInvitations.id, params.invitationId),
          eq(chatGroupUserInvitations.chatGroupId, params.chatGroupId),
          eq(chatGroupUserInvitations.status, 'pending'),
        ),
      )
      .returning({ status: chatGroupUserInvitations.status });

    return revoked;
  };

  listHumanMembers = async (params: { chatGroupId: string; limit?: number; offset?: number }) => {
    await this.assertOwner(params.chatGroupId);
    const { limit, offset } = normalizePagination(params.offset, params.limit);
    const rows = await this.db
      .select({
        avatar: users.avatar,
        canUsePaidAi: chatGroupUserMemberships.canUsePaidAi,
        displayName: sql<string | null>`coalesce(${users.fullName}, ${users.username})`,
        joinedAt: chatGroupUserMemberships.joinedAt,
        maxCreditsPerPeriod: chatGroupUserMemberships.maxCreditsPerPeriod,
        maxCreditsPerRequest: chatGroupUserMemberships.maxCreditsPerRequest,
        membershipVersion: chatGroupUserMemberships.membershipVersion,
        userId: chatGroupUserMemberships.userId,
      })
      .from(chatGroupUserMemberships)
      .innerJoin(users, eq(users.id, chatGroupUserMemberships.userId))
      .where(
        and(
          eq(chatGroupUserMemberships.chatGroupId, params.chatGroupId),
          isNull(chatGroupUserMemberships.removedAt),
        ),
      )
      .orderBy(asc(chatGroupUserMemberships.userId))
      .offset(offset)
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    return {
      items: hasMore ? rows.slice(0, limit) : rows,
      nextOffset: hasMore ? offset + limit : null,
    };
  };

  listPendingInvitations = async (params: {
    chatGroupId: string;
    limit?: number;
    offset?: number;
  }) => {
    await this.assertOwner(params.chatGroupId);
    const { limit, offset } = normalizePagination(params.offset, params.limit);
    const rows = await this.db
      .select({
        email: users.email,
        expiresAt: chatGroupUserInvitations.expiresAt,
        id: chatGroupUserInvitations.id,
        status: chatGroupUserInvitations.status,
      })
      .from(chatGroupUserInvitations)
      .innerJoin(users, eq(users.id, chatGroupUserInvitations.inviteeUserId))
      .where(
        and(
          eq(chatGroupUserInvitations.chatGroupId, params.chatGroupId),
          eq(chatGroupUserInvitations.status, 'pending'),
          gt(chatGroupUserInvitations.expiresAt, new Date()),
        ),
      )
      .orderBy(asc(chatGroupUserInvitations.id))
      .offset(offset)
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    return {
      items: (hasMore ? rows.slice(0, limit) : rows).map(({ email, ...item }) => ({
        ...item,
        maskedEmail: maskEmail(email),
      })),
      nextOffset: hasMore ? offset + limit : null,
    };
  };

  removeMember = async (params: {
    chatGroupId: string;
    expectedMembershipVersion: number;
    memberUserId: string;
  }) => {
    await this.assertOwner(params.chatGroupId);
    return this.deactivateMembership(
      params.chatGroupId,
      params.memberUserId,
      params.expectedMembershipVersion,
    );
  };

  leaveGroup = async (params: { chatGroupId: string; expectedMembershipVersion: number }) => {
    return this.deactivateMembership(
      params.chatGroupId,
      this.actorUserId,
      params.expectedMembershipVersion,
    );
  };

  getActiveMembership = async (chatGroupId: string) => {
    const [membership] = await this.db
      .select()
      .from(chatGroupUserMemberships)
      .where(
        and(
          eq(chatGroupUserMemberships.chatGroupId, chatGroupId),
          eq(chatGroupUserMemberships.userId, this.actorUserId),
          isNull(chatGroupUserMemberships.removedAt),
        ),
      )
      .limit(1);

    return membership;
  };

  private deactivateMembership = async (
    chatGroupId: string,
    userId: string,
    expectedMembershipVersion: number,
  ) => {
    if (!Number.isSafeInteger(expectedMembershipVersion) || expectedMembershipVersion < 1) {
      throw new Error(CHAT_GROUP_MEMBERSHIP_VERSION_CONFLICT);
    }
    const now = new Date();
    const [membership] = await this.db
      .update(chatGroupUserMemberships)
      .set({
        canUsePaidAi: false,
        maxCreditsPerPeriod: null,
        maxCreditsPerRequest: null,
        membershipVersion: sql`${chatGroupUserMemberships.membershipVersion} + 1`,
        removedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(chatGroupUserMemberships.chatGroupId, chatGroupId),
          eq(chatGroupUserMemberships.userId, userId),
          eq(chatGroupUserMemberships.membershipVersion, expectedMembershipVersion),
          isNull(chatGroupUserMemberships.removedAt),
        ),
      )
      .returning();

    if (membership) return membership;

    const [activeMembership] = await this.db
      .select({ membershipVersion: chatGroupUserMemberships.membershipVersion })
      .from(chatGroupUserMemberships)
      .where(
        and(
          eq(chatGroupUserMemberships.chatGroupId, chatGroupId),
          eq(chatGroupUserMemberships.userId, userId),
          isNull(chatGroupUserMemberships.removedAt),
        ),
      )
      .limit(1);
    if (activeMembership) throw new Error(CHAT_GROUP_MEMBERSHIP_VERSION_CONFLICT);

    return membership;
  };
}
