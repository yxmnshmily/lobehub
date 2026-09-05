import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';

import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  PlatformAdminOperationAuditModel,
  PlatformAdminOperationAuditQueryError,
} from '@/database/models/platformAdminOperationAudit';
import {
  PlatformUserContentModel,
  PlatformUserContentQueryError,
} from '@/database/models/platformUserContent';
import {
  PlatformUserGroupAdminModel,
  PlatformUserGroupAdminQueryError,
} from '@/database/models/platformUserGroupAdmin';
import {
  type PlatformUserBanState,
  PlatformUserOperationsError,
  type PlatformUserOperationsItem,
  PlatformUserOperationsModel,
} from '@/database/models/platformUserOperations';
import { UserModel } from '@/database/models/user';
import {
  chatGroups,
  chatGroupsAgents,
  platformCreditAccounts,
  session as authSessions,
  travelGenerationTasks,
  users,
} from '@/database/schemas';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  PLATFORM_AUTH_REVOCATION_RETRY_MESSAGE,
  PlatformAuthRevocationError,
  PlatformAuthRevocationService,
} from '@/server/services/platformAuthRevocation';
import {
  type PlatformModerationCategory,
  scanPlatformContent,
} from '@/server/services/platformModeration';
import {
  PLATFORM_USER_ACCOUNT_ADMIN_RETRY_MESSAGE,
  PlatformUserAccountAdministrationError,
  PlatformUserAccountAdministrationService,
} from '@/server/services/platformUserAccountAdministration';
import {
  buildDefaultTravelServiceGroupRepairPlan,
  DEFAULT_TRAVEL_SERVICE_GROUP_HEALTH_ISSUE_CODES,
  DEFAULT_TRAVEL_SERVICE_GROUP_REPAIR_ACTION_CODES,
  type DefaultTravelServiceGroupHealthSummary,
  type DefaultTravelServiceGroupRepairPlan,
  executeDefaultTravelServiceGroupRepairPlan,
  getDefaultTravelServiceGroupHealthSummary,
  SAFE_DEFAULT_TRAVEL_SERVICE_GROUP_REPAIR_ACTION_CODES,
  TRAVEL_GROUP_REPAIR_ACTION_NOT_ALLOWED,
  TRAVEL_GROUP_REPAIR_REVIEW_REQUIRED,
  TRAVEL_GROUP_REPAIR_SCOPE_INVALID,
  TRAVEL_GROUP_REPAIR_STATE_CHANGED,
} from '@/server/services/user/travelServiceGroup';

import { hasActivePlatformAdminAccess, requirePlatformAdmin } from './_helpers/platformAdminGuard';

const platformOperationsProcedure = authedProcedure.use(serverDatabase).use(requirePlatformAdmin);

const targetUserIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), 'targetUserId contains control characters');
const groupIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), 'groupId contains control characters');
const operationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), 'operationId contains control characters')
  .optional();
const auditActionSchema = z.enum([
  'user.banned',
  'user.password_reset_requested',
  'user.profile_updated',
  'user.sessions_revoked',
  'user.travel_group_repaired',
  'user.unbanned',
]);
const contentKindSchema = z.enum(['document', 'generation', 'work']);
const fullNameSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => Array.from(value).length <= 100, 'fullName is too long')
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), 'fullName contains control characters');
const avatarSchema = z.union([
  z.null(),
  z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
      );
    }, 'avatar must be an http or https URL without credentials'),
]);
const banReasonSchema = z.string().trim().min(1).max(500);
const banExpiresSchema = z.date().refine((value) => value.getTime() > Date.now(), {
  message: 'banExpires must be in the future',
});
const sessionCursorPattern = /^[\w-]{1,512}$/;
const sensitiveBanReasonCategories = new Set<PlatformModerationCategory>([
  'credential',
  'email',
  'government_id',
  'phone',
]);
const travelGroupHealthIssueCodes: ReadonlySet<string> = new Set(
  DEFAULT_TRAVEL_SERVICE_GROUP_HEALTH_ISSUE_CODES,
);
const travelGroupRepairActionCodeValues = DEFAULT_TRAVEL_SERVICE_GROUP_REPAIR_ACTION_CODES;
type TravelGroupRepairActionCode = (typeof travelGroupRepairActionCodeValues)[number];
const travelGroupRepairActionCodes: ReadonlySet<string> = new Set(
  travelGroupRepairActionCodeValues,
);
const safeTravelGroupRepairActionCodes: ReadonlySet<string> = new Set(
  SAFE_DEFAULT_TRAVEL_SERVICE_GROUP_REPAIR_ACTION_CODES,
);
const travelGroupRepairPlanFingerprintSchema = z.string().regex(/^[a-f\d]{64}$/);
const travelGroupRepairPreconditionErrors = new Set([
  TRAVEL_GROUP_REPAIR_ACTION_NOT_ALLOWED,
  TRAVEL_GROUP_REPAIR_REVIEW_REQUIRED,
  TRAVEL_GROUP_REPAIR_SCOPE_INVALID,
  TRAVEL_GROUP_REPAIR_STATE_CHANGED,
]);

