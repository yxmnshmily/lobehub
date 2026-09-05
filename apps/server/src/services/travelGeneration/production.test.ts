import type * as DatabaseModule from '@lobechat/database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentModel } from '@/database/models/document';
import { TravelGenerationTaskModel } from '@/database/models/travelGeneration';
import { preparePlatformUsageCharge } from '@/server/services/platformUsageBilling';

import { TravelGenerationNonReplayableError, type TravelGenerationStatus } from './index';
import {
  __INTERNAL_createTravelGenerationBillingOrchestrator as createTravelGenerationOrchestrator,
  createHostedTravelCopyGenerationOrchestrator,
  createTravelGenerationOrchestrator as createProductionTravelGenerationOrchestrator,
  createTravelGenerationSettlementService,
} from './production';

const {
  create,
  createOrFindByIdempotency,
  createDocument,
  createGenerationTopic,
  createMarkdownEditorSnapshot,
  createVideo,
  checkTimeoutTasks,
  claimReservedUsage,
  completeReservedUsage,
  findAsyncTask,
  findGeneration,
  findTravelTask,
  generateImage,
  generateObject,
  getAiProviderModelList,
  getAiProviderRuntimeState,
  getAgentConfigById,
  getReservedUsage,
  imageRuntimeFactory,
  initPlatformRuntime,
  listImageModels,
  listPlatformModels,
  markPlatformAiRuntime,
  prepareBoundedPlatformRuntime,
  pricePlatformTextUsage,
  resolveGroupMemberAgentId,
  resolvePlatformModelPricing,
  runSharedBudgetStep,
  releaseUnclaimedUsage,
  reserveUsageCall,
  reserveUsageRequest,
  assertTextCredits,
  settleTextCredits,
  update,
} = vi.hoisted(() => ({
  create: vi.fn(),
  createOrFindByIdempotency: vi.fn(),
  createDocument: vi.fn(),
  createGenerationTopic: vi.fn(),
  createMarkdownEditorSnapshot: vi.fn(),
  createVideo: vi.fn(),
  checkTimeoutTasks: vi.fn(),
  claimReservedUsage: vi.fn(),
  completeReservedUsage: vi.fn(),
  findAsyncTask: vi.fn(),
  findGeneration: vi.fn(),
  findTravelTask: vi.fn(),
  generateImage: vi.fn(),
  generateObject: vi.fn(),
  getAiProviderModelList: vi.fn(),
  getAiProviderRuntimeState: vi.fn(),
  getAgentConfigById: vi.fn(),
  getReservedUsage: vi.fn(),
  imageRuntimeFactory: vi.fn(),
  initPlatformRuntime: vi.fn(),
  listImageModels: vi.fn(),
  listPlatformModels: vi.fn(),
  markPlatformAiRuntime: vi.fn((value) => ({ ...value, trustedPlatformRuntime: true })),
  prepareBoundedPlatformRuntime: vi.fn(),
  pricePlatformTextUsage: vi.fn((_snapshot, usage) => usage),
  resolveGroupMemberAgentId: vi.fn(),
  resolvePlatformModelPricing: vi.fn(),
  runSharedBudgetStep: vi.fn(),
  releaseUnclaimedUsage: vi.fn(),
  reserveUsageCall: vi.fn(),
  reserveUsageRequest: vi.fn(),
  assertTextCredits: vi.fn(),
  settleTextCredits: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@lobechat/database', async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
}));

vi.mock('@/database/models/travelGeneration', () => ({
  TravelGenerationIdempotencyConflictError: class extends Error {},
  TravelGenerationTaskModel: vi.fn(() => ({
    create,
    createOrFindByIdempotency,
    findById: findTravelTask,
    resolveGroupMemberAgentId,
    update,
  })),
}));
vi.mock('@/server/services/toolExecution/serverRuntimes/imageGeneration', () => ({
  imageGenerationRuntime: {
    factory: imageRuntimeFactory.mockImplementation(() => ({ generateImage, listImageModels })),
  },
}));
vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn(() => ({ getAgentConfigById })),
}));
vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(() => ({ create: createDocument })),
}));
vi.mock('@/server/services/agentDocuments/headlessEditor', () => ({
  createMarkdownEditorSnapshot,
}));
vi.mock('@/database/models/asyncTask', () => ({
  AsyncTaskModel: vi.fn(() => ({ checkTimeoutTasks, findById: findAsyncTask })),
}));
vi.mock('@/database/models/generation', () => ({
  GenerationModel: vi.fn(() => ({ findByIdAndTransform: findGeneration })),
}));
vi.mock('@/database/models/generationTopic', () => ({
  GenerationTopicModel: vi.fn(() => ({ create: createGenerationTopic })),
}));
vi.mock('@/server/services/platformAiRuntime', () => ({
  markPlatformAiRuntime,
  PlatformAiRuntime: vi.fn().mockImplementation(() => ({
    init: initPlatformRuntime,
    listEnabledModels: listPlatformModels,
    prepareGenerateObjectBounded: prepareBoundedPlatformRuntime,
  })),
}));
vi.mock('@/server/services/platformUsageBilling/settlement', () => ({
  PlatformManagedTextUsageSettlement: vi.fn().mockImplementation(() => ({
    assertCanCallProvider: assertTextCredits,
    settleStep: settleTextCredits,
  })),
}));
vi.mock('@/server/services/platformUsageBilling/reservation', () => ({
  PlatformUsageReservationService: vi.fn().mockImplementation(() => ({
    claim: claimReservedUsage,
    completeAndSettle: completeReservedUsage,
    getReservation: getReservedUsage,
    releaseUnclaimed: releaseUnclaimedUsage,
    reserveCall: reserveUsageCall,
    reserveRequest: reserveUsageRequest,
  })),
}));
vi.mock('@/server/services/platformUsageBilling/modelPricing', () => ({
  pricePlatformTextUsage,
  resolvePlatformModelPricing,
}));
vi.mock('@/server/services/platformUsageBilling/sharedBudget', async (importOriginal) => ({
  ...(await importOriginal()),
  runPlatformUsageSharedBudgetStep: runSharedBudgetStep,
}));
vi.mock('@/server/routers/lambda/aiModel', () => ({
  aiModelRouter: { createCaller: vi.fn(() => ({ getAiProviderModelList })) },
}));
vi.mock('@/server/routers/lambda/aiProvider', () => ({
  aiProviderRouter: { createCaller: vi.fn(() => ({ getAiProviderRuntimeState })) },
}));
vi.mock('@/server/routers/lambda/video', () => ({
  videoRouter: { createCaller: vi.fn(() => ({ createVideo })) },
}));

