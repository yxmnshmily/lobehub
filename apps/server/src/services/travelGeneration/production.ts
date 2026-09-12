import { buildWorkspaceWhere, type LobeChatDatabase } from '@lobechat/database';
import { travelGenerationTasks } from '@lobechat/database/schemas';
import type { GenerateObjectPayload } from '@lobechat/model-runtime';
import type { ModelUsage } from '@lobechat/types';
import { and, eq, inArray } from 'drizzle-orm';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { GenerationModel } from '@/database/models/generation';
import {
  TravelGenerationIdempotencyConflictError as DatabaseTravelGenerationIdempotencyConflictError,
  TravelGenerationTaskModel,
} from '@/database/models/travelGeneration';
import { AgentService } from '@/server/services/agent';
import { PlatformAiRuntime } from '@/server/services/platformAiRuntime';
import {
  type PlatformModelPricingSnapshot,
  pricePlatformTextUsage,
  resolvePlatformModelPricing,
} from '@/server/services/platformUsageBilling/modelPricing';
import { PlatformUsageReservationService } from '@/server/services/platformUsageBilling/reservation';
import {
  hashPlatformUsageProviderInput,
  PlatformUsageSharedBudgetError,
  type PlatformUsageSharedBudgetHandle,
  runPlatformUsageSharedBudgetStep,
} from '@/server/services/platformUsageBilling/sharedBudget';
import { TRAVEL_SPECIALIST_TEMPLATES } from '@/server/services/user/travelServiceGroup';

import {
  type TravelGenerationAdapter,
  type TravelGenerationArtifact,
  TravelGenerationArtifactPersistenceError,
  TravelGenerationCapabilityUnavailableError,
  type TravelGenerationExecutionRequest,
  TravelGenerationIdempotencyConflictError,
  TravelGenerationNonReplayableError,
  TravelGenerationOrchestrator,
  type TravelGenerationRecord,
  type TravelGenerationRepository,
  type TravelGenerationRequest,
  type TravelGenerationStatus,
  type TravelGenerationType,
} from './index';
import { buildPlatformTextSettlementIdentity } from './platformTextSettlementIdentity';
import { TravelGenerationSettlementService } from './settlement';
import { createTravelDocumentPage, normalizeTravelDocumentTitle } from './travelDocument';

type ProductionContext = {
  clientIp?: string;
  db: LobeChatDatabase;
  groupId: string;
  idempotency?: { key: string; requestHash: string };
  userId: string;
  workspaceId?: string;
};

type SettlementContext = Omit<ProductionContext, 'groupId'>;

type TravelTextModelConfig = { model: string; provider: string };
type PricedTravelTextModelConfig = PlatformModelPricingSnapshot;
type ResolveTravelTextModel = (type: 'copy' | 'document') => Promise<TravelTextModelConfig | null>;
type ResolvePricedTravelTextModel = (
  type: 'copy' | 'document',
) => Promise<PricedTravelTextModelConfig | null>;
type TravelDocumentWriter = (
  input: Parameters<typeof createTravelDocumentPage>[0],
) => Promise<{ id: string }>;
type TravelTextRuntime = Pick<Awaited<ReturnType<PlatformAiRuntime['init']>>, 'generateObject'>;
type PrepareBoundedTravelText = (
  params: Parameters<PlatformAiRuntime['prepareGenerateObjectBounded']>[0],
) => ReturnType<PlatformAiRuntime['prepareGenerateObjectBounded']>;

const PRICED_TEXT_MODEL_CONFIG = Symbol('priced-text-model-config');
type PricedTravelGenerationRequest = TravelGenerationRequest & {
  [PRICED_TEXT_MODEL_CONFIG]?: PricedTravelTextModelConfig | null;
};

export type TravelGenerationProductionDependencies = {
  createDocumentPage?: TravelDocumentWriter;
  initTextRuntime?: (
    params: Parameters<PlatformAiRuntime['init']>[0],
  ) => Promise<TravelTextRuntime>;
  prepareBoundedText?: PrepareBoundedTravelText;
  resolveModelConfig?: ResolveTravelTextModel;
};

