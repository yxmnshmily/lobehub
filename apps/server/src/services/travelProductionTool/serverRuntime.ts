import type {
  GenerateTravelCopyParams,
  GenerateTravelDocumentParams,
  GenerateTravelImageParams,
  GenerateTravelVideoParams,
} from '@lobechat/builtin-tool-travel-production';
import { TravelProductionIdentifier } from '@lobechat/builtin-tool-travel-production';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import { AgentModel } from '@/database/models/agent';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { getPlatformManagedExecutionContext } from '@/server/services/aiAgent/platformManagedExecution';
import { getPlatformUsageSharedBudgetLimit } from '@/server/services/platformUsageBilling/sharedBudget';
import {
  TravelGenerationIdempotencyConflictError,
  TravelGenerationNonReplayableError,
  type TravelGenerationType,
} from '@/server/services/travelGeneration';
import { deriveTravelToolIdempotency } from '@/server/services/travelGeneration/idempotency';
import {
  createHostedTravelCopyGenerationOrchestrator,
  createTravelGenerationOrchestrator,
} from '@/server/services/travelGeneration/production';
import { toPublicTravelGenerationTask } from '@/server/services/travelGeneration/public';
import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@/server/services/user/travelServiceGroup';

import type { ServerRuntimeRegistration } from '../toolExecution/serverRuntimes/types';
import type { ToolExecutionContext } from '../toolExecution/types';

type TravelProductionType = Extract<TravelGenerationType, 'copy' | 'document' | 'image' | 'video'>;

const MEMBER_CLIENT_ID: Record<TravelProductionType, string> = {
  copy: 'default-travel-copywriter',
  document: 'default-travel-document-assistant',
  image: 'default-travel-image-designer',
  video: 'default-travel-video-producer',
};

const TASK_TITLE: Record<TravelProductionType, string> = {
  copy: '旅游文案制作',
  document: '旅游文档制作',
  image: '旅游图片制作',
  video: '旅游视频制作',
};
const UNAVAILABLE_PRODUCTION_TYPES = new Set<TravelProductionType>(['document', 'image', 'video']);

const executionCache = new Map<
  string,
  { createdAt: number; promise: Promise<BuiltinServerRuntimeOutput> }
>();
const EXECUTION_CACHE_TTL = 10 * 60 * 1000;
const EXECUTION_CACHE_MAX = 500;

const errorResult = (code: string, content: string): BuiltinServerRuntimeOutput => ({
  content,
  error: { code, message: content },
  success: false,
});

const validPrompt = (value: unknown) =>
  typeof value === 'string' && Boolean(value.trim()) && value.trim().length <= 4000;

const validCopyParams = (params: GenerateTravelCopyParams) =>
  Boolean(params) &&
  typeof params === 'object' &&
  Object.keys(params).every((key) => key === 'prompt') &&
  validPrompt(params.prompt);

const validImageParams = (params: GenerateTravelImageParams) =>
  Boolean(params) &&
  typeof params === 'object' &&
  Object.keys(params).every((key) => key === 'imageNum' || key === 'prompt') &&
  validPrompt(params.prompt) &&
  (params.imageNum === undefined || params.imageNum === 1);

const validDocumentParams = (params: GenerateTravelDocumentParams) =>
  Boolean(params) &&
  typeof params === 'object' &&
  Object.keys(params).every((key) => key === 'prompt' || key === 'title') &&
  validPrompt(params.prompt) &&
  (params.title === undefined ||
    (typeof params.title === 'string' &&
      Boolean(params.title.trim()) &&
      params.title.trim().length <= 120));

const validVideoParams = (params: GenerateTravelVideoParams) =>
  Boolean(params) &&
  typeof params === 'object' &&
  Object.keys(params).every((key) => key === 'prompt') &&
  validPrompt(params.prompt);

const taskError = (code: string | undefined): BuiltinServerRuntimeOutput => {
  if (code === 'CAPABILITY_UNAVAILABLE') {
    return errorResult('CAPABILITY_UNAVAILABLE', '当前制作模型尚未配置，请联系平台管理员。');
  }
  return errorResult('GENERATION_FAILED', '制作任务未能完成，请稍后重试。');
};

