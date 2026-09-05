// @vitest-environment node
import {
  PlatformCreditAdminModel,
  PlatformCreditModel,
  TravelGenerationTaskModel,
  TravelServiceLedgerModel,
} from '@lobechat/database';
import {
  asyncTasks,
  chatGroups,
  platformCreditAccounts,
  platformCreditBudgets,
  platformCreditEntries,
  platformCreditReservations,
  travelGenerationTasks,
  users,
  workspaces,
} from '@lobechat/database/schemas';
import { AsyncTaskStatus, AsyncTaskType } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { PlatformUsageReservationService } from '@/server/services/platformUsageBilling/reservation';

import { deriveTravelOrderIdempotency } from './idempotency';
import {
  type TravelGenerationAdapter,
  TravelGenerationIdempotencyConflictError,
  TravelGenerationOrchestrator,
} from './index';
import {
  __INTERNAL_createTravelGenerationBillingOrchestrator as createTravelGenerationOrchestrator,
  createTravelGenerationRepository,
} from './production';

const db = await getTestDB();
const adminId = 'travel-billing-integration-admin';
const userA = 'travel-billing-integration-a';
const userB = 'travel-billing-integration-b';
const groupA = 'travel-billing-integration-group-a';
const groupB = 'travel-billing-integration-group-b';
const groupWorkspaceA = 'travel-billing-integration-workspace-group-a';
const groupWorkspaceB = 'travel-billing-integration-workspace-group-b';

const documentUsage = {
  cost: 0.0006,
  totalInputTokens: 100,
  totalOutputTokens: 50,
  totalTokens: 150,
};
const imageUsage = {
  cost: 0.00125,
  inputTextTokens: 80,
  outputImageTokens: 920,
  totalTokens: 1000,
};

type ProviderResult = {
  asyncTaskId?: string;
  content?: string;
  generationId?: string;
  usage?: typeof documentUsage | typeof imageUsage;
};

const providerFor = (type: 'document' | 'image', result?: ProviderResult) =>
  vi.fn(async () => {
    if (result) return result;
    return type === 'document'
      ? { content: '桂林三日行程', usage: documentUsage }
      : {
          asyncTaskId: 'image-task-1',
          generationId: 'image-generation-1',
          usage: imageUsage,
        };
  });

const imageAdapterFor = (
  userId: string,
  provider: ReturnType<typeof providerFor>,
): TravelGenerationAdapter => ({
  execute: async (request) => {
    const reservations = new PlatformUsageReservationService(db, userId);
    const limit = { maxCredits: request.maxCredits as number, source: 'user-explicit' as const };
    const expiresAt = new Date(Date.now() + 60_000);
    const budget = await reservations.reserveRequest({
      expiresAt,
      idempotencyKey: `integration-image:${request.taskId}:request`,
      limit,
      sourceId: request.taskId,
      sourceType: 'travel-generation-image',
      workspaceId: request.owner.workspaceId,
    });
    const reservation = await reservations.reserveCall({
      budgetId: budget.id,
      callKind: 'image',
      expiresAt,
      generationId: `travel-generation:${request.taskId}:image`,
      generationType: 'platform-image-generation',
      idempotencyKey: `integration-image:${request.taskId}:call`,
      limit,
      model: 'priced-image-model',
      provider: 'priced-provider',
      workspaceId: request.owner.workspaceId,
    });
    let providerClaimAttempted = false;
    try {
      providerClaimAttempted = true;
      const claim = await reservations.claim({
        leaseVersion: reservation.leaseVersion,
        reservationId: reservation.id,
      });
      if (!claim.shouldCallProvider) throw new Error('provider call already claimed');
      const result = await provider();
      const settlementInput = {
        completeRequest: true,
        leaseVersion: claim.reservation.leaseVersion,
        reservationId: reservation.id,
        ...(result.usage === undefined ? {} : { usage: result.usage }),
      } as const;
      try {
        await reservations.completeAndSettle(settlementInput);
      } catch {
        await reservations.completeAndSettle(settlementInput);
      }
      return {
        artifacts: [
          {
            generationId: result.generationId,
            type: 'image',
            url: `/f/${result.generationId}`,
          },
        ],
        provider: 'priced-provider',
        usage: result.usage,
      };
    } catch (error) {
      if (!providerClaimAttempted) {
        await reservations.releaseUnclaimed({
          completeRequest: true,
          leaseVersion: reservation.leaseVersion,
          reservationId: reservation.id,
        });
      }
      throw error;
    }
  },
  type: 'image',
});