interface SafeTravelGroupRepairResult {
  actionCounts: Array<{
    code: (typeof SAFE_DEFAULT_TRAVEL_SERVICE_GROUP_REPAIR_ACTION_CODES)[number];
    count: number;
  }>;
  ready: true;
  reviewRequired: false;
}

const activeTravelGroupRepairs = new Map<string, Promise<SafeTravelGroupRepairResult>>();

const assertBanReasonContainsNoSensitiveInformation = (reason: string): void => {
  const { findings } = scanPlatformContent({ text: reason });
  if (findings.some(({ category }) => sensitiveBanReasonCategories.has(category))) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Ban reason must not contain sensitive information',
    });
  }
};

const redactUiText = (value: string | null): string | null =>
  value === null ? null : scanPlatformContent({ text: value }).preview;

const redactAvatar = (value: string | null): string | null => {
  if (value === null) return null;
  const { findings } = scanPlatformContent({ text: value });
  return findings.some(({ category }) => sensitiveBanReasonCategories.has(category)) ? null : value;
};

const safeSummaryCount = (value: number | bigint): number => {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error('Invalid platform user summary count');
  }
  return normalized;
};

const assertMutationAdministratorIsStillActive = async (
  db: Parameters<typeof hasActivePlatformAdminAccess>[0],
  operatorUserId: string,
): Promise<void> => {
  let authorized: boolean;
  try {
    authorized = await hasActivePlatformAdminAccess(db, operatorUserId);
  } catch {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Unable to verify platform administrator access. Please try again.',
    });
  }
  if (!authorized) {
    throw new PlatformUserOperationsError('FORBIDDEN', 'Platform administrator access is required');
  }
};

const assertMutationTargetExists = async (
  db: Parameters<typeof UserModel.findById>[0],
  targetUserId: string,
): Promise<void> => {
  let targetExists: boolean;
  try {
    targetExists = !!(await UserModel.findById(db, targetUserId));
  } catch {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Unable to verify the target user. Please try again.',
    });
  }
  if (!targetExists) {
    throw new PlatformUserOperationsError('USER_NOT_FOUND', 'Target user was not found');
  }
};

const assertMutationTargetIsActive = async (
  db: Parameters<typeof UserModel.findById>[0],
  targetUserId: string,
): Promise<void> => {
  let target: Awaited<ReturnType<typeof UserModel.findById>>;
  try {
    target = await UserModel.findById(db, targetUserId);
  } catch {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Unable to verify the target user. Please try again.',
    });
  }
  if (!target) {
    throw new PlatformUserOperationsError('USER_NOT_FOUND', 'Target user was not found');
  }
  if (target.banned === true) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'The target user must be active before repairing their private travel group',
    });
  }
};

const getTravelGroupRepairPlanFingerprint = (
  targetUserId: string,
  health: DefaultTravelServiceGroupHealthSummary,
  plan: DefaultTravelServiceGroupRepairPlan,
): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        health: {
          groupCount: health.groupCount,
          healthy: health.healthy,
          isPrivate: health.isPrivate,
          issueCodes: health.issueCodes,
          requiredMembers: health.requiredMembers,
          supervisor: health.supervisor,
        },
        plan: {
          actions: plan.actions.map(({ code, reviewRequired, target }) => ({
            code,
            reviewRequired,
            target,
          })),
          reviewRequired: plan.reviewRequired,
        },
        targetUserId,
        version: 1,
      }),
    )
    .digest('hex');

const isExecutableTravelGroupRepairPlan = (plan: DefaultTravelServiceGroupRepairPlan): boolean =>
  plan.actions.length > 0 &&
  !plan.reviewRequired &&
  plan.actions.every(
    ({ code, reviewRequired }) => !reviewRequired && safeTravelGroupRepairActionCodes.has(code),
  );

const throwTravelGroupRepairError = (error: unknown): never => {
  if (error instanceof TRPCError) throw error;
  if (error instanceof PlatformUserOperationsError) throwPlatformUserOperationError(error);
  if (error instanceof Error && travelGroupRepairPreconditionErrors.has(error.message)) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'The private travel-group repair preview is no longer safe to execute',
    });
  }
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Unable to repair the private travel group. Please try again.',
  });
};