class TravelProductionExecutionRuntime {
  constructor(private readonly context: ToolExecutionContext) {}

  private executionKey(type: TravelProductionType): string | undefined {
    const { agentId, groupId, operationId, toolCallId, userId, workspaceId } = this.context;
    if (!operationId || !toolCallId || !userId || !groupId || !agentId) return undefined;
    return JSON.stringify([
      userId,
      workspaceId ?? '',
      groupId,
      agentId,
      operationId,
      toolCallId,
      type,
    ]);
  }

  private execute(
    type: TravelProductionType,
    input: Record<string, unknown>,
  ): Promise<BuiltinServerRuntimeOutput> {
    const key = this.executionKey(type);
    if (!key) return this.executeOnce(type, input);
    const cached = executionCache.get(key);
    if (cached && Date.now() - cached.createdAt < EXECUTION_CACHE_TTL) return cached.promise;
    if (cached) executionCache.delete(key);

    const promise = this.executeOnce(type, input);
    executionCache.set(key, { createdAt: Date.now(), promise });
    void promise.then(
      (result) => {
        if (result.error?.code === 'TOOL_ERROR' && executionCache.get(key)?.promise === promise) {
          executionCache.delete(key);
        }
      },
      () => {
        if (executionCache.get(key)?.promise === promise) executionCache.delete(key);
      },
    );
    while (executionCache.size > EXECUTION_CACHE_MAX) {
      const oldestKey = executionCache.keys().next().value;
      if (typeof oldestKey !== 'string') break;
      executionCache.delete(oldestKey);
    }
    return promise;
  }