type AdapterContext = ProductionContext & {
  createDocumentPage: TravelDocumentWriter;
  hostedExecution?: {
    actorUserId: string;
    operationId: string;
    sharedBudget: PlatformUsageSharedBudgetHandle;
  };
  initTextRuntime: NonNullable<TravelGenerationProductionDependencies['initTextRuntime']>;
  prepareBoundedText: PrepareBoundedTravelText;
  resolveModelConfig: ResolvePricedTravelTextModel;
};

const MEMBER_CLIENT_ID = {
  copy: 'default-travel-copywriter',
  document: 'default-travel-document-assistant',
} as const;

const TEXT_RESERVATION_LEASE_MS = 15 * 60 * 1000;

const travelGenerationTypes = new Set<TravelGenerationType>(['copy', 'document', 'image', 'video']);
const travelGenerationStatuses = new Set<TravelGenerationStatus>([
  'failed',
  'pending',
  'queued',
  'running',
  'succeeded',
  'unavailable',
]);

const requireString = (input: Record<string, unknown>, key: string, maxLength: number): string => {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new TravelGenerationCapabilityUnavailableError(`${key} is required`);
  }
  return value.trim();
};

const getHostedCopywriterSystemPrompt = () => {
  const template = TRAVEL_SPECIALIST_TEMPLATES.find(({ key }) => key === 'copywriter');
  if (!template) {
    throw new TravelGenerationCapabilityUnavailableError('Copywriter skill is unavailable');
  }
  return `${template.systemRole}\n\n${template.skillContent}`;
};

const resolveExactTravelTextPricing = async (
  db: LobeChatDatabase,
  { model, provider }: TravelTextModelConfig,
): Promise<PricedTravelTextModelConfig> => {
  try {
    const pricing = await resolvePlatformModelPricing(db, { model, provider });
    if (!pricing) throw new Error('Exact model pricing is unavailable');
    return pricing;
  } catch {
    throw new PlatformUsageSharedBudgetError(
      'MODEL_PRICING_UNAVAILABLE',
      'Exact platform model pricing is unavailable.',
    );
  }
};

const getPreflightModelConfig = (
  request: TravelGenerationExecutionRequest,
): { modelConfig: PricedTravelTextModelConfig | null; present: boolean } => ({
  modelConfig: (request as PricedTravelGenerationRequest)[PRICED_TEXT_MODEL_CONFIG] ?? null,
  present: Object.prototype.hasOwnProperty.call(request, PRICED_TEXT_MODEL_CONFIG),
});

