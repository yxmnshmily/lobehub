import { createHash } from 'node:crypto';

import {
  CHAT_GROUP_INVITATION_ALREADY_PENDING,
  CHAT_GROUP_INVITATION_INVALID,
  CHAT_GROUP_INVITATION_SPONSORSHIP_CONFLICT,
  CHAT_GROUP_INVITEE_INVALID,
  CHAT_GROUP_MEMBERSHIP_ALREADY_ACTIVE,
  CHAT_GROUP_MEMBERSHIP_FORBIDDEN,
  CHAT_GROUP_MEMBERSHIP_PAGINATION_INVALID,
  CHAT_GROUP_MEMBERSHIP_VERSION_CONFLICT,
  ChatGroupUserMembershipModel,
  type LobeChatDatabase,
} from '@lobechat/database';
import { chatGroups, chatGroupUserInvitations, users } from '@lobechat/database/schemas';
import { TRPCError } from '@trpc/server';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  GroupConversationAccessUnavailableError,
  resolveGroupConversationPrincipal,
} from '@/server/services/groupConversationAccess/principal';
import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@/server/services/user/travelServiceGroup';

const GROUP_MEMBERSHIP_UNAVAILABLE = 'GROUP_MEMBERSHIP_UNAVAILABLE';
const GROUP_MEMBERSHIP_CONFLICT = 'GROUP_MEMBERSHIP_CONFLICT';
const GROUP_MEMBERSHIP_INVALID_INPUT = 'GROUP_MEMBERSHIP_INVALID_INPUT';
const GROUP_MEMBERSHIP_OPERATION_FAILED = 'GROUP_MEMBERSHIP_OPERATION_FAILED';

const id = z.string().trim().min(1).max(255);
const page = {
  limit: z.number().int().min(1).max(50).optional(),
  offset: z.number().int().min(0).max(10_000).optional(),
};
const membershipVersion = z.number().int().min(1).max(2_147_483_647);

const unavailable = (): never => {
  throw new TRPCError({ code: 'NOT_FOUND', message: GROUP_MEMBERSHIP_UNAVAILABLE });
};

const personalMembershipProcedure = authedProcedure
  .use(serverDatabase)
  .use(async ({ ctx, next }) => {
    if (ctx.workspaceId) return unavailable();
    return next({ ctx });
  });

const safeDatabaseCall = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: GROUP_MEMBERSHIP_OPERATION_FAILED,
    });
  }
};

const assertOwnerTravelGroup = async (
  db: LobeChatDatabase,
  actorUserId: string,
  groupId: string,
) => {
  const [group] = await safeDatabaseCall(() =>
    db
      .select({ id: chatGroups.id })
      .from(chatGroups)
      .where(
        and(
          eq(chatGroups.id, groupId),
          eq(chatGroups.userId, actorUserId),
          eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
          eq(chatGroups.visibility, 'private'),
          isNull(chatGroups.workspaceId),
        ),
      )
      .limit(1),
  );
  if (!group) return unavailable();
};

const safeModelCall = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === CHAT_GROUP_MEMBERSHIP_PAGINATION_INVALID) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: GROUP_MEMBERSHIP_INVALID_INPUT });
    }
    if (
      [
        CHAT_GROUP_INVITATION_SPONSORSHIP_CONFLICT,
        CHAT_GROUP_MEMBERSHIP_VERSION_CONFLICT,
      ].includes(message)
    ) {
      throw new TRPCError({ code: 'CONFLICT', message: GROUP_MEMBERSHIP_CONFLICT });
    }
    if (
      [
        CHAT_GROUP_INVITATION_ALREADY_PENDING,
        CHAT_GROUP_INVITATION_INVALID,
        CHAT_GROUP_INVITEE_INVALID,
        CHAT_GROUP_MEMBERSHIP_ALREADY_ACTIVE,
        CHAT_GROUP_MEMBERSHIP_FORBIDDEN,
      ].includes(message)
    ) {
      return unavailable();
    }

    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: GROUP_MEMBERSHIP_OPERATION_FAILED,
    });
  }
};

const invitationTokenHash = (token: string) =>
  createHash('sha256').update(token, 'utf8').digest('hex');