const orchestratorFor = (params: {
  createDocumentPage?: ReturnType<typeof vi.fn>;
  groupId: string;
  key: string;
  provider: ReturnType<typeof providerFor>;
  requestHash: string;
  type: 'document' | 'image';
  userId: string;
  workspaceId?: string;
}) => {
  if (params.type === 'document') {
    return createTravelGenerationOrchestrator(
      {
        db,
        groupId: params.groupId,
        idempotency: { key: params.key, requestHash: params.requestHash },
        userId: params.userId,
        workspaceId: params.workspaceId,
      },
      {
        createDocumentPage:
          params.createDocumentPage ?? vi.fn(async () => ({ id: `document-${params.key}` })),
        initTextRuntime: async () => ({
          generateObject: async (_payload, options) => {
            const result = await params.provider();
            if (result.usage) await options?.onUsage?.(result.usage);
            return { content: result.content };
          },
        }),
        resolveModelConfig: async () => ({
          model: 'priced-document-model',
          provider: 'priced-provider',
        }),
      },
    );
  }
  return new TravelGenerationOrchestrator({
    adapters: [imageAdapterFor(params.userId, params.provider)],
    repository: createTravelGenerationRepository({
      db,
      groupId: params.groupId,
      idempotency: { key: params.key, requestHash: params.requestHash },
      userId: params.userId,
    }),
  });
};

const requestFor = (
  type: 'document' | 'image',
  userId = userA,
  groupId = groupA,
  workspaceId?: string,
) => ({
  input:
    type === 'document'
      ? { prompt: '生成桂林三日行程', title: '桂林三日行程' }
      : { imageNum: 1, prompt: '桂林山水封面' },
  maxCredits: type === 'document' ? 1000 : 2000,
  owner: { groupId, userId, workspaceId },
  type,
});

const usageEntries = async (userId: string) =>
  (await new PlatformCreditModel(db, userId).listEntries()).filter(
    (entry) => entry.type === 'usage_charge',
  );

const tasksFor = (userId: string) =>
  db.select().from(travelGenerationTasks).where(eq(travelGenerationTasks.userId, userId));

const cleanup = async () => {
  const userIds = [userA, userB];
  await db
    .delete(platformCreditBudgets)
    .where(inArray(platformCreditBudgets.userIdSnapshot, userIds));
  await db
    .delete(platformCreditEntries)
    .where(inArray(platformCreditEntries.userIdSnapshot, userIds));
  await db
    .delete(platformCreditAccounts)
    .where(inArray(platformCreditAccounts.userIdSnapshot, userIds));
  await db.delete(users).where(eq(users.id, userA));
  await db.delete(users).where(eq(users.id, userB));
  await db.delete(users).where(eq(users.id, adminId));
};

beforeEach(async () => {
  await cleanup();
  await db.insert(users).values([{ id: adminId }, { id: userA }, { id: userB }]);
  await db.insert(workspaces).values([
    { id: 'workspace-a', name: 'Workspace A', primaryOwnerId: userA, slug: 'workspace-a' },
    { id: 'workspace-b', name: 'Workspace B', primaryOwnerId: userA, slug: 'workspace-b' },
  ]);
  await db.insert(chatGroups).values([
    { id: groupA, userId: userA, visibility: 'private' },
    { id: groupB, userId: userB, visibility: 'private' },
    {
      id: groupWorkspaceA,
      userId: userA,
      visibility: 'private',
      workspaceId: 'workspace-a',
    },
    {
      id: groupWorkspaceB,
      userId: userA,
      visibility: 'private',
      workspaceId: 'workspace-b',
    },
  ]);
  const credits = new PlatformCreditAdminModel(db, adminId);
  await credits.topUp({
    credits: 5_000_000,
    idempotencyKey: 'integration-top-up-a',
    reason: '集成测试充值',
    targetUserId: userA,
  });
  await credits.topUp({
    credits: 5_000_000,
    idempotencyKey: 'integration-top-up-b',
    reason: '集成测试充值',
    targetUserId: userB,
  });
});