describe('production travel generation composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TRAVEL_IMAGE_MODEL', '');
    vi.stubEnv('TRAVEL_IMAGE_PROVIDER', '');
    vi.stubEnv('TRAVEL_VIDEO_MODEL', '');
    vi.stubEnv('TRAVEL_VIDEO_PROVIDER', '');
    create.mockResolvedValue({ id: 'travel-task-1' });
    createOrFindByIdempotency.mockResolvedValue({
      created: true,
      record: {
        groupId: 'group-1',
        id: 'travel-task-1',
        input: { prompt: '桂林旅游封面' },
        status: 'queued',
        type: 'image',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
    });
    update.mockResolvedValue(undefined);
    generateObject.mockImplementation(async (_payload, options) => {
      await options?.onUsage?.({
        cost: 0.0123,
        totalInputTokens: 12,
        totalOutputTokens: 8,
        totalTokens: 20,
      });
      return { content: '桂林山水旅行文案' };
    });
    resolvePlatformModelPricing.mockImplementation(async (_db, reference) => ({
      ...reference,
      pricing: {
        currency: 'USD',
        units: [
          { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
          { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        ],
      },
    }));
    runSharedBudgetStep.mockImplementation(async (_budget, input) => {
      const providerCall = input.prepareProviderCall
        ? await input.prepareProviderCall({
            pricing: {
              currency: 'USD',
              model: input.model,
              pricing: {
                currency: 'USD',
                units: [
                  { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
                  { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
                ],
              },
              provider: input.provider,
            },
            remainingCredits: 37,
          })
        : input.providerCall;
      const completion = await providerCall();
      return completion.output;
    });
    prepareBoundedPlatformRuntime.mockResolvedValue({
      envelope: {
        inputTokens: 12,
        maximumCredits: 37,
        maxOutputTokens: 12,
        route: {
          apiType: 'anthropic',
          channelId: 'platform-channel',
          model: 'group-model',
          providerId: 'group-provider',
          routerId: 'platform-router',
        },
      },
      execute: vi.fn().mockResolvedValue({
        output: { content: '桂林山水旅行文案' },
        usage: {
          cost: 0.0123,
          totalInputTokens: 12,
          totalOutputTokens: 8,
          totalTokens: 20,
        },
      }),
    });
    initPlatformRuntime.mockResolvedValue({ generateObject });
    createDocument.mockResolvedValue({ id: 'document-1' });
    createMarkdownEditorSnapshot.mockImplementation(async (content: string) => ({
      content,
      editorData: { root: { children: [{ type: 'paragraph' }], type: 'root' } },
    }));
    createGenerationTopic.mockResolvedValue({ id: 'video-topic-1' });
    createVideo.mockResolvedValue({
      data: {
        batch: { id: 'video-batch-1' },
        generations: [{ asyncTaskId: 'async-video-1', id: 'video-generation-1' }],
      },
      success: true,
    });
    checkTimeoutTasks.mockResolvedValue(undefined);
    findAsyncTask.mockResolvedValue({ status: 'processing' });
    findGeneration.mockResolvedValue({
      asset: { type: 'image', url: '/f/travel-cover.png' },
      id: 'generation-1',
    });
    findTravelTask.mockResolvedValue(null);
    getAiProviderRuntimeState.mockResolvedValue({
      enabledVideoAiProviders: [{ id: 'video-provider' }],
    });
    getAiProviderModelList.mockResolvedValue([{ id: 'video-model' }]);
    listPlatformModels.mockResolvedValue({
      providers: [{ id: 'video-provider', models: [{ id: 'video-model' }] }],
    });
    resolveGroupMemberAgentId.mockImplementation(
      async (_groupId: string, clientId: string) => `agent:${clientId}`,
    );
    getAgentConfigById.mockResolvedValue({
      model: 'group-model',
      provider: 'group-provider',
    });
    listImageModels.mockResolvedValue({
      content: 'Available image generation models (1)',
      state: {
        providers: [{ id: 'volcengine', models: [{ id: 'doubao-seedream-5-0-260128' }] }],
        totalModels: 1,
      },
      success: true,
    });
    assertTextCredits.mockResolvedValue(undefined);
    settleTextCredits.mockResolvedValue(undefined);
    reserveUsageRequest.mockImplementation(async ({ limit }) => {
      if (!Number.isSafeInteger(limit?.maxCredits) || limit.maxCredits <= 0) {
        throw new Error('A reservation maximum must be a positive safe integer number of Credits.');
      }
      return { id: 'credit-budget-1' };
    });
    reserveUsageCall.mockResolvedValue({ id: 'credit-reservation-1', leaseVersion: 1 });
    claimReservedUsage.mockResolvedValue({
      reservation: { id: 'credit-reservation-1', leaseVersion: 1, status: 'provider_started' },
      shouldCallProvider: true,
    });
    completeReservedUsage.mockResolvedValue({
      entry: { id: 'credit-entry-1' },
      request: { id: 'credit-budget-1', status: 'settled' },
      reservation: { id: 'credit-reservation-1', status: 'settled' },
    });
    releaseUnclaimedUsage.mockResolvedValue({
      request: { id: 'credit-budget-1', status: 'settled' },
      reservation: { id: 'credit-reservation-1', status: 'released' },
    });
    getReservedUsage.mockResolvedValue(undefined);
  });

  it('rejects a request whose owner does not match the authenticated composition', async () => {
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    await expect(
      orchestrator.run({
        input: { prompt: '桂林旅游文案' },
        owner: { groupId: 'group-1', userId: 'user-2', workspaceId: 'workspace-1' },
        type: 'copy',
      }),
    ).rejects.toThrow(/owner/i);

    expect(create).not.toHaveBeenCalled();
  });

  it('reconciles an owner-scoped async task without a custom service order', async () => {
    findTravelTask.mockResolvedValue({
      artifacts: [
        {
          asyncTaskId: 'async-image-1',
          generationId: 'generation-1',
          type: 'task',
        },
      ],
      code: null,
      groupId: 'group-1',
      id: 'travel-task-1',
      input: { prompt: '桂林旅游封面' },
      message: null,
      provider: 'volcengine',
      status: 'pending',
      type: 'image',
      usage: { totalTokens: 20 },
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
    findAsyncTask.mockResolvedValue({ status: 'success' });

    const settlement = createTravelGenerationSettlementService({
      db: {} as any,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
    await expect(settlement.reconcile('travel-task-1')).resolves.toMatchObject({
      artifacts: [
        expect.objectContaining({
          type: 'image',
          url: '/f/travel-cover.png',
        }),
      ],
      status: 'succeeded',
    });

    expect(checkTimeoutTasks).toHaveBeenCalledWith(['async-image-1']);
    expect(update).toHaveBeenCalledWith(
      'travel-task-1',
      expect.objectContaining({ status: 'succeeded' }),
    );
  });

  it('replays a persisted provider completion through the owner-scoped reservation service', async () => {
    findTravelTask.mockResolvedValue({
      artifacts: [
        {
          asyncTaskId: 'async-image-1',
          generationId: 'generation-1',
          type: 'task',
        },
      ],
      code: null,
      groupId: 'group-1',
      id: 'travel-task-1',
      input: { prompt: '桂林旅游封面' },
      message: null,
      provider: 'priced-provider',
      status: 'pending',
      type: 'image',
      usage: null,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
    findAsyncTask.mockResolvedValue({
      metadata: {
        platformAiRuntime: true,
        platformUsageReservation: {
          budgetId: 'credit-budget-1',
          leaseVersion: 7,
          reservationId: 'credit-reservation-1',
        },
      },
      status: 'processing',
    });
    getReservedUsage.mockResolvedValue({
      actualUsage: { cost: 0.00125, outputImageTokens: 920, totalTokens: 1000 },
      budgetId: 'credit-budget-1',
      callKind: 'image',
      generationId: 'generation-1',
      generationType: 'platform-image-generation',
      id: 'credit-reservation-1',
      leaseVersion: 7,
      model: 'priced-image-model',
      provider: 'priced-provider',
      providerRequestId: 'provider-request-1',
      status: 'provider_completed',
      workspaceId: 'workspace-1',
    });
    completeReservedUsage.mockResolvedValue({
      reservation: {
        budgetId: 'credit-budget-1',
        callKind: 'image',
        generationId: 'generation-1',
        generationType: 'platform-image-generation',
        id: 'credit-reservation-1',
        leaseVersion: 7,
        model: 'priced-image-model',
        provider: 'priced-provider',
        status: 'settled',
        workspaceId: 'workspace-1',
      },
    });

    const settlement = createTravelGenerationSettlementService({
      db: {} as any,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    await expect(settlement.reconcile('travel-task-1')).resolves.toMatchObject({
      artifacts: [expect.objectContaining({ url: '/f/travel-cover.png' })],
      status: 'succeeded',
    });
    expect(completeReservedUsage).toHaveBeenCalledWith({
      completeRequest: true,
      leaseVersion: 7,
      providerRequestId: 'provider-request-1',
      reservationId: 'credit-reservation-1',
      usage: { cost: 0.00125, outputImageTokens: 920, totalTokens: 1000 },
    });
    expect(generateImage).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps direct platform image generation unavailable before runtime discovery', async () => {
    const orchestrator = createProductionTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    await expect(
      orchestrator.run({
        input: { imageNum: 1, prompt: '桂林旅游封面' },
        maxCredits: 20_000,
        owner: { groupId: 'group-1', userId: 'user-1', workspaceId: 'workspace-1' },
        type: 'image',
      }),
    ).resolves.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 'unavailable' });
    expect(imageRuntimeFactory).not.toHaveBeenCalled();
    expect(listImageModels).not.toHaveBeenCalled();
    expect(generateImage).not.toHaveBeenCalled();
  });

  it.each([
    ['copy', { prompt: '桂林旅游文案' }],
    ['document', { prompt: '桂林旅游行程', title: '桂林行程单' }],
  ] as const)(
    'keeps direct %s generation unavailable before reservation, claim, or provider execution',
    async (type, input) => {
      const orchestrator = createProductionTravelGenerationOrchestrator({
        db: {} as any,
        groupId: 'group-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      });

      const result = await orchestrator.run({
        input,
        maxCredits: 20_000,
        owner: { groupId: 'group-1', userId: 'user-1', workspaceId: 'workspace-1' },
        type,
      });

      expect(result).toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 'unavailable' });
      expect(reserveUsageRequest).not.toHaveBeenCalled();
      expect(reserveUsageCall).not.toHaveBeenCalled();
      expect(claimReservedUsage).not.toHaveBeenCalled();
      expect(generateObject).not.toHaveBeenCalled();
      expect(createDocument).not.toHaveBeenCalled();
    },
  );

  it('does not call the image runtime while the public image entry point is unavailable', async () => {
    generateImage.mockResolvedValue({
      state: {
        generations: [{ asset: { url: '/f/image.png' }, generationId: 'generation-1' }],
        provider: 'seedream',
      },
      success: true,
    });
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
    expect(TravelGenerationTaskModel).toHaveBeenCalledWith({}, 'user-1', 'workspace-1');

    const result = await orchestrator.run({
      input: { model: 'attacker-model', prompt: '桂林旅游封面', provider: 'attacker-provider' },
      maxCredits: 20_000,
      owner: { groupId: 'group-1', userId: 'user-1', workspaceId: 'workspace-1' },
      type: 'image',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 'group-1', status: 'queued', type: 'image' }),
    );
    expect(generateImage).not.toHaveBeenCalled();
    expect(listImageModels).not.toHaveBeenCalled();
    expect(imageRuntimeFactory).not.toHaveBeenCalled();
    expect(result).toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 'unavailable' });
  });

  it('uses the durable create-or-find path and skips the provider for an existing task', async () => {
    createOrFindByIdempotency.mockResolvedValueOnce({
      created: false,
      record: {
        artifacts: [{ generationId: 'existing-image', type: 'image', url: '/f/existing-image' }],
        groupId: 'group-1',
        id: 'travel-task-existing',
        input: { prompt: '同一张旅游封面' },
        status: 'succeeded',
        type: 'image',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
    });
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      idempotency: { key: 'server-derived-key', requestHash: 'server-derived-request-hash' },
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    await expect(
      orchestrator.run({
        input: { prompt: '同一张旅游封面' },
        owner: { groupId: 'group-1', userId: 'user-1', workspaceId: 'workspace-1' },
        type: 'image',
      }),
    ).resolves.toMatchObject({ id: 'travel-task-existing', status: 'succeeded' });

    expect(createOrFindByIdempotency).toHaveBeenCalledWith({
      groupId: 'group-1',
      idempotencyKey: 'server-derived-key',
      input: { prompt: '同一张旅游封面' },
      requestHash: 'server-derived-request-hash',
      status: 'queued',
      type: 'image',
    });
    expect(generateImage).not.toHaveBeenCalled();
  });

  it('lets only one production composition call and charge the provider when two processes race', async () => {
    let claimed = false;
    createOrFindByIdempotency.mockImplementation(async (value) => {
      const created = !claimed;
      claimed = true;
      return {
        created,
        record: {
          groupId: value.groupId,
          id: 'travel-task-concurrent',
          input: value.input,
          status: 'queued',
          type: value.type,
          userId: 'user-1',
          workspaceId: 'workspace-1',
        },
      };
    });
    const params = {
      db: {} as any,
      groupId: 'group-1',
      idempotency: { key: 'same-server-derived-key', requestHash: 'same-request-hash' },
      userId: 'user-1',
      workspaceId: 'workspace-1',
    };
    const request = {
      input: { prompt: '并发行程文档', title: '桂林行程' },
      maxCredits: 20_000,
      owner: { groupId: 'group-1', userId: 'user-1', workspaceId: 'workspace-1' },
      type: 'document' as const,
    };

    const [first, second] = await Promise.all([
      createTravelGenerationOrchestrator(params).run(request),
      createTravelGenerationOrchestrator(params).run(request),
    ]);

    expect(first.id).toBe('travel-task-concurrent');
    expect(second.id).toBe('travel-task-concurrent');
    expect(createOrFindByIdempotency).toHaveBeenCalledTimes(2);
    expect(generateObject).toHaveBeenCalledOnce();
    expect(completeReservedUsage).toHaveBeenCalledOnce();
    expect(settleTextCredits).not.toHaveBeenCalled();
    expect(createDocument).toHaveBeenCalledOnce();
    expect(generateImage).not.toHaveBeenCalled();
  });

  it.each<TravelGenerationStatus>([
    'queued',
    'running',
    'pending',
    'succeeded',
    'failed',
    'unavailable',
  ])(
    'returns an existing %s task without provider, charge, or artifact side effects',
    async (status) => {
      createOrFindByIdempotency.mockResolvedValueOnce({
        created: false,
        record: {
          artifacts:
            status === 'succeeded' ? [{ documentId: 'existing-document', type: 'document' }] : null,
          groupId: 'group-1',
          id: `travel-task-${status}`,
          input: { prompt: '同一行程文档', title: '桂林行程' },
          status,
          type: 'document',
          userId: 'user-1',
          workspaceId: 'workspace-1',
        },
      });
      const orchestrator = createTravelGenerationOrchestrator({
        db: {} as any,
        groupId: 'group-1',
        idempotency: { key: 'same-key', requestHash: 'same-hash' },
        userId: 'user-1',
        workspaceId: 'workspace-1',
      });

      await expect(
        orchestrator.run({
          input: { prompt: '同一行程文档', title: '桂林行程' },
          owner: { groupId: 'group-1', userId: 'user-1', workspaceId: 'workspace-1' },
          type: 'document',
        }),
      ).resolves.toMatchObject({ id: `travel-task-${status}`, status });
      expect(generateObject).not.toHaveBeenCalled();
      expect(settleTextCredits).not.toHaveBeenCalled();
      expect(createDocument).not.toHaveBeenCalled();
    },
  );

  it('does not replay provider, charge, or artifact creation after terminal persistence is interrupted', async () => {
    let attempt = 0;
    createOrFindByIdempotency.mockImplementation(async (value) => {
      attempt += 1;
      return {
        created: attempt === 1,
        record: {
          groupId: value.groupId,
          id: 'travel-task-interrupted',
          input: value.input,
          status: attempt === 1 ? 'queued' : 'running',
          type: value.type,
          userId: 'user-1',
          workspaceId: 'workspace-1',
        },
      };
    });
    update
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('terminal write failed'));
    const params = {
      db: {} as any,
      groupId: 'group-1',
      idempotency: { key: 'interrupted-key', requestHash: 'interrupted-hash' },
      userId: 'user-1',
      workspaceId: 'workspace-1',
    };
    const request = {
      input: { prompt: '生成中断测试文档', title: '中断测试' },
      maxCredits: 20_000,
      owner: { groupId: 'group-1', userId: 'user-1', workspaceId: 'workspace-1' },
      type: 'document' as const,
    };

    await expect(createTravelGenerationOrchestrator(params).run(request)).rejects.toBeInstanceOf(
      TravelGenerationNonReplayableError,
    );
    await expect(createTravelGenerationOrchestrator(params).run(request)).resolves.toMatchObject({
      id: 'travel-task-interrupted',
      status: 'running',
    });

    expect(generateObject).toHaveBeenCalledOnce();
    expect(completeReservedUsage).toHaveBeenCalledOnce();
    expect(settleTextCredits).not.toHaveBeenCalled();
    expect(createDocument).toHaveBeenCalledOnce();
  });

  it.each([
    [{ prompt: '' }, 'empty prompt'],
    [{ prompt: 'x'.repeat(4001) }, 'overlong prompt'],
    [{ imageNum: 0, prompt: '西藏封面' }, 'zero images'],
    [{ imageNum: 2, prompt: '西藏封面' }, 'multiple settlements'],
    [{ imageNum: 5, prompt: '西藏封面' }, 'too many images'],
    [{ imageNum: 1.5, prompt: '西藏封面' }, 'fractional images'],
  ])('rejects %s before calling the image provider (%s)', async (input) => {
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    await expect(
      orchestrator.run({
        input,
        owner: { groupId: 'group-1', userId: 'user-1' },
        type: 'image',
      }),
    ).resolves.toMatchObject({ status: 'unavailable' });
    expect(generateImage).not.toHaveBeenCalled();
  });

  it('does not use an enabled image catalog as proof of a provider-enforced cost cap', async () => {
    listImageModels.mockResolvedValue({
      content: 'Available image generation models (1)',
      state: {
        providers: [{ id: 'volcengine', models: [{ id: 'doubao-seedream-5-0-260128' }] }],
        totalModels: 1,
      },
      success: true,
    });
    generateImage.mockResolvedValue({
      state: {
        generations: [{ asset: { url: '/f/image.png' }, generationId: 'generation-1' }],
        provider: 'volcengine',
      },
      success: true,
    });
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '西藏日照金山封面' },
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'image',
    });

    expect(listImageModels).not.toHaveBeenCalled();
    expect(generateImage).not.toHaveBeenCalled();
    expect(result).toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 'unavailable' });
  });

  it.each([
    ['data URL', 'generation-data', 'data:image/png;base64,secret'],
    ['javascript URL', 'generation-js', 'javascript:alert(1)'],
    ['file URL', 'generation-file', 'file:///private/image.png'],
    [
      'cross-origin temporary URL',
      'generation-external',
      'https://temporary.provider.test/image?signature=secret',
    ],
    ['protocol-relative URL', 'generation-relative', '//temporary.provider.test/image'],
    ['encoded control URL', 'generation-control', '/f/image%0Asecret'],
    ['malformed generation id', '../generation?id', '/f/image-safe'],
  ])('fails closed for an unsafe image artifact with %s', async (_case, generationId, url) => {
    generateImage.mockResolvedValue({
      state: { generations: [{ asset: { url }, generationId }], provider: 'volcengine' },
      success: true,
    });
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '旅游封面' },
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'image',
    });

    expect(result).toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 'unavailable' });
    expect(result.artifacts).toBeUndefined();
  });

  it('normalizes and deduplicates controlled image artifacts before persistence', async () => {
    generateImage.mockResolvedValue({
      state: {
        generations: [
          {
            asset: { url: '/f/image-safe?token=secret#preview' },
            generationId: 'generation-safe',
          },
          {
            asset: { url: '/f/image-safe?other=secret' },
            generationId: 'generation-duplicate-url',
          },
          {
            asset: { url: '/f/image-other' },
            generationId: 'generation-safe',
          },
          {
            asset: { url: '/lobehub/resources/image-platform#secret' },
            generationId: 'generation-platform',
          },
        ],
        provider: 'volcengine',
      },
      success: true,
    });
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '旅游封面' },
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'image',
    });

    expect(result).toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 'unavailable' });
    expect(result.artifacts).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('keeps platform-managed video unavailable until authoritative usage cost can be settled', async () => {
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    const result = await orchestrator.run({
      input: { model: 'attacker-model', prompt: '桂林云海航拍', provider: 'attacker-provider' },
      owner: { groupId: 'group-1', userId: 'user-1', workspaceId: 'workspace-1' },
      type: 'video',
    });

    expect(createGenerationTopic).not.toHaveBeenCalled();
    expect(createVideo).not.toHaveBeenCalled();
    expect(markPlatformAiRuntime).not.toHaveBeenCalled();
    expect(assertTextCredits).not.toHaveBeenCalled();
    expect(settleTextCredits).not.toHaveBeenCalled();
    expect(result).toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 'unavailable' });
    expect(result.usage).toBeUndefined();
  });

  it('marks video unavailable when no video model is enabled', async () => {
    listPlatformModels.mockResolvedValue({ providers: [] });
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '旅游视频' },
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'video',
    });

    expect(createVideo).not.toHaveBeenCalled();
    expect(result).toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 'unavailable' });
  });

  it('marks video unavailable when multiple models are enabled without platform selection', async () => {
    listPlatformModels.mockResolvedValue({
      providers: [
        { id: 'video-provider', models: [{ id: 'video-provider-model' }] },
        { id: 'other-provider', models: [{ id: 'other-provider-model' }] },
      ],
    });
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '旅游视频' },
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'video',
    });

    expect(createVideo).not.toHaveBeenCalled();
    expect(result).toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 'unavailable' });
  });

  it('does not enable video through an explicit platform model selection', async () => {
    vi.stubEnv('TRAVEL_VIDEO_PROVIDER', 'other-provider');
    vi.stubEnv('TRAVEL_VIDEO_MODEL', 'other-provider-model');
    listPlatformModels.mockResolvedValue({
      providers: [
        { id: 'video-provider', models: [{ id: 'video-provider-model' }] },
        { id: 'other-provider', models: [{ id: 'other-provider-model' }] },
      ],
    });
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    const result = await orchestrator.run({
      input: { model: 'attacker-model', prompt: '旅游视频', provider: 'attacker-provider' },
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'video',
    });

    expect(createVideo).not.toHaveBeenCalled();
    expect(result).toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 'unavailable' });
  });

  it('marks video unavailable when the explicit platform selection is not enabled', async () => {
    vi.stubEnv('TRAVEL_VIDEO_PROVIDER', 'video-provider');
    vi.stubEnv('TRAVEL_VIDEO_MODEL', 'missing-model');
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '旅游视频' },
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'video',
    });

    expect(createVideo).not.toHaveBeenCalled();
    expect(result).toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 'unavailable' });
  });

  it('does not reach stale video provider errors while video usage settlement is unavailable', async () => {
    findAsyncTask.mockResolvedValue({
      error: { message: 'secret provider detail' },
      status: 'error',
    });
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '旅游视频' },
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'video',
    });

    expect(createVideo).not.toHaveBeenCalled();
    expect(result).toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 'unavailable' });
    expect(result.message).not.toContain('secret provider detail');
  });

  it('generates copy through the existing LLM service and records inline output and usage', async () => {
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    const result = await orchestrator.run({
      input: { model: 'attacker-model', prompt: '写桂林旅游文案', provider: 'attacker-provider' },
      maxCredits: 20_000,
      owner: { groupId: 'group-1', userId: 'user-1', workspaceId: 'workspace-1' },
      type: 'copy',
    });

    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'group-model' }),
      expect.objectContaining({
        metadata: expect.objectContaining({ groupId: 'group-1' }),
        onUsage: expect.any(Function),
      }),
    );
    expect(initPlatformRuntime).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      provider: 'group-provider',
      workspaceId: 'workspace-1',
    });
    expect(claimReservedUsage.mock.invocationCallOrder[0]).toBeLessThan(
      generateObject.mock.invocationCallOrder[0]!,
    );
    expect(completeReservedUsage).toHaveBeenCalledWith({
      completeRequest: true,
      leaseVersion: 1,
      reservationId: 'credit-reservation-1',
      usage: {
        cost: 0.0123,
        totalInputTokens: 12,
        totalOutputTokens: 8,
        totalTokens: 20,
      },
    });
    expect(assertTextCredits).not.toHaveBeenCalled();
    expect(settleTextCredits).not.toHaveBeenCalled();
    expect(resolveGroupMemberAgentId).toHaveBeenCalledWith('group-1', 'default-travel-copywriter');
    expect(getAgentConfigById).toHaveBeenCalledOnce();
    expect(resolvePlatformModelPricing).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      artifacts: [{ content: '桂林山水旅行文案', type: 'text' }],
      status: 'succeeded',
      usage: {
        cost: 0.0123,
        totalInputTokens: 12,
        totalOutputTokens: 8,
        totalTokens: 20,
      },
    });
  });

  it('bills the invited actor while persisting hosted copy for the resource owner', async () => {
    const sharedBudget = {} as any;
    const orchestrator = createHostedTravelCopyGenerationOrchestrator({
      actorUserId: 'invited-member',
      db: {} as any,
      groupId: 'group-1',
      operationId: 'copywriter-operation',
      sharedBudget,
      userId: 'group-owner',
      workspaceId: 'workspace-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '写桂林旅游文案' },
      maxCredits: 500,
      owner: { groupId: 'group-1', userId: 'group-owner', workspaceId: 'workspace-1' },
      type: 'copy',
    });

    expect(runSharedBudgetStep).toHaveBeenCalledWith(
      sharedBudget,
      expect.objectContaining({
        actorUserId: 'invited-member',
        kind: 'call_llm',
        model: 'group-model',
        operationId: 'copywriter-operation',
        provider: 'group-provider',
        workspaceId: 'workspace-1',
      }),
    );
    expect(runSharedBudgetStep).toHaveBeenCalledOnce();
    expect(initPlatformRuntime).not.toHaveBeenCalled();
    expect(TravelGenerationTaskModel).toHaveBeenCalledWith(
      expect.anything(),
      'group-owner',
      'workspace-1',
    );
    expect(prepareBoundedPlatformRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'invited-member',
        payload: expect.objectContaining({
          messages: [
            expect.objectContaining({
              content: expect.stringContaining('# 旅游文案制作'),
              role: 'system',
            }),
            { content: '写桂林旅游文案', role: 'user' },
          ],
        }),
        provider: 'group-provider',
        remainingCredits: 37,
        workspaceId: 'workspace-1',
      }),
    );
    expect(generateObject).not.toHaveBeenCalled();
    expect(reserveUsageRequest).not.toHaveBeenCalled();
    expect(reserveUsageCall).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      artifacts: [{ content: '桂林山水旅行文案', type: 'text' }],
      owner: { groupId: 'group-1', userId: 'group-owner', workspaceId: 'workspace-1' },
      status: 'succeeded',
      type: 'copy',
    });
  });

  it('ignores caller-supplied remaining Credits and fails before provider execution when bounded preparation closes', async () => {
    prepareBoundedPlatformRuntime.mockRejectedValueOnce(
      new Error('Platform bounded text generation has no affordable output token'),
    );
    const orchestrator = createHostedTravelCopyGenerationOrchestrator({
      actorUserId: 'invited-member',
      db: {} as any,
      groupId: 'group-1',
      operationId: 'bounded-copy-operation',
      sharedBudget: {} as any,
      userId: 'group-owner',
    });

    const result = await orchestrator.run({
      input: {
        prompt: '不得超额生成',
        remainingCredits: 999_999_999,
      },
      maxCredits: 999_999_999,
      owner: { groupId: 'group-1', userId: 'group-owner' },
      type: 'copy',
    });

    expect(prepareBoundedPlatformRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ remainingCredits: 37 }),
    );
    expect(prepareBoundedPlatformRuntime).not.toHaveBeenCalledWith(
      expect.objectContaining({ remainingCredits: 999_999_999 }),
    );
    expect(generateObject).not.toHaveBeenCalled();
    expect(result).toMatchObject({ code: 'GENERATION_FAILED', status: 'failed' });
  });

  it.each([
    ['copy', { prompt: '不得免费生成旅游文案' }, false],
    ['document', { prompt: '不得免费生成旅游文稿', title: '旅游文稿' }, true],
  ] as const)(
    'fails closed before persistence or provider setup when exact %s pricing is unavailable',
    async (type, input, rejectsCatalog) => {
      if (rejectsCatalog) {
        resolvePlatformModelPricing.mockRejectedValueOnce(new Error('model catalog unavailable'));
      } else {
        resolvePlatformModelPricing.mockResolvedValueOnce(undefined);
      }
      const orchestrator = createTravelGenerationOrchestrator({
        db: {} as any,
        groupId: 'group-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      });

      await expect(
        orchestrator.run({
          input,
          maxCredits: 20_000,
          owner: { groupId: 'group-1', userId: 'user-1', workspaceId: 'workspace-1' },
          type,
        }),
      ).rejects.toMatchObject({ code: 'MODEL_PRICING_UNAVAILABLE' });

      expect(resolvePlatformModelPricing).toHaveBeenCalledWith(expect.anything(), {
        model: 'group-model',
        provider: 'group-provider',
      });
      expect(create).not.toHaveBeenCalled();
      expect(createOrFindByIdempotency).not.toHaveBeenCalled();
      expect(reserveUsageRequest).not.toHaveBeenCalled();
      expect(reserveUsageCall).not.toHaveBeenCalled();
      expect(initPlatformRuntime).not.toHaveBeenCalled();
      expect(generateObject).not.toHaveBeenCalled();
    },
  );

  it('uses one server catalog pricing snapshot for preflight and final text settlement', async () => {
    const db = {} as any;
    const canonicalUsage = {
      cost: 0.000028,
      totalInputTokens: 12,
      totalOutputTokens: 8,
      totalTokens: 20,
    };
    pricePlatformTextUsage.mockReturnValueOnce(canonicalUsage);
    const orchestrator = createTravelGenerationOrchestrator({
      db,
      groupId: 'group-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '用管理员自定义模型生成旅游文案' },
      maxCredits: 20_000,
      owner: { groupId: 'group-1', userId: 'user-1', workspaceId: 'workspace-1' },
      type: 'copy',
    });

    expect(resolvePlatformModelPricing).toHaveBeenCalledWith(db, {
      model: 'group-model',
      provider: 'group-provider',
    });
    expect(pricePlatformTextUsage).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'group-model', provider: 'group-provider' }),
      expect.objectContaining({ cost: 0.0123, totalTokens: 20 }),
    );
    expect(completeReservedUsage).toHaveBeenCalledWith(
      expect.objectContaining({ usage: canonicalUsage }),
    );
    expect(result).toMatchObject({ status: 'succeeded', usage: canonicalUsage });
  });

  it('reserves and claims immediately before the copy provider, then settles before delivery', async () => {
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      idempotency: { key: 'copy-order-key', requestHash: 'copy-order-hash' },
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '写桂林旅游文案' },
      maxCredits: 20_000,
      orderId: 'order-1',
      owner: { groupId: 'group-1', userId: 'user-1', workspaceId: 'workspace-1' },
      type: 'copy',
    });

    expect(reserveUsageRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'travel-generation:travel-task-1:request',
        limit: { maxCredits: 20_000, source: 'user-explicit' },
        sourceId: 'order-1',
        sourceType: 'travel-generation-copy',
        workspaceId: 'workspace-1',
      }),
    );
    expect(reserveUsageCall).toHaveBeenCalledWith(
      expect.objectContaining({
        budgetId: 'credit-budget-1',
        callKind: 'call_llm',
        generationId: 'travel-generation:travel-task-1:step:0:call_llm',
        idempotencyKey: 'travel-generation:travel-task-1:call-llm:0',
        limit: { maxCredits: 20_000, source: 'user-explicit' },
        model: 'group-model',
        provider: 'group-provider',
        workspaceId: 'workspace-1',
      }),
    );
    expect(reserveUsageRequest.mock.invocationCallOrder[0]).toBeLessThan(
      reserveUsageCall.mock.invocationCallOrder[0]!,
    );
    expect(reserveUsageCall.mock.invocationCallOrder[0]).toBeLessThan(
      claimReservedUsage.mock.invocationCallOrder[0]!,
    );
    expect(claimReservedUsage.mock.invocationCallOrder[0]).toBeLessThan(
      generateObject.mock.invocationCallOrder[0]!,
    );
    expect(generateObject.mock.invocationCallOrder[0]).toBeLessThan(
      completeReservedUsage.mock.invocationCallOrder[0]!,
    );
    expect(completeReservedUsage).toHaveBeenCalledWith({
      completeRequest: true,
      leaseVersion: 1,
      reservationId: 'credit-reservation-1',
      usage: {
        cost: 0.0123,
        totalInputTokens: 12,
        totalOutputTokens: 8,
        totalTokens: 20,
      },
    });
    expect(assertTextCredits).not.toHaveBeenCalled();
    expect(settleTextCredits).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      artifacts: [{ content: '桂林山水旅行文案', type: 'text' }],
      status: 'succeeded',
    });
  });

  it('does not call the provider when the reservation claim is a replay', async () => {
    claimReservedUsage.mockResolvedValueOnce({
      reservation: { id: 'credit-reservation-1', leaseVersion: 1, status: 'provider_started' },
      shouldCallProvider: false,
    });
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    await expect(
      orchestrator.run({
        input: { prompt: '不得重放的旅游文案' },
        maxCredits: 20_000,
        owner: { groupId: 'group-1', userId: 'user-1' },
        type: 'copy',
      }),
    ).rejects.toBeInstanceOf(TravelGenerationNonReplayableError);

    expect(generateObject).not.toHaveBeenCalled();
    expect(completeReservedUsage).not.toHaveBeenCalled();
    expect(releaseUnclaimedUsage).not.toHaveBeenCalled();
  });

  it('releases the call and request budget when runtime initialization fails before claim', async () => {
    initPlatformRuntime.mockRejectedValueOnce(new Error('runtime init failed'));
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '初始化失败文案' },
      maxCredits: 20_000,
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'copy',
    });

    expect(result).toMatchObject({ code: 'GENERATION_FAILED', status: 'failed' });
    expect(claimReservedUsage).not.toHaveBeenCalled();
    expect(generateObject).not.toHaveBeenCalled();
    expect(releaseUnclaimedUsage).toHaveBeenCalledWith({
      completeRequest: true,
      leaseVersion: 1,
      reservationId: 'credit-reservation-1',
    });
  });

  it('retries settlement only and never replays the provider', async () => {
    completeReservedUsage
      .mockRejectedValueOnce(new Error('transient settlement failure'))
      .mockResolvedValueOnce({
        entry: { id: 'credit-entry-1' },
        request: { id: 'credit-budget-1', status: 'settled' },
        reservation: { id: 'credit-reservation-1', status: 'settled' },
      });
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '结算重试文案' },
      maxCredits: 20_000,
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'copy',
    });

    expect(result.status).toBe('succeeded');
    expect(generateObject).toHaveBeenCalledOnce();
    expect(completeReservedUsage).toHaveBeenCalledTimes(2);
    expect(completeReservedUsage.mock.calls[1]).toEqual(completeReservedUsage.mock.calls[0]);
    expect(releaseUnclaimedUsage).not.toHaveBeenCalled();
  });

  it.each(['copy', 'document'] as const)(
    'passes the original runtime ModelUsage to unified settlement without %s markup',
    async (type) => {
      const runtimeUsage = {
        cost: 0.004321,
        inputCachedTextTokens: 7,
        totalInputTokens: 12,
        totalOutputTokens: 8,
        totalTokens: 20,
      };
      generateObject.mockImplementationOnce(async (_payload, options) => {
        await options?.onUsage?.(runtimeUsage);
        return { content: '平台模型原始用量文案' };
      });
      const orchestrator = createTravelGenerationOrchestrator({
        db: {} as any,
        groupId: 'group-1',
        userId: 'user-1',
      });

      const result = await orchestrator.run({
        input: {
          prompt: '生成旅游内容',
          ...(type === 'document' ? { title: '旅游文档' } : {}),
        },
        maxCredits: 20_000,
        owner: { groupId: 'group-1', userId: 'user-1' },
        type,
      });

      expect(completeReservedUsage.mock.calls[0]?.[0].usage).toBe(runtimeUsage);
      expect(result.usage).toBe(runtimeUsage);
      expect(result).toMatchObject({ status: 'succeeded', usage: { cost: 0.004321 } });
    },
  );

  it.each([
    ['missing usage', undefined],
    ['missing cost', { totalTokens: 1 }],
    ['NaN cost', { cost: Number.NaN, totalTokens: 1 }],
    ['negative cost', { cost: -0.1, totalTokens: 1 }],
    ['unsafe cost', { cost: Number.MAX_VALUE, totalTokens: 1 }],
  ])('does not deliver copy when unified settlement rejects %s', async (_label, runtimeUsage) => {
    generateObject.mockImplementationOnce(async (_payload, options) => {
      if (runtimeUsage) await options?.onUsage?.(runtimeUsage);
      return { content: '不得交付的文案' };
    });
    completeReservedUsage.mockImplementation(async ({ usage }) => {
      preparePlatformUsageCharge({
        actorUserId: 'user-1',
        generationId: 'travel-generation:travel-task-1:step:0:call_llm',
        generationType: 'agent-runtime-text-step',
        model: 'group-model',
        provider: 'group-provider',
        usage,
      });
    });
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '生成旅游文案' },
      maxCredits: 20_000,
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'copy',
    });

    expect(result).toMatchObject({ code: 'GENERATION_FAILED', status: 'failed' });
    expect(result.artifacts).toBeUndefined();
  });

  it('fails a copy before the provider when reservation admission rejects the maximum', async () => {
    reserveUsageRequest.mockRejectedValueOnce(new Error('reservation admission failed'));
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '写旅游文案' },
      maxCredits: 20_000,
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'copy',
    });

    expect(result).toMatchObject({ code: 'GENERATION_FAILED', status: 'failed' });
    expect(generateObject).not.toHaveBeenCalled();
    expect(completeReservedUsage).not.toHaveBeenCalled();
    expect(assertTextCredits).not.toHaveBeenCalled();
    expect(settleTextCredits).not.toHaveBeenCalled();
  });

  it('fails a completed copy closed when authoritative usage cost is missing', async () => {
    generateObject.mockResolvedValueOnce({ content: '未结算文案' });
    completeReservedUsage.mockRejectedValue(new Error('authoritative usage is missing'));
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '写旅游文案' },
      maxCredits: 20_000,
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'copy',
    });

    expect(result).toMatchObject({ code: 'GENERATION_FAILED', status: 'failed' });
    expect(result.artifacts).toBeUndefined();
  });

  it('generates and settles a private user-owned document exactly once', async () => {
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    const result = await orchestrator.run({
      input: {
        content: '不得绕过模型和计费的调用方内容',
        prompt: '生成桂林三日游行程',
        title: '桂林行程',
      },
      maxCredits: 20_000,
      owner: { groupId: 'group-1', userId: 'user-1', workspaceId: 'workspace-1' },
      type: 'document',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 'group-1', status: 'queued', type: 'document' }),
    );
    expect(generateObject).toHaveBeenCalledOnce();
    expect(completeReservedUsage).toHaveBeenCalledOnce();
    expect(completeReservedUsage).toHaveBeenCalledWith({
      completeRequest: true,
      leaseVersion: 1,
      reservationId: 'credit-reservation-1',
      usage: {
        cost: 0.0123,
        totalInputTokens: 12,
        totalOutputTokens: 8,
        totalTokens: 20,
      },
    });
    expect(settleTextCredits).not.toHaveBeenCalled();
    expect(DocumentModel).toHaveBeenCalledWith({}, 'user-1', 'workspace-1');
    expect(createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '桂林山水旅行文案',
        editorData: { root: { children: [{ type: 'paragraph' }], type: 'root' } },
        fileType: 'custom/document',
        filename: '桂林行程',
        source: 'travel-generation',
        sourceType: 'api',
        title: '桂林行程',
        visibility: 'private',
      }),
    );
    expect(createDocument).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      artifacts: [{ documentId: 'document-1', name: '桂林行程', type: 'document' }],
      status: 'succeeded',
    });
  });

  it.each([
    ['an empty prompt', { prompt: '', title: '桂林行程' }],
    ['an empty title', { prompt: '生成桂林行程', title: '   ' }],
    [
      'a prompt beyond the 4000-character tool contract',
      { prompt: '桂'.repeat(4001), title: '桂林行程' },
    ],
  ])('fails closed for %s before calling the document model', async (_case, input) => {
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    const result = await orchestrator.run({
      input,
      maxCredits: 20_000,
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'document',
    });

    expect(result.status).not.toBe('succeeded');
    expect(result.artifacts).toBeUndefined();
    expect(generateObject).not.toHaveBeenCalled();
    expect(settleTextCredits).not.toHaveBeenCalled();
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('fails closed when the document model returns empty content', async () => {
    generateObject.mockImplementationOnce(async (_payload, options) => {
      await options?.onUsage?.({ cost: 0.01, totalTokens: 1 });
      return { content: '   ' };
    });
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '生成桂林行程', title: '桂林行程' },
      maxCredits: 20_000,
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'document',
    });

    expect(result).toMatchObject({ code: 'GENERATION_FAILED', status: 'failed' });
    expect(result.artifacts).toBeUndefined();
    expect(settleTextCredits).not.toHaveBeenCalled();
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('fails closed when document usage has no authoritative cost', async () => {
    generateObject.mockImplementationOnce(async (_payload, options) => {
      await options?.onUsage?.({ totalTokens: 1 });
      return { content: '桂林行程' };
    });
    completeReservedUsage.mockImplementation(async ({ usage }) => {
      if (usage?.cost === undefined) throw new Error('authoritative usage cost is missing');
    });
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '生成桂林行程', title: '桂林行程' },
      maxCredits: 20_000,
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'document',
    });

    expect(result).toMatchObject({ code: 'GENERATION_FAILED', status: 'failed' });
    expect(result.artifacts).toBeUndefined();
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('persists a safe paid-but-unsaved terminal state without replaying provider or charge', async () => {
    createDocument.mockRejectedValueOnce(
      new Error('private document write failed at /secret/path document-id=123'),
    );
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '生成桂林行程', title: '桂林行程' },
      maxCredits: 20_000,
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'document',
    });

    expect(result).toMatchObject({
      code: 'ARTIFACT_PERSISTENCE_FAILED',
      message: '内容已生成并计费，但作品保存失败。请稍后重试查询或联系人工处理。',
      status: 'failed',
    });
    expect(JSON.stringify(result)).not.toMatch(/private|secret|document-id|123/);
    expect(generateObject).toHaveBeenCalledOnce();
    expect(completeReservedUsage).toHaveBeenCalledOnce();
    expect(settleTextCredits).not.toHaveBeenCalled();
    expect(createDocument).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith('travel-task-1', {
      code: 'ARTIFACT_PERSISTENCE_FAILED',
      message: '内容已生成并计费，但作品保存失败。请稍后重试查询或联系人工处理。',
      status: 'failed',
    });
  });

  it.each(['copy', 'document'] as const)(
    'maps a %s provider timeout to a bounded uncharged failure',
    async (type) => {
      generateObject.mockRejectedValueOnce(
        new Error('secret provider timeout; key=private; raw-response=private'),
      );
      const orchestrator = createTravelGenerationOrchestrator({
        db: {} as any,
        groupId: 'group-1',
        userId: 'user-1',
      });

      const result = await orchestrator.run({
        input: {
          prompt: '生成超时测试内容',
          ...(type === 'document' ? { title: '超时测试' } : {}),
        },
        maxCredits: 20_000,
        owner: { groupId: 'group-1', userId: 'user-1' },
        type,
      });

      expect(result).toMatchObject({ code: 'GENERATION_FAILED', status: 'failed' });
      expect(result.artifacts).toBeUndefined();
      expect(completeReservedUsage).not.toHaveBeenCalled();
      expect(settleTextCredits).not.toHaveBeenCalled();
      expect(createDocument).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toMatch(/secret|private|raw-response/);
    },
  );

  it('persists model-returned HTML as text in a server-owned private document', async () => {
    generateObject.mockImplementationOnce(async (_payload, options) => {
      await options?.onUsage?.({ cost: 0.01, totalTokens: 5 });
      return {
        content:
          '# 安全行程\n\n<script>globalThis.travelOwned=true</script>\n<img src=x onerror="alert(1)">',
      };
    });
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '生成安全行程', title: '安全行程' },
      maxCredits: 20_000,
      owner: { groupId: 'group-1', userId: 'user-1', workspaceId: 'workspace-1' },
      type: 'document',
    });

    expect(createMarkdownEditorSnapshot).toHaveBeenCalledWith(
      '# 安全行程\n\n&lt;script&gt;globalThis.travelOwned=true&lt;/script&gt;\n&lt;img src=x onerror="alert(1)"&gt;',
    );
    expect(createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'travel-generation',
        sourceType: 'api',
        visibility: 'private',
      }),
    );
    expect(DocumentModel).toHaveBeenCalledWith({}, 'user-1', 'workspace-1');
    expect(result).toMatchObject({ status: 'succeeded' });
  });

  it('keeps the same settlement identity when a task step is replayed', async () => {
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
    const request = {
      input: { prompt: '写桂林旅游文案' },
      maxCredits: 20_000,
      owner: { groupId: 'group-1', userId: 'user-1', workspaceId: 'workspace-1' },
      type: 'copy' as const,
    };

    await orchestrator.run(request);
    await orchestrator.run(request);

    const identities = completeReservedUsage.mock.calls.map(([input]) => ({
      leaseVersion: input.leaseVersion,
      reservationId: input.reservationId,
    }));
    expect(identities).toEqual([
      { leaseVersion: 1, reservationId: 'credit-reservation-1' },
      { leaseVersion: 1, reservationId: 'credit-reservation-1' },
    ]);
  });

  it('uses the document-assistant member when generating document content', async () => {
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '生成行程', title: '桂林行程' },
      maxCredits: 20_000,
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'document',
    });

    expect(resolveGroupMemberAgentId).toHaveBeenCalledWith(
      'group-1',
      'default-travel-document-assistant',
    );
    expect(result.usage).toEqual({
      cost: 0.0123,
      totalInputTokens: 12,
      totalOutputTokens: 8,
      totalTokens: 20,
    });
  });

  it('marks copy unavailable when no provider model is selected', async () => {
    getAgentConfigById.mockResolvedValue({ model: undefined, provider: undefined });
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '旅游文案' },
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'copy',
    });

    expect(generateObject).not.toHaveBeenCalled();
    expect(result).toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 'unavailable' });
  });

  it('uses AgentService merged platform defaults when the member row has no explicit model', async () => {
    getAgentConfigById.mockResolvedValue({
      model: 'platform-default-model',
      provider: 'platform-default-provider',
    });
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    await orchestrator.run({
      input: { prompt: '默认模型文案' },
      maxCredits: 20_000,
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'copy',
    });

    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'platform-default-model',
      }),
      expect.anything(),
    );
    expect(initPlatformRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'platform-default-provider' }),
    );
  });

  it('does not send the designer text default to image generation', async () => {
    getAgentConfigById.mockResolvedValue({
      model: 'text-only-model',
      provider: 'text-provider',
    });
    listImageModels.mockResolvedValue({
      content: 'No available image generation models were found.',
      state: { providers: [], totalModels: 0 },
      success: true,
    });
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '封面' },
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'image',
    });

    expect(generateImage).not.toHaveBeenCalled();
    expect(result).toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 'unavailable' });
  });

  it('returns unavailable when multiple image models are enabled without platform selection', async () => {
    listImageModels.mockResolvedValue({
      content: 'Available image generation models (2)',
      state: {
        providers: [
          { id: 'volcengine', models: [{ id: 'seedream-a' }] },
          { id: 'openai', models: [{ id: 'image-b' }] },
        ],
        totalModels: 2,
      },
      success: true,
    });
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '封面' },
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'image',
    });

    expect(generateImage).not.toHaveBeenCalled();
    expect(result).toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 'unavailable' });
  });

  it('does not let configured image models bypass the hard-cap requirement', async () => {
    vi.stubEnv('TRAVEL_IMAGE_PROVIDER', 'volcengine');
    vi.stubEnv('TRAVEL_IMAGE_MODEL', 'seedream-a');
    listImageModels.mockResolvedValue({
      content: 'Available image generation models (2)',
      state: {
        providers: [
          { id: 'volcengine', models: [{ id: 'seedream-a' }] },
          { id: 'openai', models: [{ id: 'image-b' }] },
        ],
        totalModels: 2,
      },
      success: true,
    });
    generateImage.mockResolvedValue({
      state: {
        generations: [{ asset: { url: '/f/image.png' }, generationId: 'generation-1' }],
        provider: 'volcengine',
      },
      success: true,
    });
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    await orchestrator.run({
      input: { model: 'attacker-model', prompt: '封面', provider: 'attacker-provider' },
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'image',
    });

    expect(listImageModels).not.toHaveBeenCalled();
    expect(generateImage).not.toHaveBeenCalled();
  });

  it('returns unavailable when the configured platform image model is not enabled', async () => {
    vi.stubEnv('TRAVEL_IMAGE_PROVIDER', 'volcengine');
    vi.stubEnv('TRAVEL_IMAGE_MODEL', 'missing-model');
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '封面' },
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'image',
    });

    expect(generateImage).not.toHaveBeenCalled();
    expect(result).toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 'unavailable' });
  });

  it('normalizes unsafe document titles before creating a filename', async () => {
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    await orchestrator.run({
      input: { prompt: '生成安全文档', title: '../unsafe\\name...  ' },
      maxCredits: 20_000,
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'document',
    });

    const document = createDocument.mock.calls[0][0];
    const filename = document.filename as string;
    expect(filename).not.toMatch(/[\\/]/);
    expect(filename.length).toBeLessThanOrEqual(120);
    expect(document.title).toBe(filename);
    expect(document.title).not.toMatch(/^[_.]/);
  });

  it.each([{ waitTimedOut: true }, { waitError: 'provider status temporarily unavailable' }])(
    'keeps accepted async image tasks pending for $waitTimedOut$waitError',
    async (waitState) => {
      generateImage.mockResolvedValue({
        state: {
          generations: [{ asyncTaskId: 'async-1', generationId: 'generation-1' }],
          provider: 'seedream',
          ...waitState,
        },
        success: true,
      });
      const orchestrator = createTravelGenerationOrchestrator({
        db: {} as any,
        groupId: 'group-1',
        userId: 'user-1',
      });

      const result = await orchestrator.run({
        input: { prompt: '异步封面' },
        owner: { groupId: 'group-1', userId: 'user-1' },
        type: 'image',
      });

      expect(result).toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 'unavailable' });
      expect(generateImage).not.toHaveBeenCalled();
    },
  );

  it('maps a missing enabled image model to unavailable', async () => {
    const type = 'ImageModelNotFound';
    generateImage.mockResolvedValue({
      error: { message: 'internal provider detail', type },
      success: false,
    });
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '封面' },
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'image',
    });

    expect(result).toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 'unavailable' });
  });

  it('maps a failed image generation to a safe failed task', async () => {
    generateImage.mockResolvedValue({
      error: { message: 'internal provider detail', type: 'ImageGenerationFailed' },
      success: false,
    });
    const orchestrator = createTravelGenerationOrchestrator({
      db: {} as any,
      groupId: 'group-1',
      userId: 'user-1',
    });

    const result = await orchestrator.run({
      input: { prompt: '封面' },
      owner: { groupId: 'group-1', userId: 'user-1' },
      type: 'image',
    });

    expect(result).toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 'unavailable' });
    expect(result.artifacts).toBeUndefined();
    expect(result.message).not.toContain('internal provider detail');
  });
});
