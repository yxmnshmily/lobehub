import {
  CHAT_GROUP_MEMBERSHIP_VERSION_CONFLICT,
  CHAT_GROUP_SPONSORED_CREDIT_FORBIDDEN,
  CHAT_GROUP_SPONSORED_CREDIT_INVALID_LIMIT,
  CHAT_GROUP_SPONSORED_CREDIT_MEMBER_NOT_AUTHORIZED,
  CHAT_GROUP_SPONSORED_CREDIT_PERIOD_CHANGE_NOT_ALLOWED,
  CHAT_GROUP_SPONSORED_CREDIT_POLICY_DISABLED,
  CHAT_GROUP_SPONSORED_CREDIT_POLICY_VERSION_CONFLICT,
  CHAT_GROUP_SPONSORED_CREDIT_PRINCIPAL_BLOCKED,
  CHAT_GROUP_SPONSORED_CREDIT_WORKSPACE_FROZEN,
  ChatGroupSponsoredCreditModel,
  ChatGroupUserMembershipModel,
} from '@lobechat/database';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  GroupConversationAccessUnavailableError,
  resolveGroupConversationPrincipal,
} from '@/server/services/groupConversationAccess/principal';

const GROUP_SPONSORED_CREDIT_UNAVAILABLE = 'GROUP_SPONSORED_CREDIT_UNAVAILABLE';
const GROUP_SPONSORED_CREDIT_CONFLICT = 'GROUP_SPONSORED_CREDIT_CONFLICT';
const GROUP_SPONSORED_CREDIT_INVALID_INPUT = 'GROUP_SPONSORED_CREDIT_INVALID_INPUT';
const GROUP_SPONSORED_CREDIT_OPERATION_FAILED = 'GROUP_SPONSORED_CREDIT_OPERATION_FAILED';

const id = z.string().trim().min(1).max(255);
const positiveCredits = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const policyVersion = z.number().int().min(1).max(2_147_483_647);
const initialPolicyVersion = z.number().int().min(0).max(2_147_483_647);
const membershipVersion = z.number().int().min(1).max(2_147_483_647);

const unavailable = (): never => {
  throw new TRPCError({ code: 'NOT_FOUND', message: GROUP_SPONSORED_CREDIT_UNAVAILABLE });
};

const personalProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  if (ctx.workspaceId) return unavailable();
  return next({ ctx });
});

const resolvePrincipal = async (
  db: Parameters<typeof resolveGroupConversationPrincipal>[0],
  actorUserId: string,
  groupId: string,
) => {
  try {
    return await resolveGroupConversationPrincipal(db, { actorUserId, groupId });
  } catch (error) {
    if (error instanceof GroupConversationAccessUnavailableError) return unavailable();
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: GROUP_SPONSORED_CREDIT_OPERATION_FAILED,
    });
  }
};

const requireOwner = async (
  db: Parameters<typeof resolveGroupConversationPrincipal>[0],
  actorUserId: string,
  groupId: string,
) => {
  const principal = await resolvePrincipal(db, actorUserId, groupId);
  if (principal.kind !== 'owner') return unavailable();
  return principal;
};

const requireMember = async (
  db: Parameters<typeof resolveGroupConversationPrincipal>[0],
  actorUserId: string,
  groupId: string,
) => {
  const principal = await resolvePrincipal(db, actorUserId, groupId);
  if (principal.kind !== 'member') return unavailable();
  return principal;
};

const safeCall = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === CHAT_GROUP_SPONSORED_CREDIT_INVALID_LIMIT) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: GROUP_SPONSORED_CREDIT_INVALID_INPUT });
    }
    if (
      [
        CHAT_GROUP_MEMBERSHIP_VERSION_CONFLICT,
        CHAT_GROUP_SPONSORED_CREDIT_PERIOD_CHANGE_NOT_ALLOWED,
        CHAT_GROUP_SPONSORED_CREDIT_POLICY_VERSION_CONFLICT,
      ].includes(message)
    ) {
      throw new TRPCError({ code: 'CONFLICT', message: GROUP_SPONSORED_CREDIT_CONFLICT });
    }
    if (
      [
        CHAT_GROUP_SPONSORED_CREDIT_FORBIDDEN,
        CHAT_GROUP_SPONSORED_CREDIT_MEMBER_NOT_AUTHORIZED,
        CHAT_GROUP_SPONSORED_CREDIT_POLICY_DISABLED,
        CHAT_GROUP_SPONSORED_CREDIT_PRINCIPAL_BLOCKED,
        CHAT_GROUP_SPONSORED_CREDIT_WORKSPACE_FROZEN,
      ].includes(message)
    ) {
      return unavailable();
    }
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: GROUP_SPONSORED_CREDIT_OPERATION_FAILED,
    });
  }
};

