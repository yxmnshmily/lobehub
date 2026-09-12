import { createHash, randomBytes } from 'node:crypto';

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
import {
  agents,
  chatGroupInvitationLinks,
  chatGroups,
  chatGroupsAgents,
  chatGroupUserInvitations,
  chatGroupUserMemberships,
  users,
} from '@lobechat/database/schemas';
import { agentSecondaryDisplayName } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, asc, eq, gt, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentService } from '@/server/services/agent';
import {
  GroupConversationAccessUnavailableError,
  resolveGroupConversationPrincipal,
} from '@/server/services/groupConversationAccess/principal';
import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@/server/services/user/travelServiceGroup';
import { signWechatPage } from '@/server/services/wechatShare';

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
      [CHAT_GROUP_INVITATION_SPONSORSHIP_CONFLICT, CHAT_GROUP_MEMBERSHIP_VERSION_CONFLICT].includes(
        message,
      )
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
  wechatShareConfig: personalMembershipProcedure
    .input(z.object({ groupId: id, url: z.string().url().max(4096) }).strict())
    .query(async ({ ctx, input }) => {
      await assertOwnerTravelGroup(ctx.serverDB, ctx.userId, input.groupId);
      const [group] = await ctx.serverDB
        .select({ title: chatGroups.title })
        .from(chatGroups)
        .where(eq(chatGroups.id, input.groupId))
        .limit(1);
      const signature = await safeDatabaseCall(() => signWechatPage(input.url));
      return { ...signature, title: group?.title };
    }),
  createInvitationLink: personalMembershipProcedure
    .input(z.object({ groupId: id }).strict())
    .mutation(async ({ ctx, input }) => {
      await assertOwnerTravelGroup(ctx.serverDB, ctx.userId, input.groupId);
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await safeDatabaseCall(() =>
        ctx.serverDB.insert(chatGroupInvitationLinks).values({
          chatGroupId: input.groupId,
          inviterUserId: ctx.userId,
          tokenHash: invitationTokenHash(token),
          expiresAt,
        }),
      );
      return { token, expiresAt };
    }),

  revokeInvitationLinks: personalMembershipProcedure
    .input(z.object({ groupId: id }).strict())
    .mutation(async ({ ctx, input }) => {
      await assertOwnerTravelGroup(ctx.serverDB, ctx.userId, input.groupId);
      await safeDatabaseCall(() =>
        ctx.serverDB.transaction(async (tx) => {
          await tx
            .select({ id: chatGroups.id })
            .from(chatGroups)
            .where(eq(chatGroups.id, input.groupId))
            .for('update');
          await tx
            .update(chatGroupInvitationLinks)
            .set({ revokedAt: new Date() })
            .where(
              and(
                eq(chatGroupInvitationLinks.chatGroupId, input.groupId),
                eq(chatGroupInvitationLinks.inviterUserId, ctx.userId),
                isNull(chatGroupInvitationLinks.revokedAt),
              ),
            );
        }),
      );
      return { status: 'revoked' as const };
    }),

  previewInvitationLink: publicProcedure
    .use(serverDatabase)
    .input(z.object({ token: z.string().regex(/^[\w-]{43}$/) }).strict())
    .query(async ({ ctx, input }) => {
      const [link] = await safeDatabaseCall(() =>
        ctx.serverDB
          .select({ title: chatGroups.title })
          .from(chatGroupInvitationLinks)
          .innerJoin(chatGroups, eq(chatGroups.id, chatGroupInvitationLinks.chatGroupId))
          .where(
            and(
              eq(chatGroupInvitationLinks.tokenHash, invitationTokenHash(input.token)),
              eq(chatGroupInvitationLinks.inviterUserId, chatGroups.userId),
              gt(chatGroupInvitationLinks.expiresAt, new Date()),
              isNull(chatGroupInvitationLinks.revokedAt),
              eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
              eq(chatGroups.visibility, 'private'),
              isNull(chatGroups.workspaceId),
              isNull(chatGroups.deletedAt),
            ),
          )
          .limit(1),
      );
      if (!link) return unavailable();
      return link;
    }),

  joinInvitationLink: personalMembershipProcedure
    .input(z.object({ token: z.string().regex(/^[\w-]{43}$/) }).strict())
    .mutation(async ({ ctx, input }) =>
      safeDatabaseCall(() =>
        ctx.serverDB.transaction(async (tx) => {
          const tokenHash = invitationTokenHash(input.token);
          const [candidate] = await tx
            .select()
            .from(chatGroupInvitationLinks)
            .where(eq(chatGroupInvitationLinks.tokenHash, tokenHash))
            .limit(1);
          if (!candidate) return unavailable();
          // Serialize joins/removals with the group, then recheck link validity under its own lock.
          const [group] = await tx
            .select()
            .from(chatGroups)
            .where(
              and(
                eq(chatGroups.id, candidate.chatGroupId),
                eq(chatGroups.userId, candidate.inviterUserId),
                eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
                eq(chatGroups.visibility, 'private'),
                isNull(chatGroups.workspaceId),
                isNull(chatGroups.deletedAt),
              ),
            )
            .for('update');
          if (!group) return unavailable();
          const [link] = await tx
            .select()
            .from(chatGroupInvitationLinks)
            .where(
              and(
                eq(chatGroupInvitationLinks.tokenHash, tokenHash),
                gt(chatGroupInvitationLinks.expiresAt, new Date()),
                isNull(chatGroupInvitationLinks.revokedAt),
              ),
            )
            .for('update');
          if (!link) return unavailable();
          if (group.userId === ctx.userId) return { groupId: group.id };
          const [existing] = await tx
            .select()
            .from(chatGroupUserMemberships)
            .where(
              and(
                eq(chatGroupUserMemberships.chatGroupId, group.id),
                eq(chatGroupUserMemberships.userId, ctx.userId),
              ),
            );
          // A forwarded link must not undo the owner's removal of a member.
          if (existing?.removedAt) return unavailable();
          if (!existing)
            await tx.insert(chatGroupUserMemberships).values({
              chatGroupId: group.id,
              userId: ctx.userId,
              invitedByUserId: group.userId,
            });
          return { groupId: group.id };
        }),
      ),
    ),

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
    .input(
      z.union([
        z.object({ email: z.string().trim().email().max(320), groupId: id }).strict(),
        z
          .object({
            contact: z
              .string()
              .trim()
              .min(1)
              .max(320)
              .refine(
                (value) =>
                  z.string().email().safeParse(value).success ||
                  /^\+?\d[\d ()-]{5,24}$/.test(value) ||
                  /^[\w-]{1,128}$/.test(value),
              ),
            groupId: id,
          })
          .strict(),
      ]),
    )
    .mutation(async ({ ctx, input }) => {
      await assertOwnerTravelGroup(ctx.serverDB, ctx.userId, input.groupId);
      const contact = 'email' in input ? input.email : input.contact;
      const isEmail = contact.includes('@');
      const isPhone = /^\+?\d[\d ()-]{5,24}$/.test(contact);
      const phone = contact.replaceAll(/[ ()-]/g, '');
      // Local Chinese numbers and their +86 spelling identify the same account.
      const phoneVariants = /^1[3-9]\d{9}$/.test(phone)
        ? [phone, `+86${phone}`]
        : /^\+861[3-9]\d{9}$/.test(phone)
          ? [phone, phone.slice(3)]
          : [phone];
      const invitees = await safeDatabaseCall(() =>
        ctx.serverDB
          .select({ id: users.id })
          .from(users)
          .where(
            isEmail
              ? sql`lower(${users.email}) = ${contact.toLowerCase()}`
              : !isPhone
                ? eq(users.id, contact)
                : or(
                    ...phoneVariants.map(
                      (value) => sql`regexp_replace(${users.phone}, '[ ()-]', '', 'g') = ${value}`,
                    ),
                  ),
          )
          .limit(2),
      );
      // Never pick an arbitrary recipient when legacy contact records are ambiguous.
      if (invitees.length !== 1) return unavailable();
      const [invitee] = invitees;

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
            ownerDisplayName: sql<
              string | null
            >`coalesce(nullif(trim(${users.fullName}), ''), nullif(trim(${users.username}), ''))`,
            sponsorPeriodLimitCreditsSnapshot:
              chatGroupUserInvitations.sponsorPeriodLimitCreditsSnapshot,
            sponsorRequestLimitCreditsSnapshot:
              chatGroupUserInvitations.sponsorRequestLimitCreditsSnapshot,
            sponsorshipModeSnapshot: chatGroupUserInvitations.sponsorshipModeSnapshot,
            title: chatGroups.title,
          })
          .from(chatGroupUserInvitations)
          .innerJoin(chatGroups, eq(chatGroups.id, chatGroupUserInvitations.chatGroupId))
          .innerJoin(users, eq(users.id, chatGroups.userId))
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
            billingMode: 'automatic_owner' as const,
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

  listParticipants: personalMembershipProcedure
    .input(z.object({ ...page, groupId: id }).strict())
    .query(async ({ ctx, input }) => {
      let principal: Awaited<ReturnType<typeof resolveGroupConversationPrincipal>>;
      try {
        principal = await resolveGroupConversationPrincipal(ctx.serverDB, {
          actorUserId: ctx.userId,
          groupId: input.groupId,
        });
      } catch (error) {
        if (error instanceof GroupConversationAccessUnavailableError) return unavailable();
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: GROUP_MEMBERSHIP_OPERATION_FAILED,
        });
      }
      const result = await safeModelCall(() =>
        new ChatGroupUserMembershipModel(ctx.serverDB, ctx.userId).listParticipants({
          chatGroupId: input.groupId,
          limit: input.limit,
          offset: input.offset,
        }),
      );
      const assistants = await safeDatabaseCall(() =>
        ctx.serverDB
          .select({
            avatar: agents.avatar,
            description: agents.description,
            id: agents.id,
            isSupervisor: sql<boolean>`${chatGroupsAgents.role} = 'supervisor'`,
            name: agents.name,
            pinned: agents.pinned,
            sessionGroupId: agents.sessionGroupId,
            roleTitle: agents.title,
            tags: agents.tags,
            updatedAt: agents.updatedAt,
            model: agents.model,
            provider: agents.provider,
            title: sql<
              string | null
            >`case when ${chatGroupsAgents.role} = 'supervisor' then '旅游群' else coalesce(nullif(trim(${agents.name}), ''), ${agents.title}) end`,
          })
          .from(chatGroups)
          .innerJoin(
            chatGroupsAgents,
            and(
              eq(chatGroupsAgents.chatGroupId, chatGroups.id),
              eq(chatGroupsAgents.userId, chatGroups.userId),
              isNull(chatGroupsAgents.workspaceId),
              eq(chatGroupsAgents.enabled, true),
            ),
          )
          .innerJoin(
            agents,
            and(
              eq(agents.id, chatGroupsAgents.agentId),
              eq(agents.userId, chatGroups.userId),
              isNull(agents.workspaceId),
            ),
          )
          .leftJoin(
            chatGroupUserMemberships,
            and(
              eq(chatGroupUserMemberships.chatGroupId, chatGroups.id),
              eq(chatGroupUserMemberships.userId, ctx.userId),
              isNull(chatGroupUserMemberships.removedAt),
              eq(chatGroupUserMemberships.role, 'member'),
            ),
          )
          .where(
            and(
              eq(chatGroups.id, input.groupId),
              eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
              eq(chatGroups.visibility, 'private'),
              isNull(chatGroups.workspaceId),
              or(eq(chatGroups.userId, ctx.userId), isNotNull(chatGroupUserMemberships.userId)),
            ),
          )
          .orderBy(asc(chatGroupsAgents.order), asc(agents.id)),
      );
      const agentService = new AgentService(ctx.serverDB, principal.resourceOwnerUserId);
      const resolvedAssistants = await safeDatabaseCall(() =>
        Promise.all(
          assistants.map(async (agent) => {
            if (agent.model?.trim() && agent.provider?.trim()) return agent;
            const config = await agentService.getAgentConfig(agent.id);
            return { ...agent, model: config?.model ?? null, provider: config?.provider ?? null };
          }),
        ),
      );
      return {
        ...result,
        assistants: resolvedAssistants.map(
          ({ name, roleTitle, pinned, sessionGroupId, ...agent }) => {
            const subtitle = agentSecondaryDisplayName({ name, title: roleTitle });
            return {
              ...agent,
              ...(subtitle ? { subtitle } : {}),
              ...(principal.kind === 'owner' ? { pinned, sessionGroupId } : {}),
            };
          },
        ),
        viewerMembershipVersion: principal.membershipVersion,
        viewerRole: principal.kind,
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
