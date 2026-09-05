import { describe, expect, it, vi } from 'vitest';

import type { TravelGenerationRecord } from './index';
import { TravelGenerationSettlementService } from './settlement';

const pendingTask = (overrides: Partial<TravelGenerationRecord> = {}): TravelGenerationRecord => ({
  artifacts: [{ asyncTaskId: 'async-1', generationId: 'generation-1', type: 'task' }],
  id: 'travel-task-1',
  input: { prompt: '西藏旅游封面' },
  owner: { groupId: 'group-1', userId: 'user-1', workspaceId: 'workspace-1' },
  provider: 'platform-image',
  status: 'pending',
  type: 'image',
  usage: { totalTokens: 20 },
  ...overrides,
});

const platformHandle = {
  budgetId: 'budget-1',
  leaseVersion: 7,
  reservationId: 'reservation-1',
};

const platformTaskMetadata = {
  platformAiRuntime: true,
  platformUsageReservation: platformHandle,
};

const platformReservation = (overrides: Record<string, unknown> = {}) => ({
  actualUsage: { cost: 0.00125, outputImageTokens: 920, totalTokens: 1000 },
  budgetId: 'budget-1',
  callKind: 'image',
  generationId: 'generation-1',
  generationType: 'platform-image-generation',
  id: 'reservation-1',
  leaseVersion: 7,
  model: 'priced-image-model',
  provider: 'priced-provider',
  providerRequestId: 'provider-request-1',
  status: 'provider_completed',
  workspaceId: 'workspace-1',
  ...overrides,
});

const setup = (task: TravelGenerationRecord | null, asyncStatus = 'processing') => {
  const update = vi.fn(async () => undefined);
  const findGeneration = vi.fn(async () => ({
    asset: { type: 'image', url: '/f/travel-cover.png' },
    id: 'generation-1',
  }));
  const service = new TravelGenerationSettlementService({
    repository: { findById: vi.fn(async () => task), update },
    runtime: {
      checkTimeoutTasks: vi.fn(async () => undefined),
      findAsyncTask: vi.fn(async () => ({ status: asyncStatus })),
      findGeneration,
    },
  });
  return { findGeneration, service, update };
};