const safePolicy = (
  policy:
    | {
        enabled: boolean;
        defaultMemberPeriodLimitCredits: number | null;
        defaultMemberRequestLimitCredits: number | null;
        defaultMemberSponsorshipEnabled: boolean;
        groupPeriodLimitCredits: number;
        periodDurationSeconds: number;
        periodEndsAt: Date;
        periodStartedAt: Date;
        policyVersion: number;
      }
    | undefined,
) =>
  policy
    ? (() => {
        const defaultMemberTemplateEnabled = Boolean(
          policy.enabled &&
          policy.defaultMemberSponsorshipEnabled &&
          policy.defaultMemberPeriodLimitCredits &&
          policy.defaultMemberRequestLimitCredits,
        );
        return {
          defaultMemberTemplate: {
            billingResponsibility: defaultMemberTemplateEnabled ? ('group_owner' as const) : null,
            enabled: defaultMemberTemplateEnabled,
            maxCreditsPerPeriod: defaultMemberTemplateEnabled
              ? policy.defaultMemberPeriodLimitCredits
              : null,
            maxCreditsPerRequest: defaultMemberTemplateEnabled
              ? policy.defaultMemberRequestLimitCredits
              : null,
          },
          enabled: policy.enabled,
          groupPeriodLimitCredits: policy.groupPeriodLimitCredits,
          periodDurationSeconds: policy.periodDurationSeconds,
          periodEndsAt: policy.periodEndsAt,
          periodStartedAt: policy.periodStartedAt,
          policyVersion: policy.policyVersion,
        };
      })()
    : {
        defaultMemberTemplate: {
          billingResponsibility: null,
          enabled: false,
          maxCreditsPerPeriod: null,
          maxCreditsPerRequest: null,
        },
        enabled: false,
        groupPeriodLimitCredits: null,
        periodDurationSeconds: null,
        periodEndsAt: null,
        periodStartedAt: null,
        policyVersion: 0,
      };

const safeMemberLimits = (membership: {
  canUsePaidAi: boolean;
  maxCreditsPerPeriod: number | null;
  maxCreditsPerRequest: number | null;
  membershipVersion: number;
}) => ({
  canUsePaidAi: membership.canUsePaidAi,
  maxCreditsPerPeriod: membership.maxCreditsPerPeriod,
  maxCreditsPerRequest: membership.maxCreditsPerRequest,
  membershipVersion: membership.membershipVersion,
});

const memberLimitsInput = z
  .object({
    expectedMembershipVersion: membershipVersion,
    groupId: id,
    maxCreditsPerPeriod: positiveCredits,
    maxCreditsPerRequest: positiveCredits,
    memberUserId: id,
  })
  .strict()
  .refine((input) => input.maxCreditsPerRequest <= input.maxCreditsPerPeriod);

const defaultMemberTemplateInput = z
  .discriminatedUnion('enabled', [
    z
      .object({
        enabled: z.literal(false),
        expectedPolicyVersion: policyVersion,
        groupId: id,
      })
      .strict(),
    z
      .object({
        enabled: z.literal(true),
        expectedPolicyVersion: policyVersion,
        groupId: id,
        maxCreditsPerPeriod: positiveCredits,
        maxCreditsPerRequest: positiveCredits,
      })
      .strict(),
  ])
  .refine((input) => !input.enabled || input.maxCreditsPerRequest <= input.maxCreditsPerPeriod);