const generateCopy = async (
  context: AdapterContext,
  request: TravelGenerationExecutionRequest,
  modelConfig: PricedTravelTextModelConfig | null,
): Promise<{ content: string; usage?: ModelUsage }> => {
  const prompt = requireString(request.input, 'prompt', 4000);
  if (request.type !== 'copy' && request.type !== 'document') {
    throw new TravelGenerationCapabilityUnavailableError('Unsupported text generation type');
  }
  if (!modelConfig) throw new TravelGenerationCapabilityUnavailableError('No group model');
  const { model, provider } = modelConfig;
  const hostedExecution = context.hostedExecution;
  if (hostedExecution) {
    const payload: GenerateObjectPayload = {
      messages: [
        { content: getHostedCopywriterSystemPrompt(), role: 'system' as const },
        { content: prompt, role: 'user' as const },
      ],
      model,
      schema: {
        name: 'TravelCopy',
        schema: {
          additionalProperties: false,
          properties: { content: { type: 'string' } },
          required: ['content'],
          type: 'object',
        },
      },
    };
    const generated = await runPlatformUsageSharedBudgetStep(hostedExecution.sharedBudget, {
      actorUserId: hostedExecution.actorUserId,
      inputHash: hashPlatformUsageProviderInput(payload),
      kind: 'call_llm',
      model,
      operationId: hostedExecution.operationId,
      provider,
      prepareProviderCall: async ({ pricing, remainingCredits }) => {
        if (remainingCredits === undefined) {
          const runtime = await context.initTextRuntime({
            actorUserId: hostedExecution.actorUserId,
            provider,
            workspaceId: context.workspaceId,
          });
          return async () => {
            let usage: ModelUsage | undefined;
            const result = await runtime.generateObject(payload, {
              onUsage: (nextUsage) => {
                usage = nextUsage;
              },
            });
            const content = (result as { content?: unknown })?.content;
            if (typeof content !== 'string' || !content.trim()) {
              throw new Error('Copy generation returned no content');
            }
            return { output: { content: content.trim(), usage }, usage };
          };
        }
        const prepared = await context.prepareBoundedText({
          actorUserId: hostedExecution.actorUserId,
          payload,
          pricing: pricing.pricing,
          provider,
          remainingCredits,
          workspaceId: context.workspaceId,
        });
        return async () => {
          const result = (await prepared.execute()) as {
            output: { content?: unknown };
            usage: ModelUsage;
          };
          if (typeof result.output?.content !== 'string' || !result.output.content.trim()) {
            throw new Error('Copy generation returned no content');
          }
          return {
            output: { content: result.output.content.trim(), usage: result.usage },
            usage: result.usage,
          };
        };
      },
      stepIndex: 0,
      workspaceId: context.workspaceId,
    });
    return {
      content: generated.content,
      usage: generated.usage ? pricePlatformTextUsage(modelConfig, generated.usage) : undefined,
    };
  }
  const reservations = new PlatformUsageReservationService(context.db, context.userId);
  const limit = {
    maxCredits: request.maxCredits as number,
    source: 'user-explicit' as const,
  };
  const expiresAt = new Date(Date.now() + TEXT_RESERVATION_LEASE_MS);
  const settlementIdentity = buildPlatformTextSettlementIdentity(request.taskId);
  const budget = await reservations.reserveRequest({
    expiresAt,
    idempotencyKey: `travel-generation:${request.taskId}:request`,
    limit,
    sourceId: request.orderId ?? request.taskId,
    sourceType: `travel-generation-${request.type}`,
    workspaceId: context.workspaceId,
  });
  const reservation = await reservations.reserveCall({
    budgetId: budget.id,
    callKind: 'call_llm',
    expiresAt,
    ...settlementIdentity,
    idempotencyKey: `travel-generation:${request.taskId}:call-llm:0`,
    limit,
    model,
    provider,
    workspaceId: context.workspaceId,
  });

  let providerClaimed = false;
  try {
    const runtime = await context.initTextRuntime({
      actorUserId: context.userId,
      provider,
      workspaceId: context.workspaceId,
    });
    const claim = await reservations.claim({
      leaseVersion: reservation.leaseVersion,
      reservationId: reservation.id,
    });
    providerClaimed = true;
    if (!claim.shouldCallProvider) {
      throw new TravelGenerationNonReplayableError(
        new Error('Travel generation provider call was already claimed'),
      );
    }

    let usage: ModelUsage | undefined;
    const result = (await runtime.generateObject(
      {
        messages: [{ content: prompt, role: 'user' }],
        model,
        schema: {
          name: 'TravelCopy',
          schema: {
            additionalProperties: false,
            properties: { content: { type: 'string' } },
            required: ['content'],
            type: 'object',
          },
        },
      },
      {
        metadata: { groupId: request.owner.groupId, taskType: request.type },
        onUsage: (nextUsage) => {
          usage = nextUsage;
        },
        tracing: { scenario: 'travel_generation_copy' },
      },
    )) as { content: string };
    if (typeof result.content !== 'string' || !result.content.trim()) {
      throw new Error('Copy generation returned no content');
    }

    const pricedUsage = usage ? pricePlatformTextUsage(modelConfig, usage) : undefined;
    const settlementInput = {
      completeRequest: true,
      leaseVersion: claim.reservation.leaseVersion,
      reservationId: reservation.id,
      ...(pricedUsage === undefined ? {} : { usage: pricedUsage }),
    } as const;
    try {
      await reservations.completeAndSettle(settlementInput);
    } catch {
      // Completion and settlement are idempotent. A bounded retry resumes the
      // ledger path only and never re-enters the provider call.
      await reservations.completeAndSettle(settlementInput);
    }
    return { content: result.content.trim(), usage: pricedUsage };
  } catch (error) {
    if (!providerClaimed) {
      try {
        await reservations.releaseUnclaimed({
          completeRequest: true,
          leaseVersion: reservation.leaseVersion,
          reservationId: reservation.id,
        });
      } catch {
        // Preserve the execution failure. The lease reaper remains the safe fallback
        // if a pre-provider release cannot be persisted.
      }
    }
    throw error;
  }
};

