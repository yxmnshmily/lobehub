import { TRPCError } from '@trpc/server';
import { nanoid } from 'nanoid';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { PlatformModerationAuditModel } from '@/database/models/platformModeration';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { createStreamEventManager } from '@/server/modules/AgentRuntime/factory';
import { AgentService } from '@/server/services/agent';
import { AiAgentService } from '@/server/services/aiAgent';
import { scanPlatformContent as scanPlatformModerationText } from '@/server/services/platformModeration';
import { resolvePlatformModelPricing } from '@/server/services/platformUsageBilling/modelPricing';
import { PlatformManagedTextUsageSettlement } from '@/server/services/platformUsageBilling/settlement';
import { createPlatformUsageSharedBudget } from '@/server/services/platformUsageBilling/sharedBudget';
import { createTravelToolDispatchPolicy } from '@/server/services/travelOrchestration';
import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@/server/services/user/travelServiceGroup';

import { websiteAiPreviousTurnStore } from './previousTurn';
import { WEBSITE_AI_SETTLEMENT_GATED_TEXT } from './supervisorFallback';

export const WEBSITE_AI_ACTIVE_OPERATION_LIMIT = 2;
export const WEBSITE_AI_REQUESTS_PER_MINUTE_LIMIT = 10;
export const WEBSITE_AI_SERVICE_BILLING_UNAVAILABLE = {
  code: 'SERVICE_BILLING_UNAVAILABLE',
  message: '该制作类型的订单结算尚未启用。',
} as const;
export const WEBSITE_AI_SUPERVISOR_FALLBACK_DENIED = {
  code: 'SUPERVISOR_FALLBACK_DENIED',
  message: '该咨询无法通过安全策略，请改写后重试。',
} as const;
export const WEBSITE_AI_IMAGE_MODEL_UNAVAILABLE = {
  code: 'PLATFORM_IMAGE_MODEL_UNAVAILABLE',
  message: '平台当前没有可用的图片模型。',
} as const;
export const WEBSITE_AI_GENERATION_LIMIT_REQUIRED = {
  code: 'GENERATION_LIMIT_REQUIRED',
  message: '提交制作任务前必须设置有效的 Credits 上限。',
} as const;
export const WEBSITE_AI_PRODUCTION_CAPABILITY_UNAVAILABLE = {
  code: 'CAPABILITY_UNAVAILABLE',
  message: '当前旅游内容制作与咨询暂不可用，请稍后再试。',
} as const;
export const WEBSITE_AI_IMAGE_USAGE_UNAVAILABLE = {
  code: 'CAPABILITY_UNAVAILABLE',
  message: '当前图片生成尚未提供服务端可强制的成本上限，暂不提交生成任务。',
} as const;
export const WEBSITE_AI_VIDEO_USAGE_UNAVAILABLE = {
  code: 'VIDEO_USAGE_UNAVAILABLE',
  message: '平台视频用量结算尚不可用。',
} as const;
export const WEBSITE_AI_BALANCE_INSUFFICIENT = {
  code: 'BALANCE_EMPTY',
  message: 'Credits 余额不足，请充值后重试。',
} as const;
export const WEBSITE_AI_BALANCE_CHECK_UNAVAILABLE = {
  code: 'BALANCE_CHECK_UNAVAILABLE',
  message: '暂时无法确认 Credits 余额，请稍后重试。',
} as const;
export const WEBSITE_AI_GROUP_NOT_PRIVATE = {
  code: 'TRAVEL_GROUP_NOT_PRIVATE',
  message: '旅游服务群组必须保持为用户私有群组。',
} as const;
export const WEBSITE_AI_SUPERVISOR_INVALID = {
  code: 'TRAVEL_SUPERVISOR_INVALID',
  message: '旅游服务群组缺少有效的“旅游群主AI”监督者。',
} as const;
export const WEBSITE_AI_CONTENT_BLOCKED = {
  code: 'CONTENT_BLOCKED',
  message: '请求内容未通过安全检查。',
} as const;
export const WEBSITE_AI_MODERATION_UNAVAILABLE = {
  code: 'CONTENT_MODERATION_UNAVAILABLE',
  message: '内容安全检查暂时不可用，请稍后重试。',
} as const;

const unavailableCapability = () => ({
  available: false,
  reasonCode: WEBSITE_AI_PRODUCTION_CAPABILITY_UNAVAILABLE.code,
});

const COPYWRITER_CLIENT_ID = 'default-travel-copywriter';
const COPYWRITING_SKILL_ID = 'tourism-copywriting';
const COPY_BUDGET_LEASE_MS = 15 * 60_000;

type WebsiteAiCopyContext = {
  copywriterId: string;
  groupId: string;
  progressMembers: Array<{ id: string; name: string }>;
  routingMembers: Array<{ clientId: string | null; id: string }>;
  supervisorId: string;
};

const unavailable = () =>
  new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: `[${WEBSITE_AI_PRODUCTION_CAPABILITY_UNAVAILABLE.code}] ${WEBSITE_AI_PRODUCTION_CAPABILITY_UNAVAILABLE.message}`,
  });