const toSafeUserBanState = (state: PlatformUserBanState) => ({
  banExpires: state.banExpires,
  banned: state.banned,
  banReason: redactUiText(state.banReason),
  id: state.id,
});

const throwPlatformUserOperationError = (error: unknown): never => {
  if (error instanceof PlatformAuthRevocationError) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: PLATFORM_AUTH_REVOCATION_RETRY_MESSAGE,
    });
  }
  if (error instanceof PlatformUserAccountAdministrationError) {
    const code =
      error.code === 'USER_NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'OPERATION_FAILED'
          ? 'INTERNAL_SERVER_ERROR'
          : 'BAD_REQUEST';
    throw new TRPCError({
      code,
      message:
        error.code === 'OPERATION_FAILED'
          ? PLATFORM_USER_ACCOUNT_ADMIN_RETRY_MESSAGE
          : error.message,
    });
  }
  if (!(error instanceof PlatformUserOperationsError)) throw error;
  const code =
    error.code === 'FORBIDDEN'
      ? 'FORBIDDEN'
      : error.code === 'USER_NOT_FOUND'
        ? 'NOT_FOUND'
        : 'BAD_REQUEST';
  throw new TRPCError({ code, message: error.message });
};

const throwPlatformUserQueryError = (): never => {
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Unable to load platform user information. Please try again.',
  });
};

const throwPlatformSessionRevocationError = (error: unknown): never => {
  if (error instanceof PlatformUserOperationsError) throwPlatformUserOperationError(error);
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Unable to revoke user sessions. Please try again.',
  });
};

const encodeSessionCursor = (updatedAt: Date, id: string): string =>
  Buffer.from(JSON.stringify([updatedAt.toISOString(), id])).toString('base64url');

const decodeSessionCursor = (cursor: string): { id: string; updatedAt: Date } => {
  if (!sessionCursorPattern.test(cursor)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'cursor is invalid' });
  }
  try {
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) throw new Error('non-canonical-cursor');
    const decoded: unknown = JSON.parse(bytes.toString('utf8'));
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      typeof decoded[0] !== 'string' ||
      typeof decoded[1] !== 'string' ||
      !decoded[1] ||
      decoded[1].length > 255
    ) {
      throw new Error('invalid-cursor-payload');
    }
    const updatedAt = new Date(decoded[0]);
    if (!Number.isFinite(updatedAt.getTime()) || updatedAt.toISOString() !== decoded[0]) {
      throw new Error('invalid-cursor-time');
    }
    return { id: decoded[1], updatedAt };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'cursor is invalid' });
  }
};

const toSafeUserOperationsItem = (item: PlatformUserOperationsItem) => ({
  avatar: redactAvatar(item.avatar),
  banExpires: item.banExpires,
  banned: item.banned,
  banReason: redactUiText(item.banReason),
  createdAt: item.createdAt,
  email: item.email,
  emailVerified: item.emailVerified,
  fullName: redactUiText(item.fullName),
  id: item.id,
  lastActiveAt: item.lastActiveAt,
  latestSessionAt: item.latestSessionAt,
  latestSessionIp: item.latestSessionIp,
  // This is the existing CNY travel-service ledger. Model-usage Credits use a
  // separate settlement path and must not be inferred from these fen values.
  travelServiceLedger: {
    balanceFen: item.balanceFen,
    currency: 'CNY' as const,
    totalConsumptionFen: item.totalConsumptionFen,
  },
  username: redactUiText(item.username),
});