export const groupSponsoredCreditRouter = router({
  disablePolicy: personalProcedure
    .input(z.object({ expectedPolicyVersion: policyVersion, groupId: id }).strict())
    .mutation(async ({ ctx, input }) => {
      await requireOwner(ctx.serverDB, ctx.userId, input.groupId);
      const result = await safeCall(() =>
        new ChatGroupSponsoredCreditModel(ctx.serverDB, ctx.userId).disablePolicy({
          chatGroupId: input.groupId,
          expectedPolicyVersion: input.expectedPolicyVersion,
        }),
      );
      return safePolicy(result);
    }),

  enablePolicy: personalProcedure
    .input(
      z
        .object({
          expectedPolicyVersion: initialPolicyVersion,
          groupId: id,
          groupPeriodLimitCredits: positiveCredits,
          periodDurationSeconds: z.number().int().min(1).max(31_536_000),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOwner(ctx.serverDB, ctx.userId, input.groupId);
      const result = await safeCall(() =>
        new ChatGroupSponsoredCreditModel(ctx.serverDB, ctx.userId).enablePolicy({
          chatGroupId: input.groupId,
          expectedPolicyVersion: input.expectedPolicyVersion,
          groupPeriodLimitCredits: input.groupPeriodLimitCredits,
          periodDurationSeconds: input.periodDurationSeconds,
        }),
      );
      return safePolicy(result);
    }),

  getMyStatus: personalProcedure
    .input(z.object({ groupId: id }).strict())
    .query(async ({ ctx, input }) => {
      const principal = await requireMember(ctx.serverDB, ctx.userId, input.groupId);
      const [membership, policy] = await Promise.all([
        safeCall(() =>
          new ChatGroupUserMembershipModel(ctx.serverDB, ctx.userId).getActiveMembership(
            input.groupId,
          ),
        ),
        safeCall(() =>
          new ChatGroupSponsoredCreditModel(ctx.serverDB, principal.resourceOwnerUserId).getPolicy(
            input.groupId,
          ),
        ),
      ]);
      if (!membership) return unavailable();
      const policyBelongsToCurrentOwner = Boolean(
        policy?.enabled &&
        policy.payerUserId === principal.resourceOwnerUserId &&
        policy.payerUserIdSnapshot === principal.resourceOwnerUserId,
      );
      const active = Boolean(
        policyBelongsToCurrentOwner &&
        membership.canUsePaidAi &&
        membership.maxCreditsPerRequest &&
        membership.maxCreditsPerPeriod,
      );
      return {
        billingResponsibility: active ? ('group_owner' as const) : null,
        canUsePaidAi: active,
        enabled: policyBelongsToCurrentOwner,
        maxCreditsPerPeriod: active ? membership.maxCreditsPerPeriod : null,
        maxCreditsPerRequest: active ? membership.maxCreditsPerRequest : null,
        membershipVersion: membership.membershipVersion,
        periodEndsAt: policyBelongsToCurrentOwner ? policy?.periodEndsAt : null,
        policyVersion: policyBelongsToCurrentOwner ? (policy?.policyVersion ?? 0) : 0,
      };
    }),

  getOwnerPolicy: personalProcedure
    .input(z.object({ groupId: id }).strict())
    .query(async ({ ctx, input }) => {
      await requireOwner(ctx.serverDB, ctx.userId, input.groupId);
      const policy = await safeCall(() =>
        new ChatGroupSponsoredCreditModel(ctx.serverDB, ctx.userId).getPolicy(input.groupId),
      );
      return safePolicy(policy);
    }),

  revokeMemberPaidAi: personalProcedure
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
      await requireOwner(ctx.serverDB, ctx.userId, input.groupId);
      const result = await safeCall(() =>
        new ChatGroupSponsoredCreditModel(ctx.serverDB, ctx.userId).revokeMemberPaidAi({
          chatGroupId: input.groupId,
          expectedMembershipVersion: input.expectedMembershipVersion,
          memberUserId: input.memberUserId,
        }),
      );
      return safeMemberLimits(result);
    }),

  setMemberLimits: personalProcedure.input(memberLimitsInput).mutation(async ({ ctx, input }) => {
    await requireOwner(ctx.serverDB, ctx.userId, input.groupId);
    const result = await safeCall(() =>
      new ChatGroupSponsoredCreditModel(ctx.serverDB, ctx.userId).setMemberPaidAiLimits({
        chatGroupId: input.groupId,
        expectedMembershipVersion: input.expectedMembershipVersion,
        maxCreditsPerPeriod: input.maxCreditsPerPeriod,
        maxCreditsPerRequest: input.maxCreditsPerRequest,
        memberUserId: input.memberUserId,
      }),
    );
    return safeMemberLimits(result);
  }),

  updatePolicyLimit: personalProcedure
    .input(
      z
        .object({
          expectedPolicyVersion: policyVersion,
          groupId: id,
          groupPeriodLimitCredits: positiveCredits,
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOwner(ctx.serverDB, ctx.userId, input.groupId);
      const result = await safeCall(() =>
        new ChatGroupSponsoredCreditModel(ctx.serverDB, ctx.userId).updatePolicyLimit({
          chatGroupId: input.groupId,
          expectedPolicyVersion: input.expectedPolicyVersion,
          groupPeriodLimitCredits: input.groupPeriodLimitCredits,
        }),
      );
      return safePolicy(result);
    }),

  updateDefaultMemberTemplate: personalProcedure
    .input(defaultMemberTemplateInput)
    .mutation(async ({ ctx, input }) => {
      await requireOwner(ctx.serverDB, ctx.userId, input.groupId);
      const model = new ChatGroupSponsoredCreditModel(ctx.serverDB, ctx.userId);
      const result = await safeCall(() =>
        input.enabled
          ? model.updateDefaultMemberSponsorshipTemplate({
              chatGroupId: input.groupId,
              enabled: true,
              expectedPolicyVersion: input.expectedPolicyVersion,
              maxCreditsPerPeriod: input.maxCreditsPerPeriod,
              maxCreditsPerRequest: input.maxCreditsPerRequest,
            })
          : model.updateDefaultMemberSponsorshipTemplate({
              chatGroupId: input.groupId,
              enabled: false,
              expectedPolicyVersion: input.expectedPolicyVersion,
            }),
      );
      return safePolicy(result);
    }),
});