const maskEmail = (email: string | null) => {
  if (!email) return null;
  const separator = email.lastIndexOf('@');
  if (separator < 1 || separator === email.length - 1) return null;
  return `${email[0]}***${email.slice(separator)}`;
};

const safeInvitationSponsorship = (invitation: {
  sponsorPeriodLimitCreditsSnapshot: number | null;
  sponsorRequestLimitCreditsSnapshot: number | null;
  sponsorshipModeSnapshot: 'group_owner' | 'none';
}) => {
  const ownerSponsored = Boolean(
    invitation.sponsorshipModeSnapshot === 'group_owner' &&
      invitation.sponsorPeriodLimitCreditsSnapshot &&
      invitation.sponsorRequestLimitCreditsSnapshot,
  );
  return {
    billingResponsibility: ownerSponsored ? ('group_owner' as const) : null,
    maxCreditsPerPeriod: ownerSponsored ? invitation.sponsorPeriodLimitCreditsSnapshot : null,
    maxCreditsPerRequest: ownerSponsored ? invitation.sponsorRequestLimitCreditsSnapshot : null,
  };
};

const assertActiveTravelGroupMember = async (
  db: LobeChatDatabase,
  actorUserId: string,
  groupId: string,
) => {
  let principal: Awaited<ReturnType<typeof resolveGroupConversationPrincipal>>;
  try {
    principal = await resolveGroupConversationPrincipal(db, { actorUserId, groupId });
  } catch (error) {
    if (error instanceof GroupConversationAccessUnavailableError) return unavailable();
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: GROUP_MEMBERSHIP_OPERATION_FAILED,
    });
  }
  if (principal.kind !== 'member') return unavailable();
};

