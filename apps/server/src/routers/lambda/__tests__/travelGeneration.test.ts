import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TravelGenerationIdempotencyConflictError } from '@/server/services/travelGeneration';
import { createTravelGenerationOrchestrator } from '@/server/services/travelGeneration/production';

import { travelGenerationRouter } from '../travelGeneration';

const { reconcile, run } = vi.hoisted(() => ({ reconcile: vi.fn(), run: vi.fn() }));

vi.mock('@/server/services/travelGeneration/production', () => ({
  createTravelGenerationOrchestrator: vi.fn(() => ({ run })),
  createTravelGenerationSettlementService: vi.fn(() => ({ reconcile })),
}));

describe('travelGenerationRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    run.mockResolvedValue({ id: 'task-1', status: 'pending' });
    reconcile.mockResolvedValue({ id: 'task-1', status: 'pending' });
  });

  it('reconciles and returns an authenticated customer task', async () => {
    const caller = travelGenerationRouter.createCaller({
      serverDB: {} as any,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as any);

    await expect(caller.get({ taskId: 'task-1' })).resolves.toMatchObject({
      id: 'task-1',
      status: 'pending',
    });
    expect(reconcile).toHaveBeenCalledWith('task-1');
  });

  it('does not reveal a generation task hidden by owner scoping', async () => {
    reconcile.mockResolvedValueOnce(null);
    const caller = travelGenerationRouter.createCaller({
      serverDB: {} as any,
      userId: 'user-2',
    } as any);

    await expect(caller.get({ taskId: 'task-1' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects direct image creation before constructing the production orchestrator', async () => {
    const caller = travelGenerationRouter.createCaller({
      serverDB: {} as any,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as any);

    await expect(
      caller.create({
        groupId: 'group-1',
        input: { prompt: '桂林旅游封面' },
        maxCredits: 120,
        orderId: '00000000-0000-4000-8000-000000000002',
        type: 'image',
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(createTravelGenerationOrchestrator).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('derives deterministic order idempotency while isolating user, group, and type', async () => {
    const orderId = '00000000-0000-4000-8000-000000000003';
    const input = {
      groupId: 'group-1',
      input: { prompt: '桂林旅游文案' },
      maxCredits: 80,
      orderId,
      type: 'copy',
    } as const;
    const callerA = travelGenerationRouter.createCaller({
      serverDB: {} as any,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as any);

    await callerA.create(input);
    await callerA.create(input);
    await travelGenerationRouter
      .createCaller({ serverDB: {} as any, userId: 'user-2', workspaceId: 'workspace-1' } as any)
      .create(input);
    await callerA.create({ ...input, groupId: 'group-2' });
    await callerA.create({
      ...input,
      input: { prompt: '桂林旅游行程', title: '行程单' },
      type: 'document',
    });

    const keys = vi.mocked(createTravelGenerationOrchestrator).mock.calls.map(([params]) => {
      expect(params.idempotency).toBeDefined();
      return params.idempotency?.key;
    });
    expect(keys[1]).toBe(keys[0]);
    expect(new Set([keys[0], keys[2], keys[3], keys[4]]).size).toBe(4);
  });

  it('requires an existing service order for billed copy generation', async () => {
    const caller = travelGenerationRouter.createCaller({
      serverDB: {} as any,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as any);

    await caller.create({
      groupId: 'group-1',
      input: { prompt: '桂林旅游文案' },
      maxCredits: 80,
      orderId: '00000000-0000-4000-8000-000000000001',
      type: 'copy',
    });

    expect(run).toHaveBeenCalledWith({
      input: { prompt: '桂林旅游文案' },
      maxCredits: 80,
      orderId: '00000000-0000-4000-8000-000000000001',
      owner: { groupId: 'group-1', userId: 'user-1', workspaceId: 'workspace-1' },
      type: 'copy',
    });
  });

  it('maps order content conflicts to a stable safe response', async () => {
    run.mockRejectedValueOnce(
      new TravelGenerationIdempotencyConflictError('secret request hash mismatch'),
    );
    const caller = travelGenerationRouter.createCaller({
      serverDB: {} as any,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as any);

    const error = await caller
      .create({
        groupId: 'group-1',
        input: { prompt: '不同内容' },
        maxCredits: 80,
        orderId: '00000000-0000-4000-8000-000000000005',
        type: 'copy',
      })
      .catch((cause) => cause);

    expect(error).toMatchObject({ code: 'CONFLICT' });
    expect(JSON.stringify(error)).not.toMatch(/secret|hash mismatch/);
  });

  it.each([
    { input: { prompt: '旅游文案' }, type: 'copy' },
    { input: { prompt: '旅游行程', title: '行程单' }, type: 'document' },
    { input: { prompt: '旅游封面' }, type: 'image' },
  ] as const)(
    'requires an explicit maxCredits admission cap for $type generation',
    async ({ input, type }) => {
      const caller = travelGenerationRouter.createCaller({
        serverDB: {} as any,
        userId: 'user-1',
        workspaceId: 'workspace-1',
      } as any);

      await expect(
        caller.create({
          groupId: 'group-1',
          input,
          orderId: '00000000-0000-4000-8000-000000000007',
          type,
        } as any),
      ).rejects.toBeDefined();
      expect(run).not.toHaveBeenCalled();
    },
  );

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY])(
    'rejects invalid maxCredits %s before generation starts',
    async (maxCredits) => {
      const caller = travelGenerationRouter.createCaller({
        serverDB: {} as any,
        userId: 'user-1',
        workspaceId: 'workspace-1',
      } as any);

      await expect(
        caller.create({
          groupId: 'group-1',
          input: { prompt: '旅游文案' },
          maxCredits,
          orderId: '00000000-0000-4000-8000-000000000008',
          type: 'copy',
        }),
      ).rejects.toBeDefined();
      expect(run).not.toHaveBeenCalled();
    },
  );

  it('keeps maxCredits out of provider input and the public response', async () => {
    run.mockResolvedValueOnce({
      id: 'task-1',
      input: { prompt: '桂林旅游文案' },
      maxCredits: 80,
      owner: { groupId: 'group-1', userId: 'user-1', workspaceId: 'workspace-1' },
      status: 'pending',
      type: 'copy',
    });
    const caller = travelGenerationRouter.createCaller({
      serverDB: {} as any,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as any);

    const result = await caller.create({
      groupId: 'group-1',
      input: { prompt: '桂林旅游文案' },
      maxCredits: 80,
      orderId: '00000000-0000-4000-8000-000000000009',
      type: 'copy',
    });

    expect(run).toHaveBeenCalledWith({
      input: { prompt: '桂林旅游文案' },
      maxCredits: 80,
      orderId: '00000000-0000-4000-8000-000000000009',
      owner: { groupId: 'group-1', userId: 'user-1', workspaceId: 'workspace-1' },
      type: 'copy',
    });
    expect(run.mock.calls[0]?.[0].input).not.toHaveProperty('maxCredits');
    expect(result).not.toHaveProperty('maxCredits');
  });

  it.each([
    {
      groupId: 'group-1',
      input: { model: 'attacker-model', prompt: 'copy', provider: 'attacker-provider' },
      maxCredits: 80,
      type: 'copy',
    },
    { groupId: 'group-1', input: { prompt: '未绑定订单的文案' }, type: 'copy' },
    { groupId: 'group-1', input: { prompt: '未绑定订单的图片' }, type: 'image' },
    { groupId: 'group-1', input: { prompt: '未绑定订单的视频' }, type: 'video' },
    {
      groupId: 'group-1',
      idempotencyKey: 'attacker-key',
      input: { prompt: '伪造幂等键' },
      maxCredits: 80,
      orderId: '00000000-0000-4000-8000-000000000004',
      requestHash: 'attacker-hash',
      type: 'copy',
    },
    {
      groupId: 'group-1',
      input: { imageNum: 2, prompt: '不应拆成多个结算的图片' },
      maxCredits: 80,
      orderId: '00000000-0000-4000-8000-000000000006',
      type: 'image',
    },
    {
      groupId: 'group-1',
      input: { prompt: 'x'.repeat(12_001) },
      maxCredits: 80,
      type: 'copy',
    },
    {
      groupId: 'group-1',
      input: { content: 'body', title: 'x'.repeat(121) },
      maxCredits: 80,
      type: 'document',
    },
  ])('rejects unbounded or model-overriding generation input', async (input) => {
    const caller = travelGenerationRouter.createCaller({
      serverDB: {} as any,
      userId: 'user-1',
    } as any);

    await expect(caller.create(input as any)).rejects.toBeDefined();
    expect(run).not.toHaveBeenCalled();
  });
});
