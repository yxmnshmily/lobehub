import { createHmac } from 'node:crypto';

import { ChatGroupSponsoredCreditModel, type LobeChatDatabase } from '@lobechat/database';
import { TRPCError } from '@trpc/server';

import { ChatGroupModel } from '@/database/models/chatGroup';
import { AgentService } from '@/server/services/agent';
import { resolveGroupConversationPrincipal } from '@/server/services/groupConversationAccess/principal';
import { isQueueAgentRuntimeEnabled } from '@/server/services/queue/impls';
import {
  DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
  TRAVEL_SPECIALIST_TEMPLATES,
} from '@/server/services/user/travelServiceGroup';
import { runWebsiteAiStartIdempotently } from '@/server/services/websiteAi/idempotency';

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
  kind: 'owner' | 'owner-sponsored-member';
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
  maxCredits: number;
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
    maxCredits: number;
    sharedBudget: PlatformUsageSharedBudgetHandle;
  }) => Promise<T>;
  topicId?: string;
}): Promise<T> => {
  // The shared-budget handle is deliberately server-only and process-local. Until workers can
  // reconstruct it from a durable locator, dispatching through QStash could lose the authorization
  // context between admission and provider execution.
  if (isQueueAgentRuntimeEnabled()) throw hostedGroupChatBillingUnavailable();

  let billingPrincipal = input.principal;
  if (input.principal.kind === 'owner') {
    assertOwnerBillingPrincipal(input.principal);
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

    let admission;
    try {
      admission = await new ChatGroupSponsoredCreditModel(
        input.db,
        principal.actorUserId,
      ).resolveAdmission({
        chatGroupId: principal.groupId,
        maxCredits: input.billing.maxCredits,
      });
    } catch {
      throw hostedGroupChatBillingUnavailable();
    }
    if (
      admission.actorUserId !== principal.actorUserId ||
      admission.chatGroupId !== principal.groupId ||
      admission.payerUserId !== principal.resourceOwnerUserId ||
      admission.membershipVersion !== principal.membershipVersion ||
      admission.workspaceId !== null ||
      !Number.isSafeInteger(admission.policyVersion) ||
      admission.policyVersion <= 0
    ) {
      throw hostedGroupChatBillingUnavailable();
    }
    billingPrincipal = {
      ...principal,
      policyVersion: admission.policyVersion,
    };
  }
  const requestIdentity = deriveHostedGroupChatRequestIdentity({
    idempotencyKey: input.billing.idempotencyKey,
    principal: billingPrincipal,
    secret: input.secret,
  });

  return runWebsiteAiStartIdempotently({
    idempotencyKey: requestIdentity,
    maxCredits: input.billing.maxCredits,
    message: JSON.stringify(input.fingerprint),
    start: async () => {
      const expiresAt = new Date(Date.now() + 15 * 60_000);
      const sharedBudget =
        billingPrincipal.kind === 'owner-sponsored-member'
          ? await createSponsoredPlatformUsageSharedBudget(input.db, billingPrincipal.actorUserId, {
              chatGroupId: billingPrincipal.groupId,
              expectedMembershipVersion: billingPrincipal.membershipVersion,
              expectedPolicyVersion: billingPrincipal.policyVersion,
              expiresAt,
              maxCredits: input.billing.maxCredits,
              requestIdentity,
            })
          : await createPlatformUsageSharedBudget(input.db, billingPrincipal.billingUserId, {
              expiresAt,
              maxCredits: input.billing.maxCredits,
              requestIdentity,
              workspaceId: billingPrincipal.workspaceId,
            });
      return input.start({ maxCredits: input.billing.maxCredits, sharedBudget });
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

  const [supervisorId, roster] = await Promise.all([
    groupModel.getSupervisorAgentId(group.id),
    groupModel.getGroupAgentsWithMeta(group.id),
  ]);
  const requiredClientIds = new Set(TRAVEL_SPECIALIST_TEMPLATES.map(({ clientId }) => clientId));
  const rosterClientIds = new Set(roster.map(({ clientId }) => clientId).filter(Boolean));
  if (
    !supervisorId ||
    (input.agentId !== undefined && supervisorId !== input.agentId) ||
    !roster.some(({ agentId, role }) => agentId === supervisorId && role === 'supervisor') ||
    [...requiredClientIds].some((clientId) => !rosterClientIds.has(clientId))
  ) {
    throw hostedGroupChatBillingUnavailable();
  }

  const agentService = new AgentService(input.db, resourceOwnerUserId);
  const configs = await Promise.all(
    roster.map(({ agentId }) => agentService.getAgentConfig(agentId)),
  );
  const copywriterTemplate = TRAVEL_SPECIALIST_TEMPLATES.find(({ key }) => key === 'copywriter');
  const copywriterIndex = roster.findIndex(
    ({ clientId }) => clientId === copywriterTemplate?.clientId,
  );
  if (configs.some((config) => !isFixedPlatformAgent(config, resourceOwnerUserId, null))) {
    throw hostedGroupChatBillingUnavailable();
  }
  if (
    !copywriterTemplate ||
    copywriterIndex < 0 ||
    !hasRequiredPlugins(configs[copywriterIndex], [
      ...copywriterTemplate.plugins,
      ...copywriterTemplate.skillSlots,
    ])
  ) {
    throw hostedGroupChatBillingUnavailable();
  }

  return {
    groupId: group.id,
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