export const groupMembershipRouter = router({
  acceptInvitation: personalMembershipProcedure
    .input(z.object({ token: z.string().min(32).max(128) }).strict())
    .mutation(async ({ ctx, input }) => {
      const [eligible] = await safeDatabaseCall(() =>
        ctx.serverDB
          .select({ groupId: chatGroupUserInvitations.chatGroupId })
          .from(chatGroupUserInvitations)
          .innerJoin(chatGroups, eq(chatGroups.id, chatGroupUserInvitations.chatGroupId))
          .where(
            and(
              eq(chatGroupUserInvitations.tokenHash, invitationTokenHash(input.token)),
              eq(chatGroupUserInvitations.inviteeUserId, ctx.userId),
              eq(chatGroupUserInvitations.inviterUserId, chatGroups.userId),
              eq(chatGroupUserInvitations.status, 'pending'),
              gt(chatGroupUserInvitations.expiresAt, new Date()),
              eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
              eq(chatGroups.visibility, 'private'),
              isNull(chatGroups.workspaceId),
            ),
          )
          .limit(1),
      );
      if (!eligible) return unavailable();

      const result = await safeModelCall(() =>
        new ChatGroupUserMembershipModel(ctx.serverDB, ctx.userId).acceptInvitation(input.token),
      );
      if (result.status !== 'accepted') return unavailable();
      return {
        groupId: result.membership.chatGroupId,
        membershipVersion: result.membership.membershipVersion,
        status: 'accepted' as const,
      };
    }),

  acceptMyInvitation: personalMembershipProcedure
    .input(z.object({ invitationId: id }).strict())
    .mutation(async ({ ctx, input }) => {
      const [eligible] = await safeDatabaseCall(() =>
        ctx.serverDB
          .select({ groupId: chatGroupUserInvitations.chatGroupId })
          .from(chatGroupUserInvitations)
          .innerJoin(chatGroups, eq(chatGroups.id, chatGroupUserInvitations.chatGroupId))
          .where(
            and(
              eq(chatGroupUserInvitations.id, input.invitationId),
              eq(chatGroupUserInvitations.inviteeUserId, ctx.userId),
              eq(chatGroupUserInvitations.inviterUserId, chatGroups.userId),
              eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
              eq(chatGroups.visibility, 'private'),
              isNull(chatGroups.workspaceId),
            ),
          )
          .limit(1),
      );
      if (!eligible) return unavailable();

      const result = await safeModelCall(() =>
        new ChatGroupUserMembershipModel(ctx.serverDB, ctx.userId).acceptInvitationById(
          input.invitationId,
        ),
      );
      if (result.status !== 'accepted') return unavailable();
      return {
        groupId: result.membership.chatGroupId,
        membershipVersion: result.membership.membershipVersion,
        status: 'accepted' as const,
      };
    }),

  createInvitation: personalMembershipProcedure
    .input(z.object({ email: z.string().trim().email().max(320), groupId: id }).strict())
    .mutation(async ({ ctx, input }) => {
      await assertOwnerTravelGroup(ctx.serverDB, ctx.userId, input.groupId);
      const normalizedEmail = input.email.toLowerCase();
      const [invitee] = await safeDatabaseCall(() =>
        ctx.serverDB
          .select({ id: users.id })
          .from(users)
          .where(sql`lower(${users.email}) = ${normalizedEmail}`)
          .limit(1),
      );
      if (!invitee) return unavailable();

      const invitation = await safeModelCall(() =>
        new ChatGroupUserMembershipModel(ctx.serverDB, ctx.userId).createInvitation({
          chatGroupId: input.groupId,
          inviteeUserId: invitee.id,
        }),
      );
      return {
        expiresAt: invitation.expiresAt,
        invitationId: invitation.id,
        status: 'created' as const,
        token: invitation.token,
      };
    }),

  leaveGroup: personalMembershipProcedure
    .input(z.object({ expectedMembershipVersion: membershipVersion, groupId: id }).strict())
    .mutation(async ({ ctx, input }) => {
      await assertActiveTravelGroupMember(ctx.serverDB, ctx.userId, input.groupId);
      const membership = await safeModelCall(() =>
        new ChatGroupUserMembershipModel(ctx.serverDB, ctx.userId).leaveGroup({
          chatGroupId: input.groupId,
          expectedMembershipVersion: input.expectedMembershipVersion,
        }),
      );
      if (!membership) return unavailable();
      return { status: 'left' as const };
    }),

  listMembers: personalMembershipProcedure
    .input(z.object({ ...page, groupId: id }).strict())
    .query(async ({ ctx, input }) => {
      await assertOwnerTravelGroup(ctx.serverDB, ctx.userId, input.groupId);
      const result = await safeModelCall(() =>
        new ChatGroupUserMembershipModel(ctx.serverDB, ctx.userId).listHumanMembers({
          chatGroupId: input.groupId,
          limit: input.limit,
          offset: input.offset,
        }),
      );
      return {
        items: result.items.map((item) => {
          const canUsePaidAi = Boolean(
            item.canUsePaidAi && item.maxCreditsPerPeriod && item.maxCreditsPerRequest,
          );
          return {
            avatar: item.avatar,
            canUsePaidAi,
            displayName: item.displayName,
            joinedAt: item.joinedAt,
            maxCreditsPerPeriod: canUsePaidAi ? item.maxCreditsPerPeriod : null,
            maxCreditsPerRequest: canUsePaidAi ? item.maxCreditsPerRequest : null,
            memberUserId: item.userId,
            membershipVersion: item.membershipVersion,
          };
        }),
        nextOffset: result.nextOffset,
      };
    }),

  listMyPendingInvitations: personalMembershipProcedure
    .input(z.object(page).strict().optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      const offset = input?.offset ?? 0;
      const rows = await safeDatabaseCall(() =>
        ctx.serverDB
          .select({
            avatar: chatGroups.avatar,
            expiresAt: chatGroupUserInvitations.expiresAt,
            groupId: chatGroups.id,
            invitationId: chatGroupUserInvitations.id,
            sponsorPeriodLimitCreditsSnapshot:
              chatGroupUserInvitations.sponsorPeriodLimitCreditsSnapshot,
            sponsorRequestLimitCreditsSnapshot:
              chatGroupUserInvitations.sponsorRequestLimitCreditsSnapshot,
            sponsorshipModeSnapshot: chatGroupUserInvitations.sponsorshipModeSnapshot,
            title: chatGroups.title,
          })
          .from(chatGroupUserInvitations)
          .innerJoin(chatGroups, eq(chatGroups.id, chatGroupUserInvitations.chatGroupId))
          .where(
            and(
              eq(chatGroupUserInvitations.inviteeUserId, ctx.userId),
              eq(chatGroupUserInvitations.inviterUserId, chatGroups.userId),
              eq(chatGroupUserInvitations.status, 'pending'),
              gt(chatGroupUserInvitations.expiresAt, new Date()),
              eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
              eq(chatGroups.visibility, 'private'),
              isNull(chatGroups.workspaceId),
            ),
          )
          .orderBy(asc(chatGroupUserInvitations.id))
          .offset(offset)
          .limit(limit + 1),
      );
      const hasMore = rows.length > limit;
      return {
        items: (hasMore ? rows.slice(0, limit) : rows).map(
          ({
            sponsorPeriodLimitCreditsSnapshot,
            sponsorRequestLimitCreditsSnapshot,
            sponsorshipModeSnapshot,
            ...item
          }) => ({
            ...item,
            sponsorship: safeInvitationSponsorship({
              sponsorPeriodLimitCreditsSnapshot,
              sponsorRequestLimitCreditsSnapshot,
              sponsorshipModeSnapshot,
            }),
          }),
        ),
        nextOffset: hasMore ? offset + limit : null,
      };
    }),

  listPendingInvitations: personalMembershipProcedure
    .input(z.object({ ...page, groupId: id }).strict())
    .query(async ({ ctx, input }) => {
      await assertOwnerTravelGroup(ctx.serverDB, ctx.userId, input.groupId);
      const rows = await safeDatabaseCall(() =>
        ctx.serverDB
          .select({
            email: users.email,
            expiresAt: chatGroupUserInvitations.expiresAt,
            id: chatGroupUserInvitations.id,
            sponsorPeriodLimitCreditsSnapshot:
              chatGroupUserInvitations.sponsorPeriodLimitCreditsSnapshot,
            sponsorRequestLimitCreditsSnapshot:
              chatGroupUserInvitations.sponsorRequestLimitCreditsSnapshot,
            sponsorshipModeSnapshot: chatGroupUserInvitations.sponsorshipModeSnapshot,
            status: chatGroupUserInvitations.status,
          })
          .from(chatGroupUserInvitations)
          .innerJoin(users, eq(users.id, chatGroupUserInvitations.inviteeUserId))
          .where(
            and(
              eq(chatGroupUserInvitations.chatGroupId, input.groupId),
              eq(chatGroupUserInvitations.status, 'pending'),
              gt(chatGroupUserInvitations.expiresAt, new Date()),
            ),
          )
          .orderBy(asc(chatGroupUserInvitations.id))
          .offset(input.offset ?? 0)
          .limit((input.limit ?? 20) + 1),
      );
      const limit = input.limit ?? 20;
      const hasMore = rows.length > limit;
      return {
        items: (hasMore ? rows.slice(0, limit) : rows).map((item) => ({
          expiresAt: item.expiresAt,
          invitationId: item.id,
          maskedEmail: maskEmail(item.email),
          sponsorship: safeInvitationSponsorship(item),
          status: item.status,
        })),
        nextOffset: hasMore ? (input.offset ?? 0) + limit : null,
      };
    }),

  removeMember: personalMembershipProcedure
    .input(
      z
        .object({
          expectedMembershipVersion: membershipVersion,
          groupId: id,
          memberUserId: id,
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      await assertOwnerTravelGroup(ctx.serverDB, ctx.userId, input.groupId);
      const membership = await safeModelCall(() =>
        new ChatGroupUserMembershipModel(ctx.serverDB, ctx.userId).removeMember({
          chatGroupId: input.groupId,
          expectedMembershipVersion: input.expectedMembershipVersion,
          memberUserId: input.memberUserId,
        }),
      );
      if (!membership) return unavailable();
      return { status: 'removed' as const };
    }),

  revokeInvitation: personalMembershipProcedure
    .input(z.object({ groupId: id, invitationId: id }).strict())
    .mutation(async ({ ctx, input }) => {
      await assertOwnerTravelGroup(ctx.serverDB, ctx.userId, input.groupId);
      const result = await safeModelCall(() =>
        new ChatGroupUserMembershipModel(ctx.serverDB, ctx.userId).revokeInvitation({
          chatGroupId: input.groupId,
          invitationId: input.invitationId,
        }),
      );
      if (!result) return unavailable();
      return { status: 'revoked' as const };
    }),
});
