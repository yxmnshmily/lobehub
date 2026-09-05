// @vitest-environment node
import { resolveBusinessModelMapping } from '@lobechat/business-model-runtime';
import { AsyncTaskError, AsyncTaskErrorType, AsyncTaskStatus } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chargeAfterGenerate } from '@/business/server/image-generation/chargeAfterGenerate';
import { notifyImageCompleted } from '@/business/server/image-generation/notifyImageCompleted';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { FileModel } from '@/database/models/file';
import { GenerationModel } from '@/database/models/generation';
import { GenerationBatchModel } from '@/database/models/generationBatch';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { GenerationService } from '@/server/services/generation';
import { PlatformAiRuntime } from '@/server/services/platformAiRuntime';
import { PlatformUsageReservationService } from '@/server/services/platformUsageBilling/reservation';

import { imageRouter } from '../image';

// Constructor-based deps the route instantiates directly.
vi.mock('@/database/models/asyncTask', () => ({ AsyncTaskModel: vi.fn() }));
vi.mock('@/database/models/file', () => ({ FileModel: vi.fn() }));
vi.mock('@/database/models/generation', () => ({ GenerationModel: vi.fn() }));
vi.mock('@/database/models/generationBatch', () => ({ GenerationBatchModel: vi.fn() }));
vi.mock('@/server/services/generation', () => ({ GenerationService: vi.fn() }));
vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: vi.fn() }));
const {
  claimReservedUsage,
  completeReservedUsage,
  debugLog,
  getReservedUsage,
  platformRuntimeInit,
  releaseUnclaimedUsage,
} = vi.hoisted(() => ({
  claimReservedUsage: vi.fn(),
  completeReservedUsage: vi.fn(),
  debugLog: vi.fn(),
  getReservedUsage: vi.fn(),
  platformRuntimeInit: vi.fn(),
  releaseUnclaimedUsage: vi.fn(),
}));
vi.mock('debug', () => ({ default: vi.fn(() => debugLog) }));
vi.mock('@/server/services/platformAiRuntime', () => ({
  PlatformAiRuntime: vi.fn().mockImplementation(() => ({ init: platformRuntimeInit })),
}));
vi.mock('@/server/services/platformUsageBilling/reservation', () => ({
  PlatformUsageReservationService: vi.fn().mockImplementation(() => ({
    claim: claimReservedUsage,
    completeAndSettle: completeReservedUsage,
    getReservation: getReservedUsage,
    releaseUnclaimed: releaseUnclaimedUsage,
  })),
}));

// Business slots.
vi.mock('@/business/server/getProviderContentPolicyErrorMessage', () => ({
  getProviderContentPolicyErrorMessage: vi.fn(async () => undefined),
}));
vi.mock('@/business/server/image-generation/chargeAfterGenerate', () => ({
  chargeAfterGenerate: vi.fn(),
}));
vi.mock('@/business/server/image-generation/notifyImageCompleted', () => ({
  notifyImageCompleted: vi.fn(),
}));
vi.mock('@/business/server/trpc-middlewares/async', () => ({
  createImageBusinessMiddleware: async (opts: any) => opts.next({ ctx: opts.ctx }),
}));

// The failure-reconciliation path is gated on ENABLE_BUSINESS_FEATURES, which is
// false in the OSS default const package.
vi.mock('@lobechat/business-const', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  ENABLE_BUSINESS_FEATURES: true,
}));

vi.mock('@lobechat/business-model-runtime', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  buildMappedBusinessModelFields: vi.fn(() => ({})),
  resolveBusinessModelMapping: vi.fn(),
}));

vi.mock('@/libs/trpc/async', async () => {
  const init = await vi.importActual<{ asyncTrpc: any }>('@/libs/trpc/async/init');
  const { asyncTrpc } = init;
  return {
    asyncAuthedProcedure: asyncTrpc.procedure,
    asyncRouter: asyncTrpc.router,
    createAsyncCallerFactory: asyncTrpc.createCallerFactory,
    publicProcedure: asyncTrpc.procedure,
  };
});