const fixedHostedTextTarget = (config: unknown) => {
  if (!config || typeof config !== 'object') return undefined;
  const item = config as {
    agencyConfig?: { modelRuntimeMode?: unknown; modelSelectionPolicy?: unknown };
    model?: unknown;
    plugins?: unknown;
    provider?: unknown;
  };
  if (
    item.agencyConfig?.modelRuntimeMode !== 'platform-managed' ||
    item.agencyConfig.modelSelectionPolicy !== 'fixed' ||
    typeof item.model !== 'string' ||
    !item.model.trim() ||
    typeof item.provider !== 'string' ||
    !item.provider.trim()
  ) {
    return undefined;
  }
  return {
    model: item.model.trim(),
    plugins: Array.isArray(item.plugins) ? item.plugins : [],
    provider: item.provider.trim(),
  };
};

const resolveCopyContext = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId?: string,
): Promise<WebsiteAiCopyContext | undefined> => {
  const groupModel = new ChatGroupModel(db, userId, workspaceId);
  const group = await groupModel.findByClientId(DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID);
  if (!group || group.visibility !== 'private' || !group.content?.trim()) return undefined;

  const [supervisorId, roster] = await Promise.all([
    groupModel.getSupervisorAgentId(group.id),
    groupModel.getGroupAgentsWithMeta(group.id),
  ]);
  const copywriter = roster.find(({ clientId }) => clientId === COPYWRITER_CLIENT_ID);
  if (!supervisorId || !copywriter) return undefined;

  const agentService = new AgentService(db, userId, workspaceId);
  const [supervisorConfig, copywriterConfig] = await Promise.all([
    agentService.getAgentConfig(supervisorId),
    agentService.getAgentConfig(copywriter.agentId),
  ]);
  const supervisorTarget = fixedHostedTextTarget(supervisorConfig);
  const copywriterTarget = fixedHostedTextTarget(copywriterConfig);
  if (
    !supervisorTarget ||
    !copywriterTarget ||
    !copywriterTarget.plugins.includes('lobe-travel-production') ||
    !copywriterTarget.plugins.includes(COPYWRITING_SKILL_ID)
  ) {
    return undefined;
  }

  const [supervisorPricing, copywriterPricing] = await Promise.all([
    resolvePlatformModelPricing(db, supervisorTarget),
    resolvePlatformModelPricing(db, copywriterTarget),
  ]);
  if (!supervisorPricing || !copywriterPricing) return undefined;

  await new PlatformManagedTextUsageSettlement(db, userId).assertCanCallProvider();

  return {
    copywriterId: copywriter.agentId,
    groupId: group.id,
    progressMembers: roster.map(({ agentId, title }) => ({
      id: agentId,
      name: title?.trim() || '旅游助理',
    })),
    routingMembers: roster.map(({ agentId, clientId }) => ({ clientId, id: agentId })),
    supervisorId,
  };
};

export const getWebsiteAiCapabilities = async (db: LobeChatDatabase, userId?: string) => {
  let copyAvailable = false;
  if (userId) {
    try {
      copyAvailable = Boolean(await resolveCopyContext(db, userId));
    } catch {
      copyAvailable = false;
    }
  }

  return {
    copy: copyAvailable ? { available: true } : unavailableCapability(),
    document: unavailableCapability(),
    image: unavailableCapability(),
    video: unavailableCapability(),
  };
};

export class WebsiteAiService {
  private readonly operationModel: AgentOperationModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {
    this.operationModel = new AgentOperationModel(db, userId, workspaceId);
  }

