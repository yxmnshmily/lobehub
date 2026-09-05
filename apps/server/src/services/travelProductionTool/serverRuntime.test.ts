import { beforeEach, describe, expect, it, vi } from 'vitest';

import { grantPlatformManagedExecution } from '@/server/services/aiAgent/platformManagedExecution';
import {
  createHostedTravelCopyGenerationOrchestrator,
  createTravelGenerationOrchestrator,
} from '@/server/services/travelGeneration/production';

import { travelProductionRuntime } from './serverRuntime';

const mocks = vi.hoisted(() => ({
  findAgent: vi.fn(),
  findGroup: vi.fn(),
  getMembers: vi.fn(),
  getSharedBudgetLimit: vi.fn(),
  run: vi.fn(),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(() => ({ findByClientId: mocks.findAgent })),
}));
vi.mock('@/database/models/chatGroup', () => ({
  ChatGroupModel: vi.fn(() => ({
    findByClientId: mocks.findGroup,
    getGroupAgents: mocks.getMembers,
  })),
}));
vi.mock('@/server/services/travelGeneration/production', () => ({
  createHostedTravelCopyGenerationOrchestrator: vi.fn(() => ({ run: mocks.run })),
  createTravelGenerationOrchestrator: vi.fn(() => ({ run: mocks.run })),
}));
vi.mock('@/server/services/platformUsageBilling/sharedBudget', () => ({
  getPlatformUsageSharedBudgetLimit: mocks.getSharedBudgetLimit,
}));

const baseContext = {
  agentId: 'document-agent',
  groupId: 'travel-group',
  operationId: 'travel-operation',
  serverDB: {} as any,
  toolManifestMap: {},
  toolCallId: 'travel-tool-call',
  userId: 'user-1',
};

const sharedBudget = {} as any;
const trustedContext = (overrides: Record<string, unknown> = {}) =>
  grantPlatformManagedExecution(
    { ...baseContext, ...overrides },
    { actorUserId: 'user-1', resourceOwnerUserId: 'user-1', sharedBudget },
  );