  private async executeOnce(
    type: TravelProductionType,
    input: Record<string, unknown>,
  ): Promise<BuiltinServerRuntimeOutput> {
    const { agentId, clientIp, groupId, operationId, serverDB, toolCallId, userId, workspaceId } =
      this.context;
    if (!agentId || !groupId || !operationId || !serverDB || !toolCallId || !userId) {
      return errorResult('TOOL_FORBIDDEN', '当前运行上下文无权使用旅游制作服务。');
    }
    const capability = getPlatformManagedExecutionContext(this.context);
    if (
      !capability?.actorUserId ||
      !capability.resourceOwnerUserId ||
      capability.resourceOwnerUserId !== userId
    ) {
      return errorResult('TOOL_FORBIDDEN', '当前运行上下文无权使用旅游制作服务。');
    }
    let maxCredits: number | undefined;
    try {
      maxCredits = capability.sharedBudget
        ? getPlatformUsageSharedBudgetLimit(capability.sharedBudget, {
            actorUserId: capability.actorUserId,
            workspaceId,
          })
        : Number.NaN;
    } catch {
      maxCredits = Number.NaN;
    }
    if (maxCredits !== undefined && (!Number.isSafeInteger(maxCredits) || maxCredits <= 0)) {
      return errorResult(
        'GENERATION_LIMIT_REQUIRED',
        '提交制作任务前必须设置有效的 Credits 上限。',
      );
    }

    try {
      const groupModel = new ChatGroupModel(serverDB, userId, workspaceId);
      const agentModel = new AgentModel(serverDB, userId, workspaceId);
      const [group, productionAgent] = await Promise.all([
        groupModel.findByClientId(DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
        agentModel.findByClientId(MEMBER_CLIENT_ID[type]),
      ]);
      const members = group ? await groupModel.getGroupAgents(group.id) : [];
      if (
        !group ||
        group.visibility !== 'private' ||
        group.id !== groupId ||
        !productionAgent ||
        productionAgent.id !== agentId ||
        !members.some((member) => member.agentId === agentId && member.enabled !== false)
      ) {
        return errorResult('TOOL_FORBIDDEN', '仅默认私人旅游群的对应制作助理可使用此工具。');
      }
      if (UNAVAILABLE_PRODUCTION_TYPES.has(type)) {
        return errorResult(
          'CAPABILITY_UNAVAILABLE',
          '当前生成服务尚未提供服务端可强制的成本上限，暂不提交生成任务。',
        );
      }
      const task = await (
        type === 'copy' && capability.sharedBudget
          ? createHostedTravelCopyGenerationOrchestrator({
              actorUserId: capability.actorUserId,
              clientIp,
              db: serverDB,
              groupId,
              idempotency: deriveTravelToolIdempotency({ input, operationId, toolCallId, type }),
              operationId,
              sharedBudget: capability.sharedBudget,
              userId,
              workspaceId,
            })
          : createTravelGenerationOrchestrator({
              clientIp,
              db: serverDB,
              groupId,
              idempotency: deriveTravelToolIdempotency({ input, operationId, toolCallId, type }),
              userId,
              workspaceId,
            })
      ).run({
        input,
        maxCredits,
        owner: { groupId, userId, workspaceId },
        type,
      });

      if (task.status === 'failed' || task.status === 'unavailable') return taskError(task.code);
      const publicTask = toPublicTravelGenerationTask(task);
      const generatedCopy =
        type === 'copy' && task.status === 'succeeded'
          ? task.artifacts?.find(
              (artifact) => artifact.type === 'text' && typeof artifact.content === 'string',
            )?.content
          : undefined;
      return {
        content: generatedCopy
          ? `${TASK_TITLE[type]}已完成。\n\n${generatedCopy}`
          : task.status === 'succeeded'
            ? `${TASK_TITLE[type]}已完成。`
            : `${TASK_TITLE[type]}任务已提交，任务编号：${task.id}。`,
        state: { travelGeneration: publicTask },
        success: true,
      };
    } catch (error) {
      if (error instanceof TravelGenerationIdempotencyConflictError) {
        return errorResult(
          'IDEMPOTENCY_CONFLICT',
          '同一制作请求标识已用于不同内容，请发起新的制作请求。',
        );
      }
      if (error instanceof TravelGenerationNonReplayableError) {
        return errorResult(
          'GENERATION_INTERRUPTED',
          '制作任务状态待确认，为避免重复处理不会自动重试。',
        );
      }
      return errorResult('TOOL_ERROR', '旅游制作任务暂时无法提交，请稍后重试。');
    }
  }

  generateCopy = async (params: GenerateTravelCopyParams): Promise<BuiltinServerRuntimeOutput> => {
    if (!validCopyParams(params)) {
      return errorResult('INVALID_ARGUMENTS', '文案生成只接受有效的 prompt。');
    }
    return this.execute('copy', { prompt: params.prompt.trim() });
  };

  generateDocument = async (
    params: GenerateTravelDocumentParams,
  ): Promise<BuiltinServerRuntimeOutput> => {
    if (!validDocumentParams(params)) {
      return errorResult('INVALID_ARGUMENTS', '文档生成只接受有效的 prompt 和可选 title。');
    }
    return this.execute('document', {
      prompt: params.prompt.trim(),
      title: params.title?.trim() || '旅游文档',
    });
  };

  generateImage = async (
    params: GenerateTravelImageParams,
  ): Promise<BuiltinServerRuntimeOutput> => {
    if (!validImageParams(params)) {
      return errorResult(
        'INVALID_ARGUMENTS',
        '图片生成只接受有效的 prompt，并且每次只生成 1 张图片。',
      );
    }
    return this.execute('image', {
      ...(params.imageNum === undefined ? {} : { imageNum: params.imageNum }),
      prompt: params.prompt.trim(),
    });
  };

  generateVideo = async (
    params: GenerateTravelVideoParams,
  ): Promise<BuiltinServerRuntimeOutput> => {
    if (!validVideoParams(params)) {
      return errorResult('INVALID_ARGUMENTS', '视频生成只接受有效的 prompt。');
    }
    return this.execute('video', { prompt: params.prompt.trim() });
  };
}

export const travelProductionRuntime: ServerRuntimeRegistration = {
  factory: (context) => new TravelProductionExecutionRuntime(context),
  identifier: TravelProductionIdentifier,
};
