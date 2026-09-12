import { createHmac } from 'node:crypto';

import {
  CHAT_GROUP_SPONSORED_CREDIT_MEMBER_NOT_AUTHORIZED,
  CHAT_GROUP_SPONSORED_CREDIT_POLICY_DISABLED,
  ChatGroupSponsoredCreditModel,
  type LobeChatDatabase,
} from '@lobechat/database';
import { TRPCError } from '@trpc/server';

import { ChatGroupModel } from '@/database/models/chatGroup';
import { AgentService } from '@/server/services/agent';
import { assertGroupAiPhoneVerified } from '@/server/services/aiAgent/verifiedPhone';
import { resolveGroupConversationPrincipal } from '@/server/services/groupConversationAccess/principal';
import { isQueueAgentRuntimeEnabled } from '@/server/services/queue/impls';
import {
  DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
  TRAVEL_SPECIALIST_TEMPLATES,
} from '@/server/services/user/travelServiceGroup';
import {
  getSuperGroupTemplate,
  getSuperGroupTemplateMemberClientId,
} from '@/server/services/user/travelServiceGroupTemplate';
import { runWebsiteAiStartIdempotently } from '@/server/services/websiteAi/idempotency';

import { PlatformManagedTextUsageSettlementError } from './settlement';
import {
  createPlatformUsageSharedBudget,
  createSponsoredPlatformUsageSharedBudget,
  type PlatformUsageSharedBudgetHandle,
} from './sharedBudget';

export const HOSTED_GROUP_CHAT_BILLING_UNAVAILABLE = 'GROUP_CHAT_BILLING_UNAVAILABLE';

export const hostedGroupChatBillingUnavailable = () =>
  new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: `[${HOSTED_GROUP_CHAT_BILLING_UNAVAILABLE}] 当前旅游群组暂时无法使用平台托管模型。`,
  });

export interface HostedGroupBillingPrincipal {
  actorUserId: string;
  billingUserId: string;
  groupId: string;
  kind: 'member-self-paid' | 'owner' | 'owner-sponsored-member';
  membershipVersion: number;
  policyVersion: number;
  resourceOwnerUserId: string;
  workspaceId: string | null;
}

const isFixedPlatformAgent = (config: unknown, userId: string, workspaceId?: string | null) => {
  if (!config || typeof config !== 'object') return false;
  const item = config as {
    agencyConfig?: { modelRuntimeMode?: unknown; modelSelectionPolicy?: unknown };
    model?: unknown;
    provider?: unknown;
    userId?: unknown;
    workspaceId?: unknown;
  };

  return (
    item.userId === userId &&
    (item.workspaceId ?? null) === (workspaceId ?? null) &&
    item.agencyConfig?.modelRuntimeMode === 'platform-managed' &&
    item.agencyConfig.modelSelectionPolicy === 'fixed' &&
    typeof item.model === 'string' &&
    Boolean(item.model.trim()) &&
    typeof item.provider === 'string' &&
    Boolean(item.provider.trim())
  );
};

const hasRequiredPlugins = (config: unknown, required: readonly string[]) => {
  if (!config || typeof config !== 'object') return false;
  const plugins = (config as { plugins?: unknown }).plugins;
  return Array.isArray(plugins) && required.every((identifier) => plugins.includes(identifier));
};

export const deriveHostedGroupChatRequestIdentity = (input: {
  idempotencyKey: string;
  principal: HostedGroupBillingPrincipal;
  secret: string;
}) => {
  if (!input.secret.trim()) throw hostedGroupChatBillingUnavailable();

  const { principal } = input;
  const identityMaterial = JSON.stringify({
    actorUserId: principal.actorUserId,
    billingUserId: principal.billingUserId,
    browserIdempotencyKey: input.idempotencyKey,
    groupId: principal.groupId,
    kind: principal.kind,
    membershipVersion: principal.membershipVersion,
    policyVersion: principal.policyVersion,
    resourceOwnerUserId: principal.resourceOwnerUserId,
    version: 2,
    workspaceId: principal.workspaceId,
  });

  const digest = createHmac('sha256', input.secret)
    .update('hosted-group-chat-budget:v2\0')
    .update(identityMaterial)
    .digest('hex');

  return `group-chat:v2:${digest}`;
};