describe('TravelGenerationSettlementService', () => {
  it('keeps an active async task pending', async () => {
    const { findGeneration, service, update } = setup(pendingTask());
    await expect(service.reconcile('travel-task-1')).resolves.toMatchObject({ status: 'pending' });
    expect(findGeneration).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('keeps a pending task unchanged when async status lookup fails transiently', async () => {
    const update = vi.fn();
    const findGeneration = vi.fn();
    const service = new TravelGenerationSettlementService({
      repository: { findById: vi.fn(async () => pendingTask()), update },
      runtime: {
        checkTimeoutTasks: vi.fn(async () => undefined),
        findAsyncTask: vi.fn(async () => {
          throw new Error('temporary async task query failure');
        }),
        findGeneration,
      },
    });

    await expect(service.reconcile('travel-task-1')).resolves.toMatchObject({ status: 'pending' });
    expect(findGeneration).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('keeps a provider-complete task pending when asset lookup fails transiently', async () => {
    const update = vi.fn();
    const service = new TravelGenerationSettlementService({
      repository: { findById: vi.fn(async () => pendingTask()), update },
      runtime: {
        checkTimeoutTasks: vi.fn(async () => undefined),
        findAsyncTask: vi.fn(async () => ({ status: 'success' })),
        findGeneration: vi.fn(async () => {
          throw new Error('temporary asset query failure');
        }),
      },
    });

    await expect(service.reconcile('travel-task-1')).resolves.toMatchObject({ status: 'pending' });
    expect(update).not.toHaveBeenCalled();
  });

  it('publishes the generated asset after async success without a custom billing lifecycle', async () => {
    const { service, update } = setup(pendingTask(), 'success');
    await expect(service.reconcile('travel-task-1')).resolves.toMatchObject({
      artifacts: [
        {
          asyncTaskId: 'async-1',
          generationId: 'generation-1',
          type: 'image',
          url: '/f/travel-cover.png',
        },
      ],
      status: 'succeeded',
      usage: { totalTokens: 20 },
    });
    expect(update).toHaveBeenCalledWith(
      'travel-task-1',
      expect.objectContaining({ status: 'succeeded' }),
    );
  });

  it('fails instead of persisting an unsafe async image URL', async () => {
    const update = vi.fn(async () => undefined);
    const service = new TravelGenerationSettlementService({
      repository: { findById: vi.fn(async () => pendingTask()), update },
      runtime: {
        checkTimeoutTasks: vi.fn(async () => undefined),
        findAsyncTask: vi.fn(async () => ({ status: 'success' })),
        findGeneration: vi.fn(async () => ({
          asset: {
            type: 'image',
            url: 'https://temporary.provider.test/image?signature=secret',
          },
          id: 'generation-1',
        })),
      },
    });

    await expect(service.reconcile('travel-task-1')).resolves.toMatchObject({
      code: 'GENERATION_FAILED',
      status: 'failed',
    });
    expect(update).toHaveBeenCalledWith(
      'travel-task-1',
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('normalizes signed paths and deduplicates async image assets before success', async () => {
    const update = vi.fn(async () => undefined);
    const service = new TravelGenerationSettlementService({
      repository: {
        findById: vi.fn(async () =>
          pendingTask({
            artifacts: [
              { asyncTaskId: 'async-1', generationId: 'generation-1', type: 'task' },
              { asyncTaskId: 'async-2', generationId: 'generation-2', type: 'task' },
            ],
          }),
        ),
        update,
      },
      runtime: {
        checkTimeoutTasks: vi.fn(async () => undefined),
        findAsyncTask: vi.fn(async () => ({ status: 'success' })),
        findGeneration: vi.fn(async (id) => ({
          asset: {
            type: 'image',
            url: id === 'generation-1' ? '/f/shared?token=secret' : '/f/shared?other=secret',
          },
          id,
        })),
      },
    });

    const result = await service.reconcile('travel-task-1');

    expect(result).toMatchObject({
      artifacts: [
        {
          asyncTaskId: 'async-1',
          generationId: 'generation-1',
          type: 'image',
          url: '/f/shared',
        },
      ],
      status: 'succeeded',
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('marks the task failed once an async provider task fails', async () => {
    const { service, update } = setup(pendingTask(), 'error');
    await expect(service.reconcile('travel-task-1')).resolves.toMatchObject({
      code: 'GENERATION_FAILED',
      status: 'failed',
    });
    expect(update).toHaveBeenCalledWith(
      'travel-task-1',
      expect.objectContaining({ code: 'GENERATION_FAILED', status: 'failed' }),
    );
  });

  it('does not reconcile an already terminal travel task twice', async () => {
    const { findGeneration, service, update } = setup(
      pendingTask({ status: 'succeeded' }),
      'success',
    );
    await expect(service.reconcile('travel-task-1')).resolves.toMatchObject({
      status: 'succeeded',
    });
    expect(findGeneration).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('settles one async success only once when reconciliation races', async () => {
    let releaseGeneration!: () => void;
    const generationReady = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    const update = vi.fn(async () => true);
    const service = new TravelGenerationSettlementService({
      repository: {
        findById: vi.fn(async () => pendingTask()),
        transition: update,
        update: vi.fn(),
      },
      runtime: {
        checkTimeoutTasks: vi.fn(async () => undefined),
        findAsyncTask: vi.fn(async () => ({ status: 'success' })),
        findGeneration: vi.fn(async () => {
          await generationReady;
          return {
            asset: { type: 'image', url: '/f/travel-cover.png' },
            id: 'generation-1',
          };
        }),
      },
    });

    const first = service.reconcile('travel-task-1');
    const second = service.reconcile('travel-task-1');
    releaseGeneration();

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: 'succeeded' }),
      expect.objectContaining({ status: 'succeeded' }),
    ]);
    expect(update).toHaveBeenCalledOnce();
  });

  it('returns null when the owner-scoped repository cannot see the task', async () => {
    const { service } = setup(null, 'success');
    await expect(service.reconcile('other-user-task')).resolves.toBeNull();
  });

  it('fails instead of publishing a partially linked async artifact set', async () => {
    const { service, update } = setup(
      pendingTask({
        artifacts: [
          { asyncTaskId: 'async-1', generationId: 'generation-1', type: 'task' },
          { asyncTaskId: 'async-without-generation', type: 'task' },
        ],
      }),
      'success',
    );
    await expect(service.reconcile('travel-task-1')).resolves.toMatchObject({
      code: 'GENERATION_FAILED',
      status: 'failed',
    });
    expect(update).toHaveBeenCalledWith(
      'travel-task-1',
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('recovers provider_completed to settled from persisted usage before delivering the asset', async () => {
    const update = vi.fn(async () => undefined);
    const settlePlatformImageReservation = vi.fn(async () =>
      platformReservation({ status: 'settled' }),
    );
    const service = new TravelGenerationSettlementService({
      repository: { findById: vi.fn(async () => pendingTask()), update },
      runtime: {
        checkTimeoutTasks: vi.fn(async () => undefined),
        findAsyncTask: vi.fn(async () => ({
          metadata: platformTaskMetadata,
          status: 'processing',
        })),
        findGeneration: vi.fn(async () => ({
          asset: { type: 'image', url: '/f/recovered-image.png' },
          id: 'generation-1',
        })),
        findPlatformImageReservation: vi.fn(async () => platformReservation()),
        releasePlatformImageReservation: vi.fn(),
        settlePlatformImageReservation,
      },
    } as any);

    await expect(service.reconcile('travel-task-1')).resolves.toMatchObject({
      artifacts: [
        expect.objectContaining({
          generationId: 'generation-1',
          type: 'image',
          url: '/f/recovered-image.png',
        }),
      ],
      status: 'succeeded',
    });
    expect(settlePlatformImageReservation).toHaveBeenCalledWith({
      leaseVersion: 7,
      providerRequestId: 'provider-request-1',
      reservationId: 'reservation-1',
      usage: { cost: 0.00125, outputImageTokens: 920, totalTokens: 1000 },
    });
  });

  it('delivers an already settled image with an owned durable asset even while async status is processing', async () => {
    const update = vi.fn(async () => undefined);
    const settlePlatformImageReservation = vi.fn();
    const service = new TravelGenerationSettlementService({
      repository: { findById: vi.fn(async () => pendingTask()), update },
      runtime: {
        checkTimeoutTasks: vi.fn(async () => undefined),
        findAsyncTask: vi.fn(async () => ({
          metadata: platformTaskMetadata,
          status: 'processing',
        })),
        findGeneration: vi.fn(async () => ({
          asset: { type: 'image', url: '/f/already-settled.png' },
          id: 'generation-1',
        })),
        findPlatformImageReservation: vi.fn(async () => platformReservation({ status: 'settled' })),
        releasePlatformImageReservation: vi.fn(),
        settlePlatformImageReservation,
      },
    } as any);

    await expect(service.reconcile('travel-task-1')).resolves.toMatchObject({
      artifacts: [expect.objectContaining({ url: '/f/already-settled.png' })],
      status: 'succeeded',
    });
    expect(settlePlatformImageReservation).not.toHaveBeenCalled();
  });

  it('marks a settled image without a durable asset for manual review without releasing or retrying', async () => {
    const update = vi.fn(async () => undefined);
    const releasePlatformImageReservation = vi.fn();
    const settlePlatformImageReservation = vi.fn();
    const service = new TravelGenerationSettlementService({
      repository: { findById: vi.fn(async () => pendingTask()), update },
      runtime: {
        checkTimeoutTasks: vi.fn(async () => undefined),
        findAsyncTask: vi.fn(async () => ({ metadata: platformTaskMetadata, status: 'error' })),
        findGeneration: vi.fn(async () => ({ asset: null, id: 'generation-1' })),
        findPlatformImageReservation: vi.fn(async () => platformReservation({ status: 'settled' })),
        releasePlatformImageReservation,
        settlePlatformImageReservation,
      },
    } as any);

    await expect(service.reconcile('travel-task-1')).resolves.toMatchObject({
      code: 'ARTIFACT_PERSISTENCE_FAILED',
      message: '内容已生成并计费，但作品保存失败。请稍后重试查询或联系人工处理。',
      status: 'failed',
    });
    expect(releasePlatformImageReservation).not.toHaveBeenCalled();
    expect(settlePlatformImageReservation).not.toHaveBeenCalled();
  });

  it('keeps provider_started unknown after a timeout without releasing, settling, or delivering', async () => {
    const update = vi.fn(async () => undefined);
    const findGeneration = vi.fn();
    const releasePlatformImageReservation = vi.fn();
    const settlePlatformImageReservation = vi.fn();
    const service = new TravelGenerationSettlementService({
      repository: { findById: vi.fn(async () => pendingTask()), update },
      runtime: {
        checkTimeoutTasks: vi.fn(async () => undefined),
        findAsyncTask: vi.fn(async () => ({ metadata: platformTaskMetadata, status: 'error' })),
        findGeneration,
        findPlatformImageReservation: vi.fn(async () =>
          platformReservation({ actualUsage: null, status: 'provider_started' }),
        ),
        releasePlatformImageReservation,
        settlePlatformImageReservation,
      },
    } as any);

    await expect(service.reconcile('travel-task-1')).resolves.toMatchObject({ status: 'pending' });
    expect(releasePlatformImageReservation).not.toHaveBeenCalled();
    expect(settlePlatformImageReservation).not.toHaveBeenCalled();
    expect(findGeneration).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('releases a still-reserved image after the async reaper marks it error', async () => {
    const update = vi.fn(async () => undefined);
    const releasePlatformImageReservation = vi.fn(async () =>
      platformReservation({ actualUsage: null, status: 'released' }),
    );
    const service = new TravelGenerationSettlementService({
      repository: { findById: vi.fn(async () => pendingTask()), update },
      runtime: {
        checkTimeoutTasks: vi.fn(async () => undefined),
        findAsyncTask: vi.fn(async () => ({ metadata: platformTaskMetadata, status: 'error' })),
        findGeneration: vi.fn(),
        findPlatformImageReservation: vi.fn(async () =>
          platformReservation({ actualUsage: null, status: 'reserved' }),
        ),
        releasePlatformImageReservation,
        settlePlatformImageReservation: vi.fn(),
      },
    } as any);

    await expect(service.reconcile('travel-task-1')).resolves.toMatchObject({
      code: 'GENERATION_FAILED',
      status: 'failed',
    });
    expect(releasePlatformImageReservation).toHaveBeenCalledWith({
      completeRequest: true,
      leaseVersion: 7,
      reservationId: 'reservation-1',
    });
  });

  it('does not release a reserved image while its async worker is still active', async () => {
    const update = vi.fn(async () => undefined);
    const releasePlatformImageReservation = vi.fn();
    const service = new TravelGenerationSettlementService({
      repository: { findById: vi.fn(async () => pendingTask()), update },
      runtime: {
        checkTimeoutTasks: vi.fn(async () => undefined),
        findAsyncTask: vi.fn(async () => ({
          metadata: platformTaskMetadata,
          status: 'processing',
        })),
        findGeneration: vi.fn(),
        findPlatformImageReservation: vi.fn(async () =>
          platformReservation({ actualUsage: null, status: 'reserved' }),
        ),
        releasePlatformImageReservation,
        settlePlatformImageReservation: vi.fn(),
      },
    } as any);

    await expect(service.reconcile('travel-task-1')).resolves.toMatchObject({ status: 'pending' });
    expect(releasePlatformImageReservation).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ['cross-actor lookup', null, platformTaskMetadata],
    [
      'workspace mismatch',
      platformReservation({ workspaceId: 'workspace-2' }),
      platformTaskMetadata,
    ],
    [
      'forged budget',
      platformReservation(),
      {
        ...platformTaskMetadata,
        platformUsageReservation: { ...platformHandle, budgetId: 'forged-budget' },
      },
    ],
    ['stale lease', platformReservation({ leaseVersion: 8 }), platformTaskMetadata],
    [
      'forged generation',
      platformReservation({ generationId: 'other-generation' }),
      platformTaskMetadata,
    ],
  ])(
    'fails closed for %s without billing mutation or delivery',
    async (_case, reservation, metadata) => {
      const update = vi.fn(async () => undefined);
      const findGeneration = vi.fn(async () => ({
        asset: { type: 'image', url: '/f/must-not-deliver.png' },
        id: 'generation-1',
      }));
      const releasePlatformImageReservation = vi.fn();
      const settlePlatformImageReservation = vi.fn();
      const service = new TravelGenerationSettlementService({
        repository: { findById: vi.fn(async () => pendingTask()), update },
        runtime: {
          checkTimeoutTasks: vi.fn(async () => undefined),
          findAsyncTask: vi.fn(async () => ({ metadata, status: 'success' })),
          findGeneration,
          findPlatformImageReservation: vi.fn(async () => reservation),
          releasePlatformImageReservation,
          settlePlatformImageReservation,
        },
      } as any);

      await expect(service.reconcile('travel-task-1')).resolves.toMatchObject({
        code: 'GENERATION_FAILED',
        status: 'failed',
      });
      expect(releasePlatformImageReservation).not.toHaveBeenCalled();
      expect(settlePlatformImageReservation).not.toHaveBeenCalled();
      expect(findGeneration).not.toHaveBeenCalled();
    },
  );

  it('does not deliver a partially settled image set while one provider outcome remains unknown', async () => {
    const update = vi.fn(async () => undefined);
    const findGeneration = vi.fn(async (id) => ({
      asset: { type: 'image', url: `/f/${id}.png` },
      id,
    }));
    const service = new TravelGenerationSettlementService({
      repository: {
        findById: vi.fn(async () =>
          pendingTask({
            artifacts: [
              { asyncTaskId: 'async-1', generationId: 'generation-1', type: 'task' },
              { asyncTaskId: 'async-2', generationId: 'generation-2', type: 'task' },
            ],
          }),
        ),
        update,
      },
      runtime: {
        checkTimeoutTasks: vi.fn(async () => undefined),
        findAsyncTask: vi.fn(async (id) => ({
          metadata: {
            platformAiRuntime: true,
            platformUsageReservation: {
              budgetId: `budget-${id}`,
              leaseVersion: 7,
              reservationId: `reservation-${id}`,
            },
          },
          status: 'success',
        })),
        findGeneration,
        findPlatformImageReservation: vi.fn(async (id) =>
          id === 'reservation-async-1'
            ? platformReservation({
                budgetId: 'budget-async-1',
                id,
                status: 'settled',
              })
            : platformReservation({
                actualUsage: null,
                budgetId: 'budget-async-2',
                generationId: 'generation-2',
                id,
                status: 'provider_started',
              }),
        ),
        releasePlatformImageReservation: vi.fn(),
        settlePlatformImageReservation: vi.fn(),
      },
    } as any);

    await expect(service.reconcile('travel-task-1')).resolves.toMatchObject({ status: 'pending' });
    expect(findGeneration).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('keeps an artifact-persistence-failed document terminal during recovery', async () => {
    const terminal = pendingTask({
      artifacts: undefined,
      code: 'ARTIFACT_PERSISTENCE_FAILED',
      status: 'failed',
      type: 'document',
    });
    const { findGeneration, service, update } = setup(terminal, 'success');

    await expect(service.reconcile(terminal.id)).resolves.toEqual(terminal);
    expect(findGeneration).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