export const platformOperationsRouter = router({
  banUser: platformOperationsProcedure
    .input(
      z
        .object({
          banExpires: banExpiresSchema.optional(),
          operationId: operationIdSchema,
          reason: banReasonSchema,
          targetUserId: targetUserIdSchema,
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        assertBanReasonContainsNoSensitiveInformation(input.reason);
        if (input.targetUserId === ctx.userId) {
          throw new PlatformUserOperationsError(
            'SELF_BAN_FORBIDDEN',
            'An administrator cannot ban their own account',
          );
        }
        await assertMutationAdministratorIsStillActive(ctx.serverDB, ctx.userId);
        await assertMutationTargetExists(ctx.serverDB, input.targetUserId);
        const operationId = input.operationId ?? randomUUID();
        const state = await new PlatformUserOperationsModel(ctx.serverDB, ctx.userId).banUser({
          ...input,
          operationId,
        });
        await new PlatformAuthRevocationService(ctx.serverDB).revokeUser(input.targetUserId, {
          operationId,
          operatorUserId: ctx.userId,
        });
        return toSafeUserBanState(state);
      } catch (error) {
        throwPlatformUserOperationError(error);
      }
    }),

  forceUserPasswordReset: platformOperationsProcedure
    .input(z.object({ operationId: operationIdSchema, targetUserId: targetUserIdSchema }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        const operationId = input.operationId ?? randomUUID();
        if (input.targetUserId === ctx.userId) {
          throw new PlatformUserAccountAdministrationError(
            'SELF_OPERATION_FORBIDDEN',
            'Administrators must use their personal account settings for their own profile',
          );
        }
        await assertMutationAdministratorIsStillActive(ctx.serverDB, ctx.userId);
        await assertMutationTargetExists(ctx.serverDB, input.targetUserId);
        const result = await new PlatformUserAccountAdministrationService(
          ctx.serverDB,
        ).forcePasswordReset({
          operationId,
          operatorUserId: ctx.userId,
          targetUserId: input.targetUserId,
        });
        return { id: result.id, resetRequested: true as const };
      } catch (error) {
        throwPlatformUserOperationError(error);
      }
    }),

  getUserOverview: platformOperationsProcedure
    .input(
      z
        .object({
          recentLimit: z.number().int().min(1).max(50).optional(),
          userId: targetUserIdSchema,
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      let targetExists: boolean;
      try {
        targetExists = !!(await UserModel.findById(ctx.serverDB, input.userId));
      } catch {
        throwPlatformUserQueryError();
      }
      if (!targetExists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Target user was not found' });
      }

      let overview: Awaited<ReturnType<PlatformUserContentModel['getOverview']>>;
      try {
        overview = await new PlatformUserContentModel(ctx.serverDB).getOverview(input.userId, {
          recentLimit: input.recentLimit,
        });
      } catch {
        throwPlatformUserQueryError();
      }

      return {
        generation: {
          statusCounts: overview.generation.statusCounts.map(({ count, status }) => ({
            count,
            status,
          })),
          total: overview.generation.total,
        },
        recentDocuments: overview.recentDocuments.map((document) => ({
          createdAt: document.createdAt,
          fileType: document.fileType,
          id: document.id,
          parentId: document.parentId,
          title: redactUiText(document.title),
          totalCharCount: document.totalCharCount,
          totalLineCount: document.totalLineCount,
          updatedAt: document.updatedAt,
        })),
        recentWorks: overview.recentWorks.map((work) => ({
          createdAt: work.createdAt,
          id: work.id,
          resourceType: work.resourceType,
          status: work.status,
          title: redactUiText(work.title),
          type: work.type,
          updatedAt: work.updatedAt,
        })),
        travelGroup: {
          expectedMemberCount: overview.travelGroup.expectedMemberCount,
          id: overview.travelGroup.id,
          memberCount: overview.travelGroup.memberCount,
          readiness: overview.travelGroup.readiness,
          ready: overview.travelGroup.ready,
          supervisorCount: overview.travelGroup.supervisorCount,
          title: redactUiText(overview.travelGroup.title),
          updatedAt: overview.travelGroup.updatedAt,
        },
      };
    }),

  getUserSummaries: platformOperationsProcedure
    .input(
      z
        .object({
          userIds: z.array(targetUserIdSchema).min(1).max(50),
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      const requestedUserIds = [...new Set(input.userIds)];

      try {
        const existingUsers = await ctx.serverDB
          .select({ id: users.id })
          .from(users)
          .where(inArray(users.id, requestedUserIds));
        const existingUserIds = new Set(existingUsers.map(({ id }) => id));
        const orderedUserIds = requestedUserIds.filter((id) => existingUserIds.has(id));
        if (orderedUserIds.length === 0) return { items: [] };

        const [accounts, generationCounts, groups] = await Promise.all([
          ctx.serverDB
            .select({
              balanceCredits: platformCreditAccounts.balanceCredits,
              userId: platformCreditAccounts.userIdSnapshot,
            })
            .from(platformCreditAccounts)
            .where(inArray(platformCreditAccounts.userIdSnapshot, orderedUserIds)),
          ctx.serverDB
            .select({
              count: count(travelGenerationTasks.id),
              userId: travelGenerationTasks.userId,
            })
            .from(travelGenerationTasks)
            .where(
              and(
                inArray(travelGenerationTasks.userId, orderedUserIds),
                isNull(travelGenerationTasks.workspaceId),
              ),
            )
            .groupBy(travelGenerationTasks.userId),
          ctx.serverDB
            .select({
              config: chatGroups.config,
              content: chatGroups.content,
              id: chatGroups.id,
              userId: chatGroups.userId,
            })
            .from(chatGroups)
            .where(
              and(
                inArray(chatGroups.userId, orderedUserIds),
                eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
                isNull(chatGroups.workspaceId),
                eq(chatGroups.visibility, 'private'),
              ),
            ),
        ]);

        const groupIds = groups.map(({ id }) => id);
        const memberships =
          groupIds.length === 0
            ? []
            : await ctx.serverDB
                .select({
                  agentId: chatGroupsAgents.agentId,
                  chatGroupId: chatGroupsAgents.chatGroupId,
                  role: chatGroupsAgents.role,
                })
                .from(chatGroupsAgents)
                .where(
                  and(
                    inArray(chatGroupsAgents.chatGroupId, groupIds),
                    inArray(chatGroupsAgents.userId, orderedUserIds),
                    eq(chatGroupsAgents.enabled, true),
                    isNull(chatGroupsAgents.workspaceId),
                  ),
                );
        const accountByUserId = new Map(
          accounts.map(({ balanceCredits, userId }) => [userId, safeSummaryCount(balanceCredits)]),
        );
        const generationCountByUserId = new Map(
          generationCounts.map((row) => [row.userId, safeSummaryCount(row.count)]),
        );
        const groupByUserId = new Map(groups.map((group) => [group.userId, group]));
        const membershipsByGroupId = new Map<
          string,
          Array<{ agentId: string; role: string | null }>
        >();
        for (const membership of memberships) {
          const current = membershipsByGroupId.get(membership.chatGroupId) ?? [];
          current.push({ agentId: membership.agentId, role: membership.role });
          membershipsByGroupId.set(membership.chatGroupId, current);
        }

        return {
          items: orderedUserIds.map((userId) => {
            const group = groupByUserId.get(userId);
            let groupReadiness: 'incomplete' | 'missing' | 'ready' = 'missing';
            if (group) {
              const groupMemberships = membershipsByGroupId.get(group.id) ?? [];
              const slots = group.config?.memberSlots ?? [];
              const activeAgentIds = new Set(groupMemberships.map(({ agentId }) => agentId));
              const supervisorMemberships = groupMemberships.filter(
                ({ role }) => role === 'supervisor',
              );
              const supervisorSlots = slots.filter(({ role }) => role === 'supervisor');
              const everySlotReady =
                slots.length > 0 &&
                slots.every(
                  ({ agentId, status }) =>
                    status === 'configured' && Boolean(agentId) && activeAgentIds.has(agentId!),
                );
              const supervisorReady =
                supervisorMemberships.length === 1 &&
                supervisorSlots.length === 1 &&
                Boolean(supervisorSlots[0].agentId) &&
                supervisorMemberships[0].agentId === supervisorSlots[0].agentId;
              groupReadiness =
                Boolean(group.content?.trim()) && everySlotReady && supervisorReady
                  ? 'ready'
                  : 'incomplete';
            }

            return {
              balanceCredits: accountByUserId.get(userId) ?? 0,
              generationTotal: generationCountByUserId.get(userId) ?? 0,
              groupReadiness,
              userId,
            };
          }),
        };
      } catch {
        throwPlatformUserQueryError();
      }
    }),

  getUserPrivateGroupMembers: platformOperationsProcedure
    .input(
      z
        .object({
          cursor: z.string().trim().min(1).max(1024).optional(),
          groupId: groupIdSchema,
          limit: z.number().int().min(1).max(50).optional(),
          targetUserId: targetUserIdSchema,
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      try {
        const result = await new PlatformUserGroupAdminModel(ctx.serverDB).getPrivateGroupMembers(
          input.targetUserId,
          input.groupId,
          input.cursor,
          input.limit,
        );
        if (!result) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Private group was not found' });
        }

        return {
          items: result.items.map((item) => ({
            agentId: item.agentId,
            avatar: redactAvatar(item.avatar),
            clientId: item.clientId,
            description: redactUiText(item.description),
            enabled: item.enabled,
            name: redactUiText(item.name),
            order: item.order,
            role: item.role,
          })),
          nextCursor: result.nextCursor,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        if (error instanceof PlatformUserGroupAdminQueryError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
        }
        throwPlatformUserQueryError();
      }
    }),

  listUserPrivateGroups: platformOperationsProcedure
    .input(
      z
        .object({
          cursor: z.string().trim().min(1).max(1024).optional(),
          limit: z.number().int().min(1).max(50).optional(),
          targetUserId: targetUserIdSchema,
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      try {
        const result = await new PlatformUserGroupAdminModel(ctx.serverDB).listPrivateGroups(
          input.targetUserId,
          input.cursor,
          input.limit,
        );

        return {
          items: result.items.map((item) => ({
            avatar: redactAvatar(item.avatar),
            clientId: item.clientId,
            createdAt: item.createdAt,
            description: redactUiText(item.description),
            id: item.id,
            title: redactUiText(item.title),
            updatedAt: item.updatedAt,
          })),
          nextCursor: result.nextCursor,
        };
      } catch (error) {
        if (error instanceof PlatformUserGroupAdminQueryError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
        }
        throwPlatformUserQueryError();
      }
    }),

  getUserTravelGroupHealthOverview: platformOperationsProcedure
    .input(z.object({ targetUserId: targetUserIdSchema }).strict())
    .query(async ({ ctx, input }) => {
      let targetExists: boolean;
      try {
        targetExists = !!(await UserModel.findById(ctx.serverDB, input.targetUserId));
      } catch {
        throwPlatformUserQueryError();
      }
      if (!targetExists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Target user was not found' });
      }

      try {
        const health = await getDefaultTravelServiceGroupHealthSummary(ctx.serverDB, {
          targetUserId: input.targetUserId,
        });
        const plan = buildDefaultTravelServiceGroupRepairPlan(health);
        const hasUnknownIssue = health.issueCodes.some(
          (code) => !travelGroupHealthIssueCodes.has(code),
        );
        const hasUnknownAction = plan.actions.some(
          ({ code }) => !travelGroupRepairActionCodes.has(code),
        );
        const safeActions: Array<{ code: TravelGroupRepairActionCode }> =
          hasUnknownIssue || hasUnknownAction
            ? [{ code: 'UNKNOWN_ISSUE_REVIEW_REQUIRED' as const }]
            : plan.actions;
        const actionCountMap = new Map<TravelGroupRepairActionCode, number>();
        for (const { code } of safeActions) {
          actionCountMap.set(code, (actionCountMap.get(code) ?? 0) + 1);
        }

        return {
          actionCounts: [...actionCountMap].map(([code, count]) => ({ code, count })),
          canRepair:
            !hasUnknownIssue && !hasUnknownAction && isExecutableTravelGroupRepairPlan(plan),
          issueCodes: health.issueCodes.filter((code) => travelGroupHealthIssueCodes.has(code)),
          planFingerprint: getTravelGroupRepairPlanFingerprint(input.targetUserId, health, plan),
          ready: health.healthy && !hasUnknownIssue && !hasUnknownAction,
          reviewRequired: plan.reviewRequired || hasUnknownIssue || hasUnknownAction,
        };
      } catch {
        throwPlatformUserQueryError();
      }
    }),

  getUserContentCatalog: platformOperationsProcedure
    .input(
      z
        .object({
          cursor: z.string().trim().min(1).max(1024).optional(),
          endAt: z.date().optional(),
          kind: contentKindSchema,
          limit: z.number().int().min(1).max(50).optional(),
          startAt: z.date().optional(),
          status: z.string().trim().min(1).max(100).optional(),
          targetUserId: targetUserIdSchema,
          type: z.string().trim().min(1).max(100).optional(),
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      let targetExists: boolean;
      try {
        targetExists = !!(await UserModel.findById(ctx.serverDB, input.targetUserId));
      } catch {
        throwPlatformUserQueryError();
      }
      if (!targetExists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Target user was not found' });
      }

      try {
        const result = await new PlatformUserContentModel(ctx.serverDB).listContentCatalog(
          input.targetUserId,
          input,
        );
        return {
          counts: {
            documents: result.counts.documents,
            generationTasks: result.counts.generationTasks,
            works: result.counts.works,
          },
          items: result.items.map((item) => ({
            createdAt: item.createdAt,
            filename: redactUiText(item.filename),
            id: item.id,
            kind: item.kind,
            status: item.status,
            title: redactUiText(item.title),
            type: item.type,
            updatedAt: item.updatedAt,
          })),
          nextCursor: result.nextCursor,
        };
      } catch (error) {
        if (error instanceof PlatformUserContentQueryError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
        }
        throwPlatformUserQueryError();
      }
    }),

  getUserSessionOverview: platformOperationsProcedure
    .input(
      z
        .object({
          cursor: z.string().trim().min(1).max(512).optional(),
          limit: z.number().int().min(1).max(50).optional(),
          targetUserId: targetUserIdSchema,
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      let targetExists: boolean;
      try {
        targetExists = !!(await UserModel.findById(ctx.serverDB, input.targetUserId));
      } catch {
        throwPlatformUserQueryError();
      }
      if (!targetExists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Target user was not found' });
      }

      const limit = input.limit ?? 10;
      const cursor = input.cursor ? decodeSessionCursor(input.cursor) : undefined;
      const filters = [eq(authSessions.userId, input.targetUserId)];
      if (cursor) {
        filters.push(
          or(
            lt(authSessions.updatedAt, cursor.updatedAt),
            and(eq(authSessions.updatedAt, cursor.updatedAt), lt(authSessions.id, cursor.id)),
          )!,
        );
      }

      try {
        const [rows, totalRows] = await Promise.all([
          ctx.serverDB
            .select({
              createdAt: authSessions.createdAt,
              expiresAt: authSessions.expiresAt,
              id: authSessions.id,
              ipAddress: authSessions.ipAddress,
              updatedAt: authSessions.updatedAt,
              userAgent: authSessions.userAgent,
            })
            .from(authSessions)
            .where(and(...filters))
            .orderBy(desc(authSessions.updatedAt), desc(authSessions.id))
            .limit(limit + 1),
          ctx.serverDB
            .select({ total: sql<number>`count(*)` })
            .from(authSessions)
            .where(eq(authSessions.userId, input.targetUserId)),
        ]);
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const last = page.at(-1);
        return {
          items: page.map(({ createdAt, expiresAt, ipAddress, updatedAt, userAgent }) => ({
            createdAt,
            expiresAt,
            ipAddress,
            updatedAt,
            userAgent: redactUiText(userAgent),
          })),
          nextCursor: hasMore && last ? encodeSessionCursor(last.updatedAt, last.id) : null,
          total: Number(totalRows[0]?.total ?? 0),
        };
      } catch {
        throwPlatformUserQueryError();
      }
    }),

  listAuditEvents: platformOperationsProcedure
    .input(
      z
        .object({
          action: auditActionSchema.optional(),
          cursor: z.string().trim().min(1).max(512).optional(),
          endAt: z.date().optional(),
          limit: z.number().int().min(1).max(100).optional(),
          startAt: z.date().optional(),
          targetUserId: targetUserIdSchema.optional(),
        })
        .strict()
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        const result = await new PlatformAdminOperationAuditModel(ctx.serverDB).listEvents(input);
        return {
          items: result.items.map((item) => ({
            action: item.action,
            occurredAt: item.occurredAt,
            operatorUserId: item.operatorUserId,
            phase: item.phase,
            targetUserId: item.targetUserId,
          })),
          nextCursor: result.nextCursor,
        };
      } catch (error) {
        if (error instanceof PlatformAdminOperationAuditQueryError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
        }
        throwPlatformUserQueryError();
      }
    }),

  listUsers: platformOperationsProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).optional(),
          offset: z.number().int().min(0).optional(),
          query: z.string().trim().max(200).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      let result: Awaited<ReturnType<PlatformUserOperationsModel['listUsers']>>;
      try {
        result = await new PlatformUserOperationsModel(ctx.serverDB, ctx.userId).listUsers(input);
      } catch {
        throwPlatformUserQueryError();
      }

      return {
        items: result.items.map(toSafeUserOperationsItem),
        limit: result.limit,
        offset: result.offset,
        total: result.total,
      };
    }),

  repairUserTravelGroup: platformOperationsProcedure
    .input(
      z
        .object({
          confirmed: z.literal(true),
          operationId: operationIdSchema,
          planFingerprint: travelGroupRepairPlanFingerprintSchema,
          targetUserId: targetUserIdSchema,
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertMutationAdministratorIsStillActive(ctx.serverDB, ctx.userId);
        await assertMutationTargetIsActive(ctx.serverDB, input.targetUserId);

        const health = await getDefaultTravelServiceGroupHealthSummary(ctx.serverDB, {
          targetUserId: input.targetUserId,
        });
        const plan = buildDefaultTravelServiceGroupRepairPlan(health);
        const currentFingerprint = getTravelGroupRepairPlanFingerprint(
          input.targetUserId,
          health,
          plan,
        );
        if (currentFingerprint !== input.planFingerprint) {
          throw new Error(TRAVEL_GROUP_REPAIR_STATE_CHANGED);
        }
        if (!isExecutableTravelGroupRepairPlan(plan)) {
          throw new Error(TRAVEL_GROUP_REPAIR_REVIEW_REQUIRED);
        }

        // Repeat both checks after the read-only preview calculation and
        // immediately before the first audit/write side effect.
        await assertMutationAdministratorIsStillActive(ctx.serverDB, ctx.userId);
        await assertMutationTargetIsActive(ctx.serverDB, input.targetUserId);

        const repairKey = `${input.targetUserId}:${input.planFingerprint}`;
        const activeRepair = activeTravelGroupRepairs.get(repairKey);
        if (activeRepair) return await activeRepair;

        const operationId = input.operationId ?? randomUUID();
        const repair = new PlatformAdminOperationAuditModel(ctx.serverDB).runOperation(
          {
            action: 'user.travel_group_repaired',
            operationId,
            operatorUserId: ctx.userId,
            targetUserId: input.targetUserId,
          },
          async (): Promise<SafeTravelGroupRepairResult> => {
            const result = await executeDefaultTravelServiceGroupRepairPlan(ctx.serverDB, {
              expectedPlan: plan,
              targetUserId: input.targetUserId,
            });
            const finalHealth = await getDefaultTravelServiceGroupHealthSummary(ctx.serverDB, {
              targetUserId: input.targetUserId,
            });
            const finalPlan = buildDefaultTravelServiceGroupRepairPlan(finalHealth);
            if (
              !finalHealth.healthy ||
              finalHealth.issueCodes.length > 0 ||
              finalPlan.reviewRequired ||
              finalPlan.actions.length > 0
            ) {
              throw new Error(TRAVEL_GROUP_REPAIR_STATE_CHANGED);
            }
            return {
              actionCounts: result.actionCounts.map(({ code, count }) => ({ code, count })),
              ready: true,
              reviewRequired: false,
            };
          },
        );
        activeTravelGroupRepairs.set(repairKey, repair);
        try {
          return await repair;
        } finally {
          if (activeTravelGroupRepairs.get(repairKey) === repair) {
            activeTravelGroupRepairs.delete(repairKey);
          }
        }
      } catch (error) {
        throwTravelGroupRepairError(error);
      }
    }),

  revokeUserSessions: platformOperationsProcedure
    .input(z.object({ operationId: operationIdSchema, targetUserId: targetUserIdSchema }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        if (input.targetUserId === ctx.userId) {
          throw new PlatformUserOperationsError(
            'SELF_BAN_FORBIDDEN',
            'Administrators must use their personal account settings for their own sessions',
          );
        }
        await assertMutationAdministratorIsStillActive(ctx.serverDB, ctx.userId);
        await assertMutationTargetExists(ctx.serverDB, input.targetUserId);
        const operationId = input.operationId ?? randomUUID();
        await new PlatformAuthRevocationService(ctx.serverDB).revokeUser(input.targetUserId, {
          operationId,
          operatorUserId: ctx.userId,
        });
        return { id: input.targetUserId, sessionsRevoked: true as const };
      } catch (error) {
        throwPlatformSessionRevocationError(error);
      }
    }),

  unbanUser: platformOperationsProcedure
    .input(z.object({ operationId: operationIdSchema, targetUserId: targetUserIdSchema }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        const operationId = input.operationId ?? randomUUID();
        if (input.targetUserId === ctx.userId) {
          throw new PlatformUserOperationsError(
            'SELF_UNBAN_FORBIDDEN',
            'An administrator cannot unban their own account',
          );
        }
        await assertMutationAdministratorIsStillActive(ctx.serverDB, ctx.userId);
        await assertMutationTargetExists(ctx.serverDB, input.targetUserId);
        const state = await new PlatformAdminOperationAuditModel(ctx.serverDB).runOperation(
          {
            action: 'user.unbanned',
            operationId,
            operatorUserId: ctx.userId,
            targetUserId: input.targetUserId,
          },
          async () => {
            // Revoke again before clearing the ban so a previous partial failure
            // cannot reactivate stale Better Auth or OIDC credentials.
            await new PlatformAuthRevocationService(ctx.serverDB).revokeUser(input.targetUserId, {
              operationId,
              operatorUserId: ctx.userId,
            });
            return new PlatformUserOperationsModel(ctx.serverDB, ctx.userId).unbanUser({
              operationId,
              targetUserId: input.targetUserId,
            });
          },
        );
        return toSafeUserBanState(state);
      } catch (error) {
        throwPlatformUserOperationError(error);
      }
    }),

  updateUserProfile: platformOperationsProcedure
    .input(
      z
        .object({
          avatar: avatarSchema.optional(),
          fullName: fullNameSchema.optional(),
          operationId: operationIdSchema,
          targetUserId: targetUserIdSchema,
        })
        .strict()
        .refine((input) => input.avatar !== undefined || input.fullName !== undefined, {
          message: 'At least one profile field is required',
        }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const operationId = input.operationId ?? randomUUID();
        if (input.targetUserId === ctx.userId) {
          throw new PlatformUserAccountAdministrationError(
            'SELF_OPERATION_FORBIDDEN',
            'Administrators must use their personal account settings for their own profile',
          );
        }
        await assertMutationAdministratorIsStillActive(ctx.serverDB, ctx.userId);
        await assertMutationTargetExists(ctx.serverDB, input.targetUserId);
        const result = await new PlatformUserAccountAdministrationService(
          ctx.serverDB,
        ).updateProfile({
          avatar: input.avatar,
          fullName: input.fullName,
          operationId,
          operatorUserId: ctx.userId,
          targetUserId: input.targetUserId,
        });
        return {
          avatar: redactAvatar(result.avatar),
          fullName: redactUiText(result.fullName),
          id: result.id,
        };
      } catch (error) {
        throwPlatformUserOperationError(error);
      }
    }),
});