export interface HostedGroupChatBillingInput {
  idempotencyKey: string;
  maxCredits?: number;
}

const assertOwnerBillingPrincipal = (principal: HostedGroupBillingPrincipal) => {
  const actorUserId = principal.actorUserId.trim();
  if (
    principal.kind !== 'owner' ||
    !actorUserId ||
    principal.billingUserId !== actorUserId ||
    principal.resourceOwnerUserId !== actorUserId ||
    !principal.groupId.trim() ||
    principal.membershipVersion !== 0 ||
    principal.policyVersion !== 0
  ) {
    throw hostedGroupChatBillingUnavailable();
  }
};

/** One shared admission path for both the current execAgent route and the legacy group route. */
export const runHostedGroupChatWithBudget = async <T>(input: {
  billing: HostedGroupChatBillingInput;
  db: LobeChatDatabase;
  fingerprint: unknown;
  principal: HostedGroupBillingPrincipal;
  secret: string;
  start: (context: {
    maxCredits?: number;
    sharedBudget: PlatformUsageSharedBudgetHandle;
  }) => Promise<T>;
  topicId?: string;
}): Promise<T> => {
  await assertGroupAiPhoneVerified(input.db, input.principal.actorUserId, input.principal);
  // The shared-budget handle is deliberately server-only and process-local. Until workers can
  // reconstruct it from a durable locator, dispatching through QStash could lose the authorization
  // context between admission and provider execution.
  if (isQueueAgentRuntimeEnabled()) throw hostedGroupChatBillingUnavailable();

  let billingPrincipal = input.principal;
  let maxCredits = input.billing.maxCredits;
  let sponsoredAdmission:
    Awaited<ReturnType<ChatGroupSponsoredCreditModel['resolveAdmission']>> | undefined;
  if (input.principal.kind === 'owner') {
    assertOwnerBillingPrincipal(input.principal);
    // Owner/admin execution uses the account-wide per-round gate and actual-usage settlement.
    // Ignore legacy request ceilings so an old client cannot recreate a Credits hold.
    maxCredits = undefined;
  } else {
    const { principal } = input;
    if (
      principal.kind !== 'owner-sponsored-member' ||
      !principal.actorUserId.trim() ||
      principal.actorUserId === principal.resourceOwnerUserId ||
      principal.billingUserId !== principal.resourceOwnerUserId ||
      !principal.groupId.trim() ||
      !Number.isSafeInteger(principal.membershipVersion) ||
      principal.membershipVersion <= 0 ||
      principal.workspaceId !== null
    ) {
      throw hostedGroupChatBillingUnavailable();
    }

    try {
      sponsoredAdmission = await new ChatGroupSponsoredCreditModel(
        input.db,
        principal.actorUserId,
      ).resolveAdmission({
        chatGroupId: principal.groupId,
        // One Credit safely probes whether owner sponsorship exists. The final
        // server-derived ceiling is rechecked atomically when the hold is created.
        maxCredits: maxCredits ?? 1,
      });
    } catch (error) {
      const sponsorshipUnavailable =
        error instanceof Error &&
        (error.message === CHAT_GROUP_SPONSORED_CREDIT_POLICY_DISABLED ||
          error.message === CHAT_GROUP_SPONSORED_CREDIT_MEMBER_NOT_AUTHORIZED);
      if (maxCredits !== undefined || !sponsorshipUnavailable) {
        throw hostedGroupChatBillingUnavailable();
      }
      // Invitation links intentionally work without an owner sponsorship policy.
      // In that case the member pays from their own visible Credits balance while
      // the fixed group agent configuration remains owned by the group owner.
      billingPrincipal = {
        ...principal,
        billingUserId: principal.actorUserId,
        kind: 'member-self-paid',
        policyVersion: 0,
      };
    }
    if (sponsoredAdmission) {
      if (
        sponsoredAdmission.actorUserId !== principal.actorUserId ||
        sponsoredAdmission.chatGroupId !== principal.groupId ||
        sponsoredAdmission.payerUserId !== principal.resourceOwnerUserId ||
        sponsoredAdmission.membershipVersion !== principal.membershipVersion ||
        sponsoredAdmission.workspaceId !== null ||
        !Number.isSafeInteger(sponsoredAdmission.policyVersion) ||
        sponsoredAdmission.policyVersion <= 0
      ) {
        throw hostedGroupChatBillingUnavailable();
      }
      billingPrincipal = {
        ...principal,
        policyVersion: sponsoredAdmission.policyVersion,
      };
    }
  }
  const usesAutomaticMetering = maxCredits === undefined;
  if (usesAutomaticMetering && sponsoredAdmission) {
    // Sponsored member execution still obeys the owner's explicit sponsorship policy.
    // Owner/self-paid execution deliberately keeps maxCredits undefined so no hold is created.
    maxCredits = Math.min(
      sponsoredAdmission.maxCreditsPerRequest,
      sponsoredAdmission.maxCreditsPerPeriod,
      sponsoredAdmission.groupPeriodLimitCredits,
    );
  }
  if (maxCredits !== undefined && (!Number.isSafeInteger(maxCredits) || maxCredits <= 0)) {
    throw hostedGroupChatBillingUnavailable();
  }
  const billing = { ...input.billing, maxCredits };
  const requestIdentity = deriveHostedGroupChatRequestIdentity({
    idempotencyKey: input.billing.idempotencyKey,
    principal: billingPrincipal,
    secret: input.secret,
  });

  return runWebsiteAiStartIdempotently({
    idempotencyKey: requestIdentity,
    maxCredits: billing.maxCredits,
    message: JSON.stringify(input.fingerprint),
    start: async () => {
      const expiresAt = new Date(Date.now() + 15 * 60_000);
      let sharedBudget: PlatformUsageSharedBudgetHandle;
      try {
        if (billingPrincipal.kind === 'owner-sponsored-member') {
          if (billing.maxCredits === undefined) throw hostedGroupChatBillingUnavailable();
          sharedBudget = await createSponsoredPlatformUsageSharedBudget(
            input.db,
            billingPrincipal.actorUserId,
            {
              chatGroupId: billingPrincipal.groupId,
              expectedMembershipVersion: billingPrincipal.membershipVersion,
              expectedPolicyVersion: billingPrincipal.policyVersion,
              expiresAt,
              maxCredits: billing.maxCredits,
              requestIdentity,
            },
          );
        } else {
          sharedBudget = await createPlatformUsageSharedBudget(
            input.db,
            billingPrincipal.billingUserId,
            {
              expiresAt,
              maxCredits: billing.maxCredits,
              requestIdentity,
              workspaceId: billingPrincipal.workspaceId,
            },
          );
        }
      } catch (error) {
        if (
          error instanceof PlatformManagedTextUsageSettlementError &&
          error.code === 'BALANCE_FLOOR_REACHED'
        ) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message:
              billingPrincipal.kind === 'owner-sponsored-member'
                ? '[GROUP_OWNER_CREDITS_EMPTY] 该群主余额不足，AI 任务未启动。请联系群主补充 Credits。'
                : '[PLATFORM_CREDITS_EMPTY] Credits 余额不足，AI 任务未启动，请补充额度后重试。',
          });
        }
        throw error;
      }
      return input.start({ maxCredits: billing.maxCredits, sharedBudget });
    },
    topicId: input.topicId,
    userId: billingPrincipal.actorUserId,
  });
};