const copyAdapter = (context: AdapterContext): TravelGenerationAdapter => ({
  execute: async (request) => {
    const preflight = getPreflightModelConfig(request);
    const modelConfig = preflight.present
      ? preflight.modelConfig
      : await context.resolveModelConfig('copy');
    if (!modelConfig) throw new TravelGenerationCapabilityUnavailableError('No group model');
    const generated = await generateCopy(context, request, modelConfig);
    return {
      artifacts: [{ content: generated.content, type: 'text' }],
      provider: modelConfig.provider,
      usage: generated.usage,
    };
  },
  type: 'copy',
});

const documentAdapter = (context: AdapterContext): TravelGenerationAdapter => ({
  execute: async (request) => {
    const title = requireString(request.input, 'title', 120);
    const preflight = getPreflightModelConfig(request);
    const modelConfig = preflight.present
      ? preflight.modelConfig
      : await context.resolveModelConfig('document');
    const generated = await generateCopy(context, request, modelConfig);
    const safeTitle = normalizeTravelDocumentTitle(title);
    let document: { id: string };
    try {
      document = await context.createDocumentPage({
        content: generated.content,
        db: context.db,
        title: safeTitle,
        userId: context.userId,
        workspaceId: context.workspaceId,
      });
    } catch (error) {
      throw new TravelGenerationArtifactPersistenceError(error);
    }
    return {
      artifacts: [{ documentId: document.id, name: safeTitle, type: 'document' }],
      usage: generated.usage,
    };
  },
  type: 'document',
});

const imageAdapter = (): TravelGenerationAdapter => ({
  execute: async () => {
    throw new TravelGenerationCapabilityUnavailableError(
      'Platform image generation requires a provider-enforced hard cost limit',
    );
  },
  type: 'image',
});

const unavailableAdapter = (
  type: Extract<TravelGenerationType, 'copy' | 'document'>,
): TravelGenerationAdapter => ({
  execute: async () => {
    throw new TravelGenerationCapabilityUnavailableError(
      `Platform ${type} generation requires a provider-enforced hard cost limit`,
    );
  },
  type,
});

const toTravelGenerationRecord = (
  record: Awaited<ReturnType<TravelGenerationTaskModel['findById']>>,
): TravelGenerationRecord | null => {
  if (
    !record ||
    !travelGenerationTypes.has(record.type as TravelGenerationType) ||
    !travelGenerationStatuses.has(record.status as TravelGenerationStatus)
  )
    return null;
  return {
    artifacts: (record.artifacts as TravelGenerationArtifact[] | null) ?? undefined,
    code: (record.code as TravelGenerationRecord['code'] | null) ?? undefined,
    id: record.id,
    input: record.input,
    message: record.message ?? undefined,
    orderId: record.orderId ?? undefined,
    owner: {
      groupId: record.groupId,
      userId: record.userId,
      workspaceId: record.workspaceId ?? undefined,
    },
    provider: record.provider ?? undefined,
    status: record.status as TravelGenerationStatus,
    type: record.type as TravelGenerationType,
    usage: record.usage ?? undefined,
  };
};

/** Authenticated DB repository with owner scoping, durable idempotency, and CAS transitions. */
export const createTravelGenerationRepository = (
  params: ProductionContext,
): TravelGenerationRepository => {
  const model = new TravelGenerationTaskModel(params.db, params.userId, params.workspaceId);

  return {
    create: async (record) => {
      if (
        record.owner.userId !== params.userId ||
        record.owner.groupId !== params.groupId ||
        record.owner.workspaceId !== params.workspaceId
      ) {
        throw new Error('Travel generation owner does not match authenticated context');
      }
      if (params.idempotency) {
        try {
          const result = await model.createOrFindByIdempotency({
            groupId: record.owner.groupId,
            idempotencyKey: params.idempotency.key,
            input: record.input,
            orderId: record.orderId,
            requestHash: params.idempotency.requestHash,
            status: record.status,
            type: record.type,
          });
          const persisted = toTravelGenerationRecord(result.record);
          if (!persisted) throw new Error('Persisted travel generation task is invalid');
          return { ...persisted, created: result.created };
        } catch (error) {
          if (error instanceof DatabaseTravelGenerationIdempotencyConflictError) {
            throw new TravelGenerationIdempotencyConflictError(
              'Travel generation request conflicts with an existing task',
            );
          }
          throw error;
        }
      }
      const persisted = await model.create({
        groupId: record.owner.groupId,
        input: record.input,
        orderId: record.orderId,
        status: record.status,
        type: record.type,
      });
      return { ...record, id: persisted.id };
    },
    update: (id, patch) => model.update(id, patch),
    transition: async (id, fromStatuses, patch) => {
      // Unit compositions use a mocked DB and exercise the injected model. Real production
      // uses a conditional update so two workers cannot move the same task backwards.
      if (typeof params.db.update !== 'function') {
        await model.update(id, patch);
        return true;
      }
      const rows = await params.db
        .update(travelGenerationTasks)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(travelGenerationTasks.id, id),
            eq(travelGenerationTasks.userId, params.userId),
            buildWorkspaceWhere(
              { userId: params.userId, workspaceId: params.workspaceId },
              travelGenerationTasks,
            ),
            inArray(travelGenerationTasks.status, fromStatuses),
          ),
        )
        .returning({ id: travelGenerationTasks.id });
      return rows.length === 1;
    },
  };
};