afterEach(cleanup);

describe('travel generation billing database integration', () => {
  it('atomically claims one image async operation across concurrent deliveries', async () => {
    const model = new AsyncTaskModel(db, userA);
    const taskId = await model.create({
      metadata: { platformAiRuntime: true },
      status: AsyncTaskStatus.Pending,
      type: AsyncTaskType.ImageGeneration,
    });

    const claims = await Promise.all([
      model.transitionStatus(taskId, [AsyncTaskStatus.Pending], AsyncTaskStatus.Processing),
      model.transitionStatus(taskId, [AsyncTaskStatus.Pending], AsyncTaskStatus.Processing),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    await expect(db.select().from(asyncTasks).where(eq(asyncTasks.id, taskId))).resolves.toEqual([
      expect.objectContaining({ status: AsyncTaskStatus.Processing }),
    ]);
  });

  it.each([
    [
      'document',
      -600,
      4_999_400,
      0.0006,
      documentUsage,
      { totalInputTokens: 100, totalOutputTokens: 50, totalTokens: 150 },
    ],
    [
      'image',
      -1250,
      4_998_750,
      0.00125,
      imageUsage,
      { inputTextTokens: 80, outputImageTokens: 920, totalTokens: 1000 },
    ],
  ] as const)(
    'persists one successful %s task, one artifact set, and one authoritative usage charge',
    async (type, amountCredits, balanceCredits, costUsd, usage, tokenUsage) => {
      const provider = providerFor(type);
      const task = await orchestratorFor({
        groupId: groupA,
        key: `successful-${type}`,
        provider,
        requestHash: `successful-${type}-hash`,
        type,
        userId: userA,
      }).run(requestFor(type));

      expect(task.status).toBe('succeeded');
      expect(task.artifacts).toHaveLength(1);
      const rows = await tasksFor(userA);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ artifacts: task.artifacts, status: 'succeeded', usage });
      const entries = await usageEntries(userA);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        amountCredits,
        costUsd,
        model: type === 'document' ? 'priced-document-model' : 'priced-image-model',
        provider: 'priced-provider',
        tokenUsage,
      });
      await expect(new PlatformCreditModel(db, userA).getAccount()).resolves.toMatchObject({
        balanceCredits,
      });
      await expect(new TravelServiceLedgerModel(db, userA).listEntries()).resolves.toEqual([]);
      await expect(new TravelServiceLedgerModel(db, userA).listOrders()).resolves.toEqual([]);
    },
  );

  it.each(['document', 'image'] as const)(
    'coalesces concurrent duplicate %s requests into one task, artifact set, and charge',
    async (type) => {
      const provider = providerFor(type);
      const order = await new TravelServiceLedgerModel(db, userA).createOrder({
        amountFen: 1,
        idempotencyKey: `integration-order-${type}`,
        title: '仅用于生成归属绑定的测试订单',
      });
      const orderId = order.id;
      const request = { ...requestFor(type), orderId };
      const idempotency = deriveTravelOrderIdempotency({
        input: request.input,
        maxCredits: request.maxCredits,
        orderId,
        owner: request.owner,
        type,
      });
      const params = {
        groupId: groupA,
        key: idempotency.key,
        provider,
        requestHash: idempotency.requestHash,
        type,
        userId: userA,
      };

      await Promise.all([
        orchestratorFor(params).run(request),
        orchestratorFor(params).run(request),
      ]);

      const rows = await tasksFor(userA);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.orderId).toBe(orderId);
      expect(rows[0]?.artifacts).toHaveLength(1);
      expect(await usageEntries(userA)).toHaveLength(1);
      expect(provider).toHaveBeenCalledOnce();
      await expect(new PlatformCreditModel(db, userA).getAccount()).resolves.toMatchObject({
        balanceCredits: type === 'document' ? 4_999_400 : 4_998_750,
      });
    },
  );

  it('rejects different content under the same order identity without a second provider or charge', async () => {
    const order = await new TravelServiceLedgerModel(db, userA).createOrder({
      amountFen: 1,
      idempotencyKey: 'integration-order-content-conflict',
      title: '仅用于生成归属绑定的测试订单',
    });
    const orderId = order.id;
    const firstProvider = providerFor('document');
    const secondProvider = providerFor('document');
    const firstRequest = { ...requestFor('document'), orderId };
    const secondRequest = {
      ...firstRequest,
      input: { prompt: '不同的行程内容', title: '不同标题' },
    };
    const firstIdempotency = deriveTravelOrderIdempotency({
      input: firstRequest.input,
      maxCredits: firstRequest.maxCredits,
      orderId,
      owner: firstRequest.owner,
      type: 'document',
    });
    const secondIdempotency = deriveTravelOrderIdempotency({
      input: secondRequest.input,
      maxCredits: secondRequest.maxCredits,
      orderId,
      owner: secondRequest.owner,
      type: 'document',
    });

    await orchestratorFor({
      groupId: groupA,
      key: firstIdempotency.key,
      provider: firstProvider,
      requestHash: firstIdempotency.requestHash,
      type: 'document',
      userId: userA,
    }).run(firstRequest);
    await expect(
      orchestratorFor({
        groupId: groupA,
        key: secondIdempotency.key,
        provider: secondProvider,
        requestHash: secondIdempotency.requestHash,
        type: 'document',
        userId: userA,
      }).run(secondRequest),
    ).rejects.toBeInstanceOf(TravelGenerationIdempotencyConflictError);

    expect(await tasksFor(userA)).toHaveLength(1);
    expect(await usageEntries(userA)).toHaveLength(1);
    expect(firstProvider).toHaveBeenCalledOnce();
    expect(secondProvider).not.toHaveBeenCalled();
  });

  it.each([
    ['document', 'provider failure'],
    ['image', 'provider failure'],
    ['document', 'missing usage'],
    ['image', 'missing usage'],
  ] as const)('fails %s closed on %s with no charge or artifact', async (type, failure) => {
    const provider =
      failure === 'provider failure'
        ? vi.fn(async () => {
            throw new Error('external provider failed');
          })
        : providerFor(type, {
            ...(type === 'document'
              ? { content: '无用量文档' }
              : { asyncTaskId: 'missing-usage-task', generationId: 'missing-usage-image' }),
          });

    const task = await orchestratorFor({
      groupId: groupA,
      key: `${failure}-${type}`,
      provider,
      requestHash: `${failure}-${type}-hash`,
      type,
      userId: userA,
    }).run(requestFor(type));

    expect(task.status).toBe('failed');
    expect(task.artifacts).toBeUndefined();
    expect(await usageEntries(userA)).toEqual([]);
    expect((await tasksFor(userA))[0]?.artifacts).toBeNull();
    await expect(new PlatformCreditModel(db, userA).getAccount()).resolves.toMatchObject({
      balanceCredits: 5_000_000,
    });
    if (failure === 'missing usage') {
      await expect(
        db
          .select({
            settledCredits: platformCreditReservations.settledCredits,
            status: platformCreditReservations.status,
          })
          .from(platformCreditReservations),
      ).resolves.toEqual([{ settledCredits: 0, status: 'provider_started' }]);
    }
  });

  it('keeps unavailable video as an uncharged task with no fabricated artifact', async () => {
    const orchestrator = new TravelGenerationOrchestrator({
      adapters: [],
      repository: createTravelGenerationRepository({
        db,
        groupId: groupA,
        idempotency: { key: 'video-unavailable', requestHash: 'video-unavailable-hash' },
        userId: userA,
      }),
    });

    const task = await orchestrator.run({
      input: { prompt: '生成桂林视频' },
      owner: { groupId: groupA, userId: userA },
      type: 'video',
    });

    expect(task).toMatchObject({ artifacts: undefined, status: 'unavailable' });
    expect(await usageEntries(userA)).toEqual([]);
    expect((await tasksFor(userA))[0]?.artifacts).toBeNull();
    await expect(new PlatformCreditModel(db, userA).getAccount()).resolves.toMatchObject({
      balanceCredits: 5_000_000,
    });
  });

  it('isolates identical idempotency material, tasks, and charges between users', async () => {
    const providerA = providerFor('document');
    const providerB = providerFor('document');
    const common = {
      key: 'cross-user-key',
      requestHash: 'cross-user-request-hash',
      type: 'document' as const,
    };

    const [taskA, taskB] = await Promise.all([
      orchestratorFor({ ...common, groupId: groupA, provider: providerA, userId: userA }).run(
        requestFor('document', userA, groupA),
      ),
      orchestratorFor({ ...common, groupId: groupB, provider: providerB, userId: userB }).run(
        requestFor('document', userB, groupB),
      ),
    ]);

    expect(taskA.id).not.toBe(taskB.id);
    expect(await tasksFor(userA)).toHaveLength(1);
    expect(await tasksFor(userB)).toHaveLength(1);
    expect(await usageEntries(userA)).toHaveLength(1);
    expect(await usageEntries(userB)).toHaveLength(1);
    await expect(new PlatformCreditModel(db, userA).getAccount()).resolves.toMatchObject({
      balanceCredits: 4_999_400,
    });
    await expect(new PlatformCreditModel(db, userB).getAccount()).resolves.toMatchObject({
      balanceCredits: 4_999_400,
    });
    await expect(
      new TravelGenerationTaskModel(db, userA).findById(taskB.id),
    ).resolves.toBeUndefined();
    await expect(
      new TravelGenerationTaskModel(db, userB).findById(taskA.id),
    ).resolves.toBeUndefined();
  });

  it('isolates identical document idempotency material between workspaces for one user', async () => {
    const providerA = providerFor('document');
    const providerB = providerFor('document');
    const common = {
      key: 'same-user-cross-workspace-key',
      requestHash: 'same-user-cross-workspace-hash',
      type: 'document' as const,
      userId: userA,
    };

    const [taskA, taskB] = await Promise.all([
      orchestratorFor({
        ...common,
        groupId: groupWorkspaceA,
        provider: providerA,
        workspaceId: 'workspace-a',
      }).run(requestFor('document', userA, groupWorkspaceA, 'workspace-a')),
      orchestratorFor({
        ...common,
        groupId: groupWorkspaceB,
        provider: providerB,
        workspaceId: 'workspace-b',
      }).run(requestFor('document', userA, groupWorkspaceB, 'workspace-b')),
    ]);

    expect(taskA.id).not.toBe(taskB.id);
    expect(taskA.status).toBe('succeeded');
    expect(taskB.status).toBe('succeeded');
    expect(providerA).toHaveBeenCalledOnce();
    expect(providerB).toHaveBeenCalledOnce();
    expect(await usageEntries(userA)).toHaveLength(2);
    await expect(new PlatformCreditModel(db, userA).getAccount()).resolves.toMatchObject({
      balanceCredits: 4_998_800,
    });
    const workspaces = (
      await db
        .select({ workspaceId: platformCreditReservations.workspaceId })
        .from(platformCreditReservations)
    )
      .map(({ workspaceId }) => workspaceId)
      .sort();
    expect(workspaces).toEqual(['workspace-a', 'workspace-b']);
    await expect(
      new TravelGenerationTaskModel(db, userA, 'workspace-a').findById(taskB.id),
    ).resolves.toBeUndefined();
    await expect(
      new TravelGenerationTaskModel(db, userA, 'workspace-b').findById(taskA.id),
    ).resolves.toBeUndefined();
  });

  it('keeps one paid charge and a replayable terminal lookup when document persistence fails', async () => {
    const provider = providerFor('document');
    const createDocumentPage = vi.fn(async () => {
      throw new Error('private database failure at /secret/path document-id=123');
    });
    const order = await new TravelServiceLedgerModel(db, userA).createOrder({
      amountFen: 1,
      idempotencyKey: 'document-persistence-failure-order',
      title: '文档保存失败归属订单',
    });
    const request = {
      ...requestFor('document', userA, groupWorkspaceA, 'workspace-a'),
      orderId: order.id,
    };
    const idempotency = deriveTravelOrderIdempotency({
      input: request.input,
      maxCredits: request.maxCredits,
      orderId: order.id,
      owner: request.owner,
      type: 'document',
    });
    const params = {
      createDocumentPage,
      groupId: groupWorkspaceA,
      key: idempotency.key,
      provider,
      requestHash: idempotency.requestHash,
      type: 'document' as const,
      userId: userA,
      workspaceId: 'workspace-a',
    };

    const first = await orchestratorFor(params).run(request);
    const replay = await orchestratorFor(params).run(request);

    expect(first).toMatchObject({
      code: 'ARTIFACT_PERSISTENCE_FAILED',
      message: '内容已生成并计费，但作品保存失败。请稍后重试查询或联系人工处理。',
      status: 'failed',
    });
    expect(replay).toMatchObject({
      code: 'ARTIFACT_PERSISTENCE_FAILED',
      id: first.id,
      message: '内容已生成并计费，但作品保存失败。请稍后重试查询或联系人工处理。',
      status: 'failed',
    });
    expect(JSON.stringify([first, replay])).not.toMatch(/private|database|secret|path|123/);
    expect(provider).toHaveBeenCalledOnce();
    expect(createDocumentPage).toHaveBeenCalledOnce();
    expect(await usageEntries(userA)).toHaveLength(1);
    await expect(new PlatformCreditModel(db, userA).getAccount()).resolves.toMatchObject({
      balanceCredits: 4_999_400,
    });
  });

  it('rejects a document without maxCredits before provider or artifact persistence', async () => {
    const provider = providerFor('document');
    const createDocumentPage = vi.fn(async () => ({ id: 'must-not-be-created' }));
    const { maxCredits: _omitted, ...request } = requestFor('document');
    const task = await orchestratorFor({
      createDocumentPage,
      groupId: groupA,
      key: 'document-missing-max-credits',
      provider,
      requestHash: 'document-missing-max-credits-hash',
      type: 'document',
      userId: userA,
    }).run(request);

    expect(task).toMatchObject({ code: 'GENERATION_FAILED', status: 'failed' });
    expect(provider).not.toHaveBeenCalled();
    expect(createDocumentPage).not.toHaveBeenCalled();
    expect(await usageEntries(userA)).toEqual([]);
    await expect(db.select().from(platformCreditBudgets)).resolves.toEqual([]);
    await expect(db.select().from(platformCreditReservations)).resolves.toEqual([]);
  });

  it.each(['document', 'image'] as const)(
    'keeps an over-limit %s provider completion without debiting or delivering',
    async (type) => {
      const provider = providerFor(type);
      const request = { ...requestFor(type), maxCredits: 500 };
      const task = await orchestratorFor({
        groupId: groupA,
        key: `${type}-over-reservation`,
        provider,
        requestHash: `${type}-over-reservation-hash`,
        type,
        userId: userA,
      }).run(request);

      expect(task.status).toBe('failed');
      expect(task.artifacts).toBeUndefined();
      expect(provider).toHaveBeenCalledOnce();
      expect(await usageEntries(userA)).toEqual([]);
      await expect(new PlatformCreditModel(db, userA).getAccount()).resolves.toMatchObject({
        balanceCredits: 5_000_000,
      });
      await expect(
        db
          .select({
            settledCredits: platformCreditReservations.settledCredits,
            status: platformCreditReservations.status,
          })
          .from(platformCreditReservations),
      ).resolves.toEqual([{ settledCredits: 0, status: 'provider_completed' }]);
      await expect(
        db.select({ status: platformCreditBudgets.status }).from(platformCreditBudgets),
      ).resolves.toEqual([{ status: 'active' }]);
    },
  );
});