  async start(input: {
    maxCredits?: number;
    message: string;
    requestIdentity: string;
    topicId?: string;
  }) {
    if (!Number.isSafeInteger(input.maxCredits) || Number(input.maxCredits) <= 0) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `[${WEBSITE_AI_GENERATION_LIMIT_REQUIRED.code}] ${WEBSITE_AI_GENERATION_LIMIT_REQUIRED.message}`,
      });
    }
    if (
      typeof input.requestIdentity !== 'string' ||
      !input.requestIdentity.trim() ||
      input.requestIdentity.length > 160
    ) {
      throw unavailable();
    }

    const admissionId = `website_ai_admission_${Date.now()}_${nanoid(8)}`;
    let moderation: ReturnType<typeof scanPlatformModerationText>;
    try {
      const scanResult = scanPlatformModerationText({ text: input.message });
      moderation = scanResult;
      await new PlatformModerationAuditModel(this.db).recordScanResult({
        scanResult: {
          action: scanResult.action,
          findings: scanResult.findings,
          fingerprint: scanResult.fingerprint,
          preview: scanResult.preview,
        },
        sourceId: admissionId,
        sourceType: 'chat',
        userId: this.userId,
      });
    } catch {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `[${WEBSITE_AI_MODERATION_UNAVAILABLE.code}] ${WEBSITE_AI_MODERATION_UNAVAILABLE.message}`,
      });
    }
    if (moderation.action === 'block') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `[${WEBSITE_AI_CONTENT_BLOCKED.code}] ${WEBSITE_AI_CONTENT_BLOCKED.message}`,
      });
    }

    if (!input.topicId) {
      const intentProbe = createTravelToolDispatchPolicy({ members: [], message: input.message });
      if (intentProbe.route.intents.length !== 1 || intentProbe.route.intents[0] !== 'copy') {
        throw unavailable();
      }
    }

    let context: WebsiteAiCopyContext;
    try {
      const resolved = await resolveCopyContext(this.db, this.userId, this.workspaceId);
      if (!resolved) throw unavailable();
      context = resolved;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      const code =
        error && typeof error === 'object' && 'code' in error
          ? (error as { code?: unknown }).code
          : undefined;
      if (code === 'BALANCE_EMPTY') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `[${WEBSITE_AI_BALANCE_INSUFFICIENT.code}] ${WEBSITE_AI_BALANCE_INSUFFICIENT.message}`,
        });
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `[${WEBSITE_AI_BALANCE_CHECK_UNAVAILABLE.code}] ${WEBSITE_AI_BALANCE_CHECK_UNAVAILABLE.message}`,
      });
    }

    const previousTurn = input.topicId
      ? await websiteAiPreviousTurnStore.read({
          groupId: context.groupId,
          topicId: input.topicId,
          userId: this.userId,
          workspaceId: this.workspaceId,
        })
      : undefined;
    const dispatch = createTravelToolDispatchPolicy({
      members: context.routingMembers,
      message: input.message,
      previousTurn,
    });
    if (
      dispatch.mode !== 'delegate' ||
      dispatch.route.intents.length !== 1 ||
      dispatch.route.intents[0] !== 'copy' ||
      dispatch.route.memberIds.length !== 1 ||
      dispatch.route.memberIds[0] !== context.copywriterId
    ) {
      throw unavailable();
    }

    if (input.topicId) {
      const topic = await new TopicModel(this.db, this.userId, this.workspaceId).findById(
        input.topicId,
      );
      if (!topic || topic.groupId !== context.groupId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic not found' });
      }
    }

    const admission = await this.operationModel.reserveWebsiteAiAdmission({
      activeLimit: WEBSITE_AI_ACTIVE_OPERATION_LIMIT,
      agentId: context.supervisorId,
      chatGroupId: context.groupId,
      recentLimit: WEBSITE_AI_REQUESTS_PER_MINUTE_LIMIT,
      recentSince: new Date(Date.now() - 60_000),
      reservationId: admissionId,
    });
    if (admission === 'active_limit') {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: '已有制作任务正在进行，请等待完成后再试',
      });
    }
    if (admission === 'recent_limit') {
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: '请求过于频繁' });
    }

    try {
      const sharedBudget = await createPlatformUsageSharedBudget(this.db, this.userId, {
        expiresAt: new Date(Date.now() + COPY_BUDGET_LEASE_MS),
        maxCredits: input.maxCredits as number,
        requestIdentity: input.requestIdentity,
        workspaceId: this.workspaceId,
      });
      const toolDispatchPolicy = {
        ...dispatch.policy,
        steps: dispatch.policy.steps.map((step) => ({
          ...step,
          memberToolDispatchPolicies: {
            [context.copywriterId]: {
              cursor: 0,
              finishAfterSteps: true,
              steps: [],
              version: 1 as const,
            },
          },
        })),
      };
      const result = await new AiAgentService(this.db, this.userId, {
        workspaceId: this.workspaceId,
      }).execPlatformManagedGroupAgent(
        {
          agentId: context.supervisorId,
          groupId: context.groupId,
          message: input.message,
          suppressSignal: true,
          toolDispatchPolicy,
          topicId: input.topicId,
        },
        { maxCredits: input.maxCredits as number, sharedBudget },
      );
      if (!result.success) throw new Error('Website AI group execution did not start');

      await this.operationModel.recordCompletion(admissionId, {
        completedAt: new Date(),
        completionReason: 'done',
        status: 'done',
      });
      const previousTurnHandle = await websiteAiPreviousTurnStore.begin(
        {
          groupId: context.groupId,
          topicId: result.topicId,
          userId: this.userId,
          workspaceId: this.workspaceId,
        },
        dispatch.route.intents,
      );
      return {
        ...result,
        previousTurnHandle,
        progressMembers: context.progressMembers,
        responseDelivery: WEBSITE_AI_SETTLEMENT_GATED_TEXT,
      };
    } catch (error) {
      await this.operationModel
        .recordCompletion(admissionId, {
          completedAt: new Date(),
          completionReason: 'error',
          status: 'error',
        })
        .catch(() => false);
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: '官网 AI 服务暂时不可用。',
      });
    }
  }

  async assertOwnOperation(operationId: string) {
    const operation = await this.operationModel.findById(operationId);
    if (!operation) throw new TRPCError({ code: 'NOT_FOUND', message: 'Operation not found' });
    return operation;
  }

  streamManager() {
    return createStreamEventManager();
  }
}