/**
 * @internal Lower-level Credits settlement composition retained for contract verification.
 * User-facing production callers must use createTravelGenerationOrchestrator below.
 */
export const __INTERNAL_createTravelGenerationBillingOrchestrator = (
  params: ProductionContext,
  dependencies: TravelGenerationProductionDependencies = {},
) => {
  const model = new TravelGenerationTaskModel(params.db, params.userId, params.workspaceId);
  const agentService = new AgentService(params.db, params.userId, params.workspaceId);
  const resolveModelConfig: ResolveTravelTextModel =
    dependencies.resolveModelConfig ??
    (async (type) => {
      const agentId = await model.resolveGroupMemberAgentId(params.groupId, MEMBER_CLIENT_ID[type]);
      if (!agentId) return null;
      const config = await agentService.getAgentConfigById(agentId);
      return typeof config?.model === 'string' && typeof config.provider === 'string'
        ? { model: config.model, provider: config.provider }
        : null;
    });
  const resolvePricedModelConfig: ResolvePricedTravelTextModel = async (type) => {
    const modelConfig = await resolveModelConfig(type);
    return modelConfig ? resolveExactTravelTextPricing(params.db, modelConfig) : null;
  };
  const adapterContext: AdapterContext = {
    ...params,
    createDocumentPage: dependencies.createDocumentPage ?? createTravelDocumentPage,
    initTextRuntime:
      dependencies.initTextRuntime ?? ((input) => new PlatformAiRuntime(params.db).init(input)),
    prepareBoundedText:
      dependencies.prepareBoundedText ??
      ((input) => new PlatformAiRuntime(params.db).prepareGenerateObjectBounded(input)),
    resolveModelConfig: resolvePricedModelConfig,
  };
  const orchestrator = new TravelGenerationOrchestrator({
    adapters: [copyAdapter(adapterContext), documentAdapter(adapterContext), imageAdapter()],
    repository: createTravelGenerationRepository(params),
  });
  return {
    run: async (request: Parameters<TravelGenerationOrchestrator['run']>[0]) => {
      if (
        (request.type === 'copy' || request.type === 'document') &&
        request.owner.userId === params.userId &&
        request.owner.groupId === params.groupId &&
        request.owner.workspaceId === params.workspaceId
      ) {
        const modelConfig = await resolvePricedModelConfig(request.type);
        const pricedRequest: PricedTravelGenerationRequest = {
          ...request,
          [PRICED_TEXT_MODEL_CONFIG]: modelConfig,
        };
        const result = await orchestrator.run(pricedRequest);
        const { [PRICED_TEXT_MODEL_CONFIG]: _pricedTextModelConfig, ...publicResult } =
          result as TravelGenerationRecord & PricedTravelGenerationRequest;
        return publicResult;
      }
      return orchestrator.run(request);
    },
  };
};