/**
 * Resolves only the caller-owned default private travel group. Every enabled
 * participant must remain a fixed platform-managed agent, and all required
 * specialist identities must still be present. Browser input cannot select a
 * provider, model, credential or tool through this boundary.
 */
export const resolveHostedTravelGroupTarget = async (input: {
  agentId?: string;
  db: LobeChatDatabase;
  groupId: string;
  userId: string;
  workspaceId?: string | null;
}) => {
  if (input.workspaceId) throw hostedGroupChatBillingUnavailable();
  let conversationPrincipal;
  try {
    conversationPrincipal = await resolveGroupConversationPrincipal(input.db, {
      actorUserId: input.userId,
      groupId: input.groupId,
    });
  } catch {
    throw hostedGroupChatBillingUnavailable();
  }
  const resourceOwnerUserId = conversationPrincipal.resourceOwnerUserId;
  const groupModel = new ChatGroupModel(input.db, resourceOwnerUserId);
  const group = await groupModel.findByClientId(DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID);
  if (!group || group.id !== input.groupId) return undefined;
  if (
    group.visibility !== 'private' ||
    group.userId !== resourceOwnerUserId ||
    (group.workspaceId ?? null) !== null ||
    !group.content?.trim()
  ) {
    throw hostedGroupChatBillingUnavailable();
  }

  const [supervisorId, roster, template] = await Promise.all([
    groupModel.getSupervisorAgentId(group.id),
    groupModel.getGroupAgentsWithMeta(group.id),
    getSuperGroupTemplate(input.db),
  ]);
  const requiredClientIds = new Set<string>(
    template.revision > 0
      ? template.members.map(({ key }) => getSuperGroupTemplateMemberClientId(key))
      : TRAVEL_SPECIALIST_TEMPLATES.map(({ clientId }) => clientId),
  );
  const rosterClientIds = new Set(roster.map(({ clientId }) => clientId).filter(Boolean));
  if (
    !supervisorId ||
    (input.agentId !== undefined && supervisorId !== input.agentId) ||
    !roster.some(({ agentId, role }) => agentId === supervisorId && role === 'supervisor') ||
    [...requiredClientIds].some((clientId) => !rosterClientIds.has(clientId)) ||
    (template.revision > 0 &&
      roster.some(
        ({ agentId, clientId }) =>
          agentId !== supervisorId && (!clientId || !requiredClientIds.has(clientId)),
      ))
  ) {
    throw hostedGroupChatBillingUnavailable();
  }

  const agentService = new AgentService(input.db, resourceOwnerUserId);
  const configs = await Promise.all(
    roster.map(({ agentId }) => agentService.getAgentConfig(agentId)),
  );
  const supervisorIndex = roster.findIndex(({ agentId }) => agentId === supervisorId);
  const copywriterTemplate = TRAVEL_SPECIALIST_TEMPLATES.find(({ key }) => key === 'copywriter');
  const copywriterIndex = roster.findIndex(
    ({ clientId }) => clientId === copywriterTemplate?.clientId,
  );
  if (configs.some((config) => !isFixedPlatformAgent(config, resourceOwnerUserId, null))) {
    throw hostedGroupChatBillingUnavailable();
  }
  const supervisorConfig = configs[supervisorIndex] as { model: string; provider: string };
  if (
    template.revision === 0 &&
    (!copywriterTemplate ||
      copywriterIndex < 0 ||
      !hasRequiredPlugins(configs[copywriterIndex], [
        ...copywriterTemplate.plugins,
        ...copywriterTemplate.skillSlots,
      ]))
  ) {
    throw hostedGroupChatBillingUnavailable();
  }

  return {
    groupId: group.id,
    platformModel: { model: supervisorConfig.model, provider: supervisorConfig.provider },
    principal: {
      actorUserId: input.userId,
      billingUserId: resourceOwnerUserId,
      groupId: group.id,
      kind:
        conversationPrincipal.kind === 'owner'
          ? ('owner' as const)
          : ('owner-sponsored-member' as const),
      membershipVersion: conversationPrincipal.membershipVersion,
      policyVersion: 0,
      resourceOwnerUserId,
      workspaceId: null,
    },
    routingMembers: roster.map(({ agentId: id, clientId }) => ({ clientId, id })),
    supervisorId,
  };
};