describe('imageRouter.createImage — model mapping failure reconciles billing', () => {
  const userId = 'user_test';
  let mockCtx: any;
  let asyncTaskModelMock: any;
  let generationBatchModelMock: any;
  let generationModelMock: any;
  let generationServiceMock: any;

  const createInput = (overrides = {}) => ({
    generationBatchId: 'batch-1',
    generationId: 'gen-1',
    generationTopicId: 'topic-1',
    model: 'some-model',
    params: { prompt: 'a beautiful sunset' },
    provider: 'test-provider',
    taskId: 'task-1',
    ...overrides,
  });

  const platformReservation = (overrides = {}) => ({
    budgetId: 'budget-1',
    callKind: 'image',
    generationId: 'gen-1',
    generationType: 'platform-image-generation',
    id: 'reservation-1',
    leaseVersion: 7,
    model: 'mapped-model',
    provider: 'test-provider',
    status: 'reserved',
    workspaceId: null,
    ...overrides,
  });

  const platformTaskMetadata = (overrides = {}) => ({
    platformAiRuntime: true,
    platformUsageReservation: {
      budgetId: 'budget-1',
      leaseVersion: 7,
      reservationId: 'reservation-1',
      ...overrides,
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();

    asyncTaskModelMock = { findById: vi.fn(), transitionStatus: vi.fn(), update: vi.fn() };
    generationBatchModelMock = { findById: vi.fn() };
    generationModelMock = { createAssetAndFile: vi.fn(), findByIdAndTransform: vi.fn() };
    generationServiceMock = {
      transformImageForGeneration: vi.fn(),
      uploadImageForGeneration: vi.fn(),
    };

    vi.mocked(AsyncTaskModel).mockImplementation(() => asyncTaskModelMock);
    vi.mocked(GenerationBatchModel).mockImplementation(() => generationBatchModelMock);
    vi.mocked(GenerationModel).mockImplementation(() => generationModelMock);
    vi.mocked(GenerationService).mockImplementation(() => generationServiceMock);
    vi.mocked(FileModel).mockImplementation(() => ({}) as any);
    vi.mocked(initModelRuntimeFromDB).mockResolvedValue({} as any);
    getReservedUsage.mockResolvedValue(platformReservation());
    claimReservedUsage.mockResolvedValue({
      reservation: platformReservation({ status: 'provider_started' }),
      shouldCallProvider: true,
    });
    completeReservedUsage.mockResolvedValue({
      reservation: platformReservation({ settledCredits: 600, status: 'settled' }),
    });
    releaseUnclaimedUsage.mockResolvedValue({
      reservation: platformReservation({ status: 'released' }),
    });
    asyncTaskModelMock.transitionStatus.mockResolvedValue(true);

    // The batch must exist so the route proceeds into the guarded section.
    generationBatchModelMock.findById.mockResolvedValue({ id: 'batch-1', createdAt: new Date() });

    mockCtx = { serverDB: {}, userId };
  });

  it('acknowledges a duplicate async delivery without a second provider call', async () => {
    asyncTaskModelMock.transitionStatus.mockResolvedValue(false);
    asyncTaskModelMock.findById.mockResolvedValue({ status: AsyncTaskStatus.Processing });
    const createImage = vi.fn();
    platformRuntimeInit.mockResolvedValue({ createImage });

    const result = await imageRouter.createCaller(mockCtx).createImage(createInput());

    expect(result).toEqual({ success: true });
    expect(resolveBusinessModelMapping).not.toHaveBeenCalled();
    expect(createImage).not.toHaveBeenCalled();
    expect(completeReservedUsage).not.toHaveBeenCalled();
    expect(generationModelMock.createAssetAndFile).not.toHaveBeenCalled();
  });

  it('recovers a duplicate provider completion from persisted usage without calling the provider', async () => {
    mockCtx.modelRuntimeMode = 'platform-managed';
    asyncTaskModelMock.transitionStatus.mockResolvedValue(false);
    asyncTaskModelMock.findById.mockResolvedValue({
      metadata: platformTaskMetadata(),
      status: AsyncTaskStatus.Processing,
    });
    vi.mocked(resolveBusinessModelMapping).mockResolvedValue({
      requestedModelId: 'some-model',
      resolvedModelId: 'mapped-model',
    } as any);
    getReservedUsage.mockResolvedValue(
      platformReservation({
        actualUsage: { cost: 0.0006, totalTokens: 1 },
        providerRequestId: 'provider-request-1',
        status: 'provider_completed',
      }),
    );
    completeReservedUsage.mockResolvedValue({
      reservation: platformReservation({ status: 'settled' }),
    });
    generationModelMock.findByIdAndTransform.mockResolvedValue({
      asset: { type: 'image', url: '/f/recovered-image.png' },
      id: 'gen-1',
    });
    const createImage = vi.fn();
    platformRuntimeInit.mockResolvedValue({ createImage });

    const result = await imageRouter.createCaller(mockCtx).createImage(createInput());

    expect(result).toEqual({ success: true });
    expect(completeReservedUsage).toHaveBeenCalledWith({
      completeRequest: true,
      leaseVersion: 7,
      providerRequestId: 'provider-request-1',
      reservationId: 'reservation-1',
      usage: { cost: 0.0006, totalTokens: 1 },
    });
    expect(asyncTaskModelMock.update).toHaveBeenCalledWith('task-1', {
      status: AsyncTaskStatus.Success,
    });
    expect(createImage).not.toHaveBeenCalled();
    expect(claimReservedUsage).not.toHaveBeenCalled();
    expect(releaseUnclaimedUsage).not.toHaveBeenCalled();
  });

  it('keeps a duplicate provider_started outcome unknown without release or retry', async () => {
    mockCtx.modelRuntimeMode = 'platform-managed';
    asyncTaskModelMock.transitionStatus.mockResolvedValue(false);
    asyncTaskModelMock.findById.mockResolvedValue({
      metadata: platformTaskMetadata(),
      status: AsyncTaskStatus.Error,
    });
    vi.mocked(resolveBusinessModelMapping).mockResolvedValue({
      requestedModelId: 'some-model',
      resolvedModelId: 'mapped-model',
    } as any);
    getReservedUsage.mockResolvedValue(
      platformReservation({ actualUsage: null, status: 'provider_started' }),
    );
    const createImage = vi.fn();
    platformRuntimeInit.mockResolvedValue({ createImage });

    await expect(imageRouter.createCaller(mockCtx).createImage(createInput())).resolves.toEqual({
      success: true,
    });

    expect(getReservedUsage).toHaveBeenCalledWith('reservation-1');
    expect(createImage).not.toHaveBeenCalled();
    expect(claimReservedUsage).not.toHaveBeenCalled();
    expect(completeReservedUsage).not.toHaveBeenCalled();
    expect(releaseUnclaimedUsage).not.toHaveBeenCalled();
  });

  it('releases a duplicate task that timed out before the reservation was claimed', async () => {
    mockCtx.modelRuntimeMode = 'platform-managed';
    asyncTaskModelMock.transitionStatus.mockResolvedValue(false);
    asyncTaskModelMock.findById.mockResolvedValue({
      metadata: platformTaskMetadata(),
      status: AsyncTaskStatus.Error,
    });
    vi.mocked(resolveBusinessModelMapping).mockResolvedValue({
      requestedModelId: 'some-model',
      resolvedModelId: 'mapped-model',
    } as any);
    getReservedUsage.mockResolvedValue(
      platformReservation({ actualUsage: null, status: 'reserved' }),
    );

    await expect(imageRouter.createCaller(mockCtx).createImage(createInput())).resolves.toEqual({
      success: true,
    });

    expect(releaseUnclaimedUsage).toHaveBeenCalledWith({
      completeRequest: true,
      leaseVersion: 7,
      reservationId: 'reservation-1',
    });
    expect(claimReservedUsage).not.toHaveBeenCalled();
    expect(completeReservedUsage).not.toHaveBeenCalled();
  });

  it('does not release a stale duplicate reservation lease', async () => {
    mockCtx.modelRuntimeMode = 'platform-managed';
    asyncTaskModelMock.transitionStatus.mockResolvedValue(false);
    asyncTaskModelMock.findById.mockResolvedValue({
      metadata: platformTaskMetadata(),
      status: AsyncTaskStatus.Error,
    });
    vi.mocked(resolveBusinessModelMapping).mockResolvedValue({
      requestedModelId: 'some-model',
      resolvedModelId: 'mapped-model',
    } as any);
    getReservedUsage.mockResolvedValue(
      platformReservation({ actualUsage: null, leaseVersion: 8, status: 'reserved' }),
    );

    await expect(imageRouter.createCaller(mockCtx).createImage(createInput())).resolves.toEqual({
      success: true,
    });

    expect(releaseUnclaimedUsage).not.toHaveBeenCalled();
    expect(completeReservedUsage).not.toHaveBeenCalled();
    expect(claimReservedUsage).not.toHaveBeenCalled();
  });

  it('marks the task Error and reconciles the precharge handle when model mapping throws', async () => {
    asyncTaskModelMock.findById.mockResolvedValue({
      metadata: { precharge: { reservationKey: 'brk-1' } },
    });
    // Regression: this rejection previously happened before the outer try, so the
    // mutation threw without marking the task Error or reconciling billing.
    vi.mocked(resolveBusinessModelMapping).mockRejectedValue(new Error('mapping failed'));

    const caller = imageRouter.createCaller(mockCtx);
    const result = await caller.createImage(createInput());

    // (c) resolves rather than throwing
    expect(result).toMatchObject({ success: false });

    // (a) task marked Error
    expect(asyncTaskModelMock.update).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ status: AsyncTaskStatus.Error }),
    );

    // (b) billing reconciled once with the loaded precharge handle
    expect(chargeAfterGenerate).toHaveBeenCalledTimes(1);
    expect(chargeAfterGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        isError: true,
        prechargeResult: { reservationKey: 'brk-1' },
      }),
    );
  });

  it('threads undefined prechargeResult when the task has no precharge handle', async () => {
    asyncTaskModelMock.findById.mockResolvedValue({ metadata: undefined });
    vi.mocked(resolveBusinessModelMapping).mockRejectedValue(new Error('mapping failed'));

    const caller = imageRouter.createCaller(mockCtx);
    const result = await caller.createImage(createInput());

    expect(result).toMatchObject({ success: false });
    expect(chargeAfterGenerate).toHaveBeenCalledTimes(1);
    expect(chargeAfterGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        isError: true,
        prechargeResult: undefined,
      }),
    );
  });

  it('uses platform credentials while keeping image assets owned by the customer', async () => {
    mockCtx.modelRuntimeMode = 'platform-managed';
    asyncTaskModelMock.findById.mockResolvedValue({ metadata: platformTaskMetadata() });
    vi.mocked(resolveBusinessModelMapping).mockResolvedValue({
      requestedModelId: 'some-model',
      resolvedModelId: 'mapped-model',
    } as any);
    const createImage = vi.fn().mockResolvedValue({
      height: 1024,
      imageUrl: 'https://temporary.provider.test/image.png?token=platform-secret',
      modelUsage: { cost: 0.0006, totalTokens: 1 },
      width: 1024,
    });
    platformRuntimeInit.mockResolvedValue({
      createImage,
    });
    generationServiceMock.transformImageForGeneration.mockResolvedValue({
      image: {
        extension: 'png',
        hash: 'customer-image-hash',
        height: 1024,
        mime: 'image/png',
        size: 42,
        width: 1024,
      },
      thumbnailImage: {},
    });
    generationServiceMock.uploadImageForGeneration.mockResolvedValue({
      imageUrl: 'https://files.test/customer-image.png',
      thumbnailImageUrl: 'https://files.test/customer-image-thumbnail.png',
    });

    const result = await imageRouter.createCaller(mockCtx).createImage(createInput());

    expect(result).toEqual({ success: true });
    expect(PlatformAiRuntime).toHaveBeenCalledWith(mockCtx.serverDB);
    expect(platformRuntimeInit).toHaveBeenCalledWith({
      actorUserId: userId,
      provider: 'test-provider',
      workspaceId: undefined,
    });
    expect(initModelRuntimeFromDB).not.toHaveBeenCalled();
    expect(PlatformUsageReservationService).toHaveBeenCalledWith(mockCtx.serverDB, userId);
    expect(getReservedUsage).toHaveBeenCalledWith('reservation-1');
    expect(claimReservedUsage.mock.invocationCallOrder[0]).toBeLessThan(
      createImage.mock.invocationCallOrder[0]!,
    );
    expect(createImage.mock.invocationCallOrder[0]).toBeLessThan(
      completeReservedUsage.mock.invocationCallOrder[0]!,
    );
    expect(completeReservedUsage).toHaveBeenCalledWith({
      completeRequest: true,
      leaseVersion: 7,
      reservationId: 'reservation-1',
      usage: { cost: 0.0006, totalTokens: 1 },
    });
    expect(completeReservedUsage.mock.invocationCallOrder[0]).toBeLessThan(
      generationServiceMock.transformImageForGeneration.mock.invocationCallOrder[0]!,
    );
    expect(completeReservedUsage.mock.invocationCallOrder[0]).toBeLessThan(
      generationModelMock.createAssetAndFile.mock.invocationCallOrder[0]!,
    );
    expect(chargeAfterGenerate).not.toHaveBeenCalled();
    expect(GenerationModel).toHaveBeenCalledWith(mockCtx.serverDB, userId, undefined);
    expect(GenerationService).toHaveBeenCalledWith(mockCtx.serverDB, userId, undefined);
    expect(generationModelMock.createAssetAndFile).toHaveBeenCalledWith(
      'gen-1',
      expect.objectContaining({
        originalUrl: 'https://files.test/customer-image.png',
        url: 'https://files.test/customer-image.png',
      }),
      expect.objectContaining({
        fileHash: 'customer-image-hash',
        url: 'https://files.test/customer-image.png',
      }),
    );
    expect(JSON.stringify(generationModelMock.createAssetAndFile.mock.calls)).not.toMatch(
      /temporary\.provider\.test|platform-secret/,
    );
  });

  it('does not write platform prompts, temporary image URLs, or provider responses to debug logs', async () => {
    mockCtx = {
      modelRuntimeMode: 'platform-managed',
      serverDB: {},
      userId: 'private-user-id',
      workspaceId: 'private-workspace-id',
    };
    asyncTaskModelMock.findById.mockResolvedValue({
      metadata: platformTaskMetadata(),
    });
    vi.mocked(resolveBusinessModelMapping).mockResolvedValue({
      requestedModelId: 'some-model',
      resolvedModelId: 'mapped-model',
    } as any);
    getReservedUsage.mockResolvedValue(
      platformReservation({
        generationId: 'private-generation-id',
        provider: 'private-provider-id',
        workspaceId: 'private-workspace-id',
      }),
    );
    claimReservedUsage.mockResolvedValue({
      reservation: platformReservation({
        generationId: 'private-generation-id',
        provider: 'private-provider-id',
        status: 'provider_started',
        workspaceId: 'private-workspace-id',
      }),
      shouldCallProvider: true,
    });
    platformRuntimeInit.mockResolvedValue({
      createImage: vi.fn().mockResolvedValue({
        height: 1024,
        imageUrl: 'https://temporary.provider.test/private-image-token',
        modelUsage: { cost: 0.0006, totalTokens: 1 },
        providerPayload: { requestId: 'secret-provider-response' },
        width: 1024,
      }),
    });
    generationServiceMock.transformImageForGeneration.mockResolvedValue({
      image: {
        extension: 'png',
        hash: 'customer-image-hash',
        height: 1024,
        mime: 'image/png',
        size: 42,
        width: 1024,
      },
      thumbnailImage: {},
    });
    generationServiceMock.uploadImageForGeneration.mockResolvedValue({
      imageUrl: 'https://files.test/customer-image.png',
      thumbnailImageUrl: 'https://files.test/customer-image-thumbnail.png',
    });

    await imageRouter.createCaller(mockCtx).createImage(
      createInput({
        generationBatchId: 'private-batch-id',
        generationId: 'private-generation-id',
        generationTopicId: 'private-topic-id',
        model: 'private-model-id',
        params: { prompt: 'private customer travel prompt' },
        provider: 'private-provider-id',
        taskId: 'private-task-id',
        workspaceId: 'private-workspace-id',
      }),
    );

    const logged = JSON.stringify(debugLog.mock.calls);
    for (const sensitiveValue of [
      'private customer travel prompt',
      'https://temporary.provider.test/private-image-token',
      'secret-provider-response',
      'private-user-id',
      'private-workspace-id',
      'private-batch-id',
      'private-generation-id',
      'private-topic-id',
      'private-task-id',
      'private-model-id',
      'private-provider-id',
    ]) {
      expect(logged).not.toContain(sensitiveValue);
    }
  });

  it.each([
    [
      'provider',
      () =>
        platformRuntimeInit.mockResolvedValue({
          createImage: vi.fn().mockRejectedValue(new Error('raw-provider-error api-key-secret')),
        }),
    ],
    [
      'database',
      () => {
        platformRuntimeInit.mockResolvedValue({
          createImage: vi.fn().mockResolvedValue({
            height: 1024,
            imageUrl: 'data:image/png;base64,generated',
            modelUsage: { cost: 0.0006, totalTokens: 1 },
            width: 1024,
          }),
        });
        generationServiceMock.transformImageForGeneration.mockRejectedValue(
          new Error('raw-database-error connection-secret'),
        );
      },
    ],
  ])('does not serialize raw %s errors to debug logs', async (_kind, arrange) => {
    mockCtx.modelRuntimeMode = 'platform-managed';
    asyncTaskModelMock.findById.mockResolvedValue({ metadata: platformTaskMetadata() });
    vi.mocked(resolveBusinessModelMapping).mockResolvedValue({
      requestedModelId: 'some-model',
      resolvedModelId: 'mapped-model',
    } as any);
    arrange();

    await imageRouter.createCaller(mockCtx).createImage(createInput());

    expect(JSON.stringify(debugLog.mock.calls)).not.toMatch(
      /raw-provider-error|api-key-secret|raw-database-error|connection-secret/,
    );
    expect(releaseUnclaimedUsage).not.toHaveBeenCalled();
  });

  it.each([
    [
      'provider',
      'raw-provider-error api-key-secret',
      () =>
        platformRuntimeInit.mockResolvedValue({
          createImage: vi.fn().mockRejectedValue(new Error('raw-provider-error api-key-secret')),
        }),
    ],
    [
      'database',
      'raw-database-error postgresql://admin:connection-secret@internal-db/image',
      () => {
        platformRuntimeInit.mockResolvedValue({
          createImage: vi.fn().mockResolvedValue({
            height: 1024,
            imageUrl: 'data:image/png;base64,generated',
            modelUsage: { cost: 0.0006, totalTokens: 1 },
            width: 1024,
          }),
        });
        generationServiceMock.transformImageForGeneration.mockRejectedValue(
          new Error('raw-database-error postgresql://admin:connection-secret@internal-db/image'),
        );
      },
    ],
    [
      'billing',
      'raw-billing-error customer-ledger-secret',
      () =>
        claimReservedUsage.mockRejectedValue(new Error('raw-billing-error customer-ledger-secret')),
    ],
    [
      'network',
      'raw-network-error https://internal-provider.test?token=private-network-token',
      () =>
        platformRuntimeInit.mockResolvedValue({
          createImage: vi
            .fn()
            .mockRejectedValue(
              Object.assign(
                new Error(
                  'raw-network-error https://internal-provider.test?token=private-network-token',
                ),
                { name: 'NetworkError' },
              ),
            ),
        }),
    ],
    [
      'wrapped async task',
      'raw-async-task-error private-subscription-reference',
      () =>
        platformRuntimeInit.mockResolvedValue({
          createImage: vi
            .fn()
            .mockRejectedValue(
              new AsyncTaskError(
                AsyncTaskErrorType.SubscriptionPlanLimit,
                'raw-async-task-error private-subscription-reference',
              ),
            ),
        }),
    ],
  ])('does not persist or return raw %s failures', async (_kind, secret, arrange) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      mockCtx.modelRuntimeMode = 'platform-managed';
      asyncTaskModelMock.findById.mockResolvedValue({ metadata: platformTaskMetadata() });
      vi.mocked(resolveBusinessModelMapping).mockResolvedValue({
        requestedModelId: 'some-model',
        resolvedModelId: 'mapped-model',
      } as any);
      arrange();

      const result = await imageRouter.createCaller(mockCtx).createImage(createInput());
      const serialized = JSON.stringify({
        console: consoleError.mock.calls,
        result,
        updates: asyncTaskModelMock.update.mock.calls,
      });

      expect(result).toEqual({
        message: `Image generation task-1 failed: ${
          _kind === 'wrapped async task'
            ? AsyncTaskErrorType.SubscriptionPlanLimit
            : AsyncTaskErrorType.ServerError
        }`,
        success: false,
      });
      expect(serialized).not.toContain(secret);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('does not serialize raw hook errors to console', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      mockCtx.modelRuntimeMode = 'platform-managed';
      asyncTaskModelMock.findById.mockResolvedValue({ metadata: platformTaskMetadata() });
      vi.mocked(resolveBusinessModelMapping).mockResolvedValue({
        requestedModelId: 'some-model',
        resolvedModelId: 'mapped-model',
      } as any);
      platformRuntimeInit.mockResolvedValue({
        createImage: vi.fn().mockResolvedValue({
          height: 1024,
          imageUrl: 'data:image/png;base64,generated',
          modelUsage: { cost: 0.0006, totalTokens: 1 },
          width: 1024,
        }),
      });
      generationServiceMock.transformImageForGeneration.mockResolvedValue({
        image: {
          extension: 'png',
          hash: 'customer-image-hash',
          height: 1024,
          mime: 'image/png',
          size: 42,
          width: 1024,
        },
        thumbnailImage: {},
      });
      generationServiceMock.uploadImageForGeneration.mockResolvedValue({
        imageUrl: 'https://files.test/customer-image.png',
        thumbnailImageUrl: 'https://files.test/customer-image-thumbnail.png',
      });
      vi.mocked(notifyImageCompleted).mockRejectedValue(
        new Error('raw-hook-error notification-api-key'),
      );

      await imageRouter.createCaller(mockCtx).createImage(createInput());

      expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(
        /raw-hook-error|notification-api-key/,
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('releases the owned reservation when runtime initialization fails before claim', async () => {
    mockCtx.modelRuntimeMode = 'platform-managed';
    asyncTaskModelMock.findById.mockResolvedValue({ metadata: platformTaskMetadata() });
    vi.mocked(resolveBusinessModelMapping).mockResolvedValue({
      requestedModelId: 'some-model',
      resolvedModelId: 'mapped-model',
    } as any);
    const createImage = vi.fn();
    platformRuntimeInit.mockRejectedValue(new Error('runtime initialization failed'));

    const result = await imageRouter.createCaller(mockCtx).createImage(createInput());

    expect(result).toMatchObject({ success: false });
    expect(createImage).not.toHaveBeenCalled();
    expect(claimReservedUsage).not.toHaveBeenCalled();
    expect(completeReservedUsage).not.toHaveBeenCalled();
    expect(releaseUnclaimedUsage).toHaveBeenCalledWith({
      completeRequest: true,
      leaseVersion: 7,
      reservationId: 'reservation-1',
    });
    expect(generationModelMock.createAssetAndFile).not.toHaveBeenCalled();
    expect(asyncTaskModelMock.update).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ status: AsyncTaskStatus.Error }),
    );
    expect(chargeAfterGenerate).not.toHaveBeenCalled();
  });

  it('does not release or call the provider when a reservation claim has an unknown outcome', async () => {
    mockCtx.modelRuntimeMode = 'platform-managed';
    asyncTaskModelMock.findById.mockResolvedValue({ metadata: platformTaskMetadata() });
    vi.mocked(resolveBusinessModelMapping).mockResolvedValue({
      requestedModelId: 'some-model',
      resolvedModelId: 'mapped-model',
    } as any);
    const createImage = vi.fn();
    platformRuntimeInit.mockResolvedValue({ createImage });
    claimReservedUsage.mockRejectedValue(new Error('claim result unknown'));

    const result = await imageRouter.createCaller(mockCtx).createImage(createInput());

    expect(result).toMatchObject({ success: false });
    expect(createImage).not.toHaveBeenCalled();
    expect(releaseUnclaimedUsage).not.toHaveBeenCalled();
    expect(chargeAfterGenerate).not.toHaveBeenCalled();
  });

  it('does not call the provider when another worker already owns the reservation claim', async () => {
    mockCtx.modelRuntimeMode = 'platform-managed';
    asyncTaskModelMock.findById.mockResolvedValue({ metadata: platformTaskMetadata() });
    vi.mocked(resolveBusinessModelMapping).mockResolvedValue({
      requestedModelId: 'some-model',
      resolvedModelId: 'mapped-model',
    } as any);
    const createImage = vi.fn();
    platformRuntimeInit.mockResolvedValue({ createImage });
    claimReservedUsage.mockResolvedValue({
      reservation: platformReservation({ status: 'provider_started' }),
      shouldCallProvider: false,
    });

    const result = await imageRouter.createCaller(mockCtx).createImage(createInput());

    expect(result).toEqual({ success: true });
    expect(createImage).not.toHaveBeenCalled();
    expect(completeReservedUsage).not.toHaveBeenCalled();
    expect(releaseUnclaimedUsage).not.toHaveBeenCalled();
    expect(generationModelMock.createAssetAndFile).not.toHaveBeenCalled();
  });

  it.each([
    ['cross-user lookup', undefined, platformTaskMetadata()],
    [
      'forged budget metadata',
      platformReservation(),
      platformTaskMetadata({ budgetId: 'forged-budget' }),
    ],
    [
      'workspace mismatch',
      platformReservation({ workspaceId: 'workspace-b' }),
      platformTaskMetadata(),
    ],
    ['stale lease', platformReservation({ leaseVersion: 8 }), platformTaskMetadata()],
  ])('fails closed before claim for %s', async (_case, reservation, metadata) => {
    mockCtx.modelRuntimeMode = 'platform-managed';
    asyncTaskModelMock.findById.mockResolvedValue({ metadata });
    getReservedUsage.mockResolvedValue(reservation);
    const createImage = vi.fn();
    platformRuntimeInit.mockResolvedValue({ createImage });

    const result = await imageRouter.createCaller(mockCtx).createImage(createInput());

    expect(result).toMatchObject({ success: false });
    expect(resolveBusinessModelMapping).not.toHaveBeenCalled();
    expect(claimReservedUsage).not.toHaveBeenCalled();
    expect(createImage).not.toHaveBeenCalled();
    expect(releaseUnclaimedUsage).not.toHaveBeenCalled();
    expect(generationModelMock.createAssetAndFile).not.toHaveBeenCalled();
  });

  it('fails closed when authoritative image usage is missing', async () => {
    mockCtx.modelRuntimeMode = 'platform-managed';
    asyncTaskModelMock.findById.mockResolvedValue({ metadata: platformTaskMetadata() });
    vi.mocked(resolveBusinessModelMapping).mockResolvedValue({
      requestedModelId: 'some-model',
      resolvedModelId: 'mapped-model',
    } as any);
    const createImage = vi.fn().mockResolvedValue({
      height: 1024,
      imageUrl: 'data:image/png;base64,generated',
      width: 1024,
    });
    platformRuntimeInit.mockResolvedValue({ createImage });
    completeReservedUsage.mockRejectedValue(new Error('authoritative usage required'));

    const result = await imageRouter.createCaller(mockCtx).createImage(createInput());

    expect(result).toMatchObject({ success: false });
    expect(createImage).toHaveBeenCalledOnce();
    expect(completeReservedUsage).toHaveBeenCalledTimes(2);
    expect(completeReservedUsage.mock.calls[0]?.[0]).not.toHaveProperty('usage');
    expect(generationServiceMock.transformImageForGeneration).not.toHaveBeenCalled();
    expect(generationModelMock.createAssetAndFile).not.toHaveBeenCalled();
    expect(releaseUnclaimedUsage).not.toHaveBeenCalled();
  });

  it('fails closed before asset delivery when platform image settlement fails', async () => {
    mockCtx.modelRuntimeMode = 'platform-managed';
    asyncTaskModelMock.findById.mockResolvedValue({ metadata: platformTaskMetadata() });
    vi.mocked(resolveBusinessModelMapping).mockResolvedValue({
      requestedModelId: 'some-model',
      resolvedModelId: 'mapped-model',
    } as any);
    platformRuntimeInit.mockResolvedValue({
      createImage: vi.fn().mockResolvedValue({
        height: 1024,
        imageUrl: 'data:image/png;base64,generated',
        modelUsage: { cost: 0.0006, totalTokens: 1 },
        width: 1024,
      }),
    });
    generationServiceMock.transformImageForGeneration.mockResolvedValue({
      image: {
        extension: 'png',
        hash: 'customer-image-hash',
        height: 1024,
        mime: 'image/png',
        size: 42,
        width: 1024,
      },
      thumbnailImage: {},
    });
    generationServiceMock.uploadImageForGeneration.mockResolvedValue({
      imageUrl: 'https://files.test/customer-image.png',
      thumbnailImageUrl: 'https://files.test/customer-image-thumbnail.png',
    });
    completeReservedUsage.mockRejectedValue(new Error('image billing settlement failed'));

    const result = await imageRouter.createCaller(mockCtx).createImage(createInput());

    expect(result).toMatchObject({ success: false });
    expect(generationModelMock.createAssetAndFile).not.toHaveBeenCalled();
    expect(asyncTaskModelMock.update).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ status: AsyncTaskStatus.Error }),
    );
    expect(completeReservedUsage).toHaveBeenCalledTimes(2);
    expect(releaseUnclaimedUsage).not.toHaveBeenCalled();
    expect(chargeAfterGenerate).not.toHaveBeenCalled();
  });

  it('does not trust platform mode without the persisted platform task marker', async () => {
    mockCtx.modelRuntimeMode = 'platform-managed';
    asyncTaskModelMock.findById.mockResolvedValue({ metadata: undefined });
    vi.mocked(resolveBusinessModelMapping).mockResolvedValue({
      requestedModelId: 'some-model',
      resolvedModelId: 'mapped-model',
    } as any);
    const createImage = vi.fn().mockResolvedValue({
      height: 1024,
      imageUrl: 'https://temporary.provider.test/ordinary.png?token=user-provider-token',
      modelUsage: { cost: 0.0006, totalTokens: 1 },
      width: 1024,
    });
    vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ createImage } as any);
    generationServiceMock.transformImageForGeneration.mockResolvedValue({
      image: {
        extension: 'png',
        hash: 'customer-image-hash',
        height: 1024,
        mime: 'image/png',
        size: 42,
        width: 1024,
      },
      thumbnailImage: {},
    });
    generationServiceMock.uploadImageForGeneration.mockResolvedValue({
      imageUrl: 'https://files.test/customer-image.png',
      thumbnailImageUrl: 'https://files.test/customer-image-thumbnail.png',
    });

    const result = await imageRouter.createCaller(mockCtx).createImage(createInput());

    expect(result).toEqual({ success: true });
    expect(PlatformAiRuntime).not.toHaveBeenCalled();
    expect(PlatformUsageReservationService).not.toHaveBeenCalled();
    expect(initModelRuntimeFromDB).toHaveBeenCalled();
    expect(chargeAfterGenerate).toHaveBeenCalledTimes(1);
    expect(generationModelMock.createAssetAndFile).toHaveBeenCalledWith(
      'gen-1',
      expect.objectContaining({
        originalUrl: 'https://temporary.provider.test/ordinary.png?token=user-provider-token',
        url: 'https://files.test/customer-image.png',
      }),
      expect.any(Object),
    );
  });

  it('fails before the provider and reconciles an unexpected business precharge', async () => {
    mockCtx.modelRuntimeMode = 'platform-managed';
    asyncTaskModelMock.findById.mockResolvedValue({
      metadata: {
        ...platformTaskMetadata(),
        precharge: { reservationKey: 'legacy-business-reservation' },
      },
    });
    vi.mocked(resolveBusinessModelMapping).mockResolvedValue({
      requestedModelId: 'some-model',
      resolvedModelId: 'mapped-model',
    } as any);
    const createImage = vi.fn();
    platformRuntimeInit.mockResolvedValue({ createImage });

    const result = await imageRouter.createCaller(mockCtx).createImage(createInput());

    expect(result).toMatchObject({ success: false });
    expect(createImage).not.toHaveBeenCalled();
    expect(claimReservedUsage).not.toHaveBeenCalled();
    expect(completeReservedUsage).not.toHaveBeenCalled();
    expect(releaseUnclaimedUsage).toHaveBeenCalledWith({
      completeRequest: true,
      leaseVersion: 7,
      reservationId: 'reservation-1',
    });
    expect(chargeAfterGenerate).not.toHaveBeenCalled();
  });
});