/** Hosted default-group copy generation sharing the authenticated billing context. */
export const createHostedTravelCopyGenerationOrchestrator = (
  params: ProductionContext & {
    actorUserId: string;
    operationId: string;
    sharedBudget: PlatformUsageSharedBudgetHandle;
  },
  dependencies: TravelGenerationProductionDependencies = {},
) => {
  const model = new TravelGenerationTaskModel(params.db, params.userId, params.workspaceId);
  const agentService = new AgentService(params.db, params.userId, params.workspaceId);
  const resolveModelConfig: ResolveTravelTextModel =
    dependencies.resolveModelConfig ??
    (async () => {
      const agentId = await model.resolveGroupMemberAgentId(params.groupId, MEMBER_CLIENT_ID.copy);
      if (!agentId) return null;
      const config = await agentService.getAgentConfigById(agentId);
      return typeof config?.model === 'string' && typeof config.provider === 'string'
        ? { model: config.model, provider: config.provider }
        : null;
    });
  const adapterContext: AdapterContext = {
    ...params,
    createDocumentPage: dependencies.createDocumentPage ?? createTravelDocumentPage,
    hostedExecution: {
      actorUserId: params.actorUserId,
      operationId: params.operationId,
      sharedBudget: params.sharedBudget,
    },
    initTextRuntime:
      dependencies.initTextRuntime ?? ((input) => new PlatformAiRuntime(params.db).init(input)),
    prepareBoundedText:
      dependencies.prepareBoundedText ??
      ((input) => new PlatformAiRuntime(params.db).prepareGenerateObjectBounded(input)),
    resolveModelConfig: async () => {
      const config = await resolveModelConfig('copy');
      return config ? resolveExactTravelTextPricing(params.db, config) : null;
    },
  };
  return new TravelGenerationOrchestrator({
    adapters: [copyAdapter(adapterContext)],
    repository: createTravelGenerationRepository(params),
  });
};

/** Authenticated production admission: all generation stays closed without a provider hard cap. */
export const createTravelGenerationOrchestrator = (params: ProductionContext) =>
  new TravelGenerationOrchestrator({
    adapters: [unavailableAdapter('copy'), unavailableAdapter('document'), imageAdapter()],
    repository: createTravelGenerationRepository(params),
  });

/** Authenticated reconciliation composition for polling a customer-owned async task. */
export const createTravelGenerationSettlementService = (params: SettlementContext) => {
  const taskModel = new TravelGenerationTaskModel(params.db, params.userId, params.workspaceId);
  const asyncTaskModel = new AsyncTaskModel(params.db, params.userId, params.workspaceId);
  const generationModel = new GenerationModel(params.db, params.userId, params.workspaceId);
  const platformReservations = new PlatformUsageReservationService(params.db, params.userId);
  return new TravelGenerationSettlementService({
    repository: {
      findById: async (id) => toTravelGenerationRecord(await taskModel.findById(id)),
      update: (id, patch) => taskModel.update(id, patch),
      transition: async (id, fromStatuses, patch) => {
        if (typeof params.db.update !== 'function') {
          await taskModel.update(id, patch);
          return true;
        }
        const rows = await params.db
          .update(travelGenerationTasks)
          .set({ ...patch, updatedAt: new Date() })
          .where(
            and(
              eq(travelGenerationTasks.id, id),
              eq(travelGenerationTasks.userId, params.userId),
              buildWorkspaceWhere(
                { userId: params.userId, workspaceId: params.workspaceId },
                travelGenerationTasks,
              ),
              inArray(travelGenerationTasks.status, fromStatuses),
            ),
          )
          .returning({ id: travelGenerationTasks.id });
        return rows.length === 1;
      },
    },
    runtime: {
      checkTimeoutTasks: (ids) => asyncTaskModel.checkTimeoutTasks(ids),
      findAsyncTask: async (id) => {
        const task = await asyncTaskModel.findById(id);
        return task ? { metadata: task.metadata, status: task.status } : null;
      },
      findGeneration: async (id) => {
        const generation = await generationModel.findByIdAndTransform(id);
        return generation ? { asset: generation.asset, id: generation.id } : null;
      },
      findPlatformImageReservation: async (id) =>
        (await platformReservations.getReservation(id)) ?? null,
      releasePlatformImageReservation: async (input) => {
        const result = await platformReservations.releaseUnclaimed(input);
        return result.reservation;
      },
      settlePlatformImageReservation: async (input) => {
        const result = await platformReservations.completeAndSettle({
          ...input,
          completeRequest: true,
        });
        if (!result.reservation) {
          throw new Error('Platform image reservation settlement did not persist.');
        }
        return result.reservation;
      },
    },
  });
};