describe('travelProductionRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findGroup.mockResolvedValue({ id: 'travel-group', visibility: 'private' });
    mocks.findAgent.mockResolvedValue({ id: 'document-agent' });
    mocks.getMembers.mockResolvedValue([{ agentId: 'document-agent' }]);
    mocks.getSharedBudgetLimit.mockReturnValue(10_000);
    mocks.run.mockResolvedValue({
      artifacts: [{ documentId: 'document-1', name: '西藏3日行程', type: 'document' }],
      id: 'task-document',
      status: 'succeeded',
      type: 'document',
    });
  });

  it('keeps document generation unavailable before constructing an orchestrator', async () => {
    const result = await travelProductionRuntime
      .factory(trustedContext())
      .generateDocument({ prompt: '制作一份西藏3日行程', title: '西藏3日行程' });

    expect(result).toMatchObject({ error: { code: 'CAPABILITY_UNAVAILABLE' }, success: false });
    expect(createTravelGenerationOrchestrator).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('runs copy in the inherited shared budget and returns the persisted text artifact', async () => {
    mocks.findAgent.mockResolvedValue({ id: 'copy-agent' });
    mocks.getMembers.mockResolvedValue([{ agentId: 'copy-agent' }]);
    mocks.run.mockResolvedValue({
      artifacts: [{ content: '西藏旅游文案', type: 'text' }],
      id: 'task-copy',
      status: 'succeeded',
      type: 'copy',
    });

    const runtime = travelProductionRuntime.factory(trustedContext({ agentId: 'copy-agent' }));
    const result = await runtime.generateCopy({ prompt: '写一段西藏旅游文案' });
    const replay = await runtime.generateCopy({ prompt: '写一段西藏旅游文案' });

    expect(result).toMatchObject({
      content: expect.stringContaining('西藏旅游文案'),
      state: {
        travelGeneration: expect.objectContaining({
          artifacts: [{ content: '西藏旅游文案', type: 'text' }],
          status: 'succeeded',
          type: 'copy',
        }),
      },
      success: true,
    });
    expect(replay).toEqual(result);
    expect(createHostedTravelCopyGenerationOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: 'travel-group',
        operationId: 'travel-operation',
        sharedBudget,
        userId: 'user-1',
      }),
    );
    expect(createHostedTravelCopyGenerationOrchestrator).toHaveBeenCalledOnce();
    expect(createTravelGenerationOrchestrator).not.toHaveBeenCalled();
    expect(mocks.run).toHaveBeenCalledOnce();
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ maxCredits: 10_000, type: 'copy' }),
    );
  });

  it('uses the invited member only for sponsored budget binding while persisting owner resources', async () => {
    mocks.findAgent.mockResolvedValue({ id: 'copy-agent' });
    mocks.getMembers.mockResolvedValue([{ agentId: 'copy-agent' }]);
    mocks.run.mockResolvedValue({
      artifacts: [{ content: '西藏旅游文案', type: 'text' }],
      id: 'task-member-copy',
      status: 'succeeded',
      type: 'copy',
    });
    const context = grantPlatformManagedExecution(
      {
        ...baseContext,
        agentId: 'copy-agent',
        operationId: 'mismatched-owner-operation',
        toolCallId: 'mismatched-owner-tool-call',
        userId: 'group-owner',
      },
      {
        actorUserId: 'invited-member',
        resourceOwnerUserId: 'group-owner',
        sharedBudget,
      },
    );

    const result = await travelProductionRuntime.factory(context).generateCopy({
      prompt: '写一段西藏旅游文案',
    });

    expect(result.success).toBe(true);
    expect(mocks.getSharedBudgetLimit).toHaveBeenCalledWith(sharedBudget, {
      actorUserId: 'invited-member',
      workspaceId: undefined,
    });
    expect(createHostedTravelCopyGenerationOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'invited-member',
        groupId: 'travel-group',
        sharedBudget,
        userId: 'group-owner',
      }),
    );
  });

  it('rejects a plain or JSON-forged execution context', async () => {
    const forged = {
      ...baseContext,
      maxCredits: 99_999,
      operationId: 'forged-operation',
      platformManagedExecutionAuthorized: true,
      platformManagedMaxCredits: 99_999,
    };
    const result = await travelProductionRuntime
      .factory(forged as any)
      .generateDocument({ prompt: '生成行程' });

    expect(result).toMatchObject({ error: { code: 'TOOL_FORBIDDEN' }, success: false });
    expect(createTravelGenerationOrchestrator).not.toHaveBeenCalled();
  });

  it('requires a limit even when the server capability is present', async () => {
    const result = await travelProductionRuntime
      .factory(
        grantPlatformManagedExecution(
          { ...baseContext, operationId: 'missing-limit-operation' },
          { actorUserId: 'user-1', resourceOwnerUserId: 'user-1' },
        ),
      )
      .generateDocument({ prompt: '生成行程' });

    expect(result).toMatchObject({
      error: { code: 'GENERATION_LIMIT_REQUIRED' },
      success: false,
    });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('fails closed when the server capability owner does not match the resource context', async () => {
    const context = grantPlatformManagedExecution(
      {
        ...baseContext,
        agentId: 'copy-agent',
        operationId: 'invalid-owner-operation',
        toolCallId: 'invalid-owner-tool-call',
        userId: 'group-owner',
      },
      {
        actorUserId: 'invited-member',
        resourceOwnerUserId: 'different-owner',
        sharedBudget,
      },
    );

    const result = await travelProductionRuntime.factory(context).generateCopy({ prompt: '文案' });

    expect(result).toMatchObject({ error: { code: 'TOOL_FORBIDDEN' }, success: false });
    expect(mocks.getSharedBudgetLimit).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('rejects a model-supplied limit instead of treating it as trusted', async () => {
    const result = await travelProductionRuntime
      .factory(trustedContext())
      .generateDocument({ maxCredits: 1, prompt: '生成行程' } as any);

    expect(result).toMatchObject({ error: { code: 'INVALID_ARGUMENTS' }, success: false });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('keeps image unavailable before creating an orchestrator or calling a provider', async () => {
    mocks.findAgent.mockResolvedValue({ id: 'image-agent' });
    mocks.getMembers.mockResolvedValue([{ agentId: 'image-agent' }]);
    const result = await travelProductionRuntime
      .factory(trustedContext({ agentId: 'image-agent' }))
      .generateImage({ imageNum: 1, prompt: '西藏旅游封面' });

    expect(result).toMatchObject({ error: { code: 'CAPABILITY_UNAVAILABLE' }, success: false });
    expect(createTravelGenerationOrchestrator).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('keeps video unavailable before creating an orchestrator or calling a provider', async () => {
    mocks.findAgent.mockResolvedValue({ id: 'video-agent' });
    mocks.getMembers.mockResolvedValue([{ agentId: 'video-agent' }]);
    const result = await travelProductionRuntime
      .factory(trustedContext({ agentId: 'video-agent' }))
      .generateVideo({ prompt: '桂林航拍' });

    expect(result).toMatchObject({ error: { code: 'CAPABILITY_UNAVAILABLE' }, success: false });
    expect(createTravelGenerationOrchestrator).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('rejects caller-controlled ownership fields', async () => {
    const result = await travelProductionRuntime
      .factory(trustedContext())
      .generateDocument({ prompt: '生成行程', userId: 'other-user' } as any);

    expect(result).toMatchObject({ error: { code: 'INVALID_ARGUMENTS' }, success: false });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('does not expose a configured provider failure while document generation is unavailable', async () => {
    mocks.run.mockResolvedValue({
      code: 'GENERATION_FAILED',
      id: 'task-document-failed',
      message: 'internal provider detail',
      status: 'failed',
      type: 'document',
    });
    const result = await travelProductionRuntime
      .factory(trustedContext({ operationId: 'failed-operation' }))
      .generateDocument({ prompt: '生成行程' });

    expect(result).toMatchObject({ error: { code: 'CAPABILITY_UNAVAILABLE' }, success: false });
    expect(mocks.run).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('internal provider detail');
  });
});
