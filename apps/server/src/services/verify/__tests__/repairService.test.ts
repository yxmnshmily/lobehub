// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRepairRunner, maybeAutoRepair, VerifyRepairService } from '../repairService';

const { attachPolicyRun, confirmPlan, ensureForOperation, execAgent, findById, findByOperation } =
  vi.hoisted(() => ({
    attachPolicyRun: vi.fn(),
    confirmPlan: vi.fn(),
    ensureForOperation: vi.fn(),
    execAgent: vi.fn(),
    findById: vi.fn(),
    findByOperation: vi.fn(),
  }));

const taskFindById = vi.hoisted(() => vi.fn());
const listByRun = vi.hoisted(() => vi.fn());
vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(function () {
    return { findById: taskFindById };
  }),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(function () {
    return { listByRun };
  }),
}));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn(function () {
    return { execAgent };
  }),
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(function () {
    return { findById };
  }),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return { confirmPlan, ensureForOperation, findByOperation };
  }),
}));
vi.mock('../acceptanceService', () => ({
  AcceptanceService: vi.fn(function () {
    return { attachPolicyRun };
  }),
}));

describe('createRepairRunner', () => {
  beforeEach(() => {
    taskFindById.mockReset().mockResolvedValue({ status: 'running', context: {} });
    execAgent.mockReset().mockResolvedValue({ operationId: 'repair-op' });
    findById.mockReset().mockResolvedValue({ parentOperationId: null });
    findByOperation.mockReset().mockResolvedValue(null);
  });

  it('drives the repair turn with the failure feedback as its own user message', async () => {
    const runner = createRepairRunner({
      agentId: 'builder-agent',
      db: {} as any,
      maxRepairRounds: 3,
      taskId: 'task-1',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const instruction =
      'The delivery checker found unresolved issues with the previous result. Fix only these, then stop:\n1. 审阅证据链完整可核对 — no evidence attached';

    const result = await runner!({
      failedItemIds: ['criterion-1'],
      instruction,
      operationId: 'op-1',
      verifyMessageId: 'verify-msg-1',
    });

    expect(result).toEqual({ repairOperationId: 'repair-op' });
    // The turn runs off history (`suppressUserMessage`), so without
    // `ephemeralUserMessage` the context ends on the agent's own assistant
    // output: the brief never reaches the model, and Ark rejects the request
    // with `MissingParameter: partial`.
    expect(execAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        ephemeralUserMessage: instruction,
        parentMessageId: 'verify-msg-1',
        parentOperationId: 'op-1',
        prompt: instruction,
        suppressUserMessage: true,
      }),
    );
  });

  it.each([
    { status: 'paused' },
    { status: 'canceled' },
    { status: 'running', context: { manualControl: 'stopping' } },
    { status: 'running', context: { manualStopAt: '2026-09-13T02:00:00Z' } },
  ])('does not spawn a repair after a stop: %j', async (task) => {
    taskFindById.mockResolvedValue(task);
    findById.mockResolvedValue({ createdAt: new Date('2026-09-13T01:00:00Z') });
    const runner = createRepairRunner({
      agentId: 'agent',
      db: {} as any,
      maxRepairRounds: 3,
      taskId: 'task',
      topicId: 'topic',
      userId: 'user',
    });
    expect(await runner!({ failedItemIds: [], instruction: 'fix', operationId: 'op' })).toBeNull();
    expect(execAgent).not.toHaveBeenCalled();
  });

  it('keeps the original task epoch when a newer verifier child arrives after resume', async () => {
    taskFindById.mockResolvedValue({
      status: 'running',
      context: { manualStopAt: '2026-09-13T02:00:00Z' },
    });
    findById.mockImplementation(async (id) =>
      id === 'child'
        ? { parentOperationId: 'parent', createdAt: new Date('2026-09-13T03:00:00Z') }
        : { taskId: 'task', createdAt: new Date('2026-09-13T01:00:00Z') },
    );
    const runner = createRepairRunner({
      agentId: 'agent',
      db: {} as any,
      maxRepairRounds: 3,
      taskId: 'task',
      topicId: 'topic',
      userId: 'user',
    });
    expect(
      await runner!({ failedItemIds: [], instruction: 'fix', operationId: 'child' }),
    ).toBeNull();
    expect(execAgent).not.toHaveBeenCalled();
  });

  it('allows a newer resumed operation to repair normally', async () => {
    taskFindById.mockResolvedValue({
      status: 'running',
      context: { manualStopAt: '2026-09-13T01:00:00Z' },
    });
    findById.mockResolvedValue({ createdAt: new Date('2026-09-13T02:00:00Z') });
    const runner = createRepairRunner({
      agentId: 'agent',
      db: {} as any,
      maxRepairRounds: 3,
      taskId: 'task',
      topicId: 'topic',
      userId: 'user',
    });
    expect(await runner!({ failedItemIds: [], instruction: 'fix', operationId: 'op' })).toEqual({
      repairOperationId: 'repair-op',
    });
    expect(execAgent).toHaveBeenCalledTimes(1);
  });

  it('stops repairing once the parent chain reaches the round cap', async () => {
    findById.mockResolvedValue({ parentOperationId: 'op-parent' });

    const runner = createRepairRunner({
      agentId: 'builder-agent',
      db: {} as any,
      maxRepairRounds: 1,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    await expect(
      runner!({ failedItemIds: [], instruction: 'fix', operationId: 'op-1' }),
    ).resolves.toBeNull();
    expect(execAgent).not.toHaveBeenCalled();
  });
});

describe('maybeAutoRepair manual stop boundary', () => {
  beforeEach(() => {
    findByOperation.mockReset().mockResolvedValue({
      id: 'verify',
      plan: [{ id: 'check', required: true, onFail: 'auto_repair' }],
    });
    listByRun.mockReset().mockResolvedValue([{ checkItemId: 'check', status: 'failed' }]);
    findById.mockReset().mockResolvedValue({
      taskId: 'task',
      createdAt: new Date('2026-09-13T01:00:00Z'),
      agentId: 'agent',
      topicId: 'topic',
    });
    taskFindById.mockReset();
  });

  it.each(['paused', 'canceled'])('does not even dispatch repair for a %s task', async (status) => {
    taskFindById.mockResolvedValue({ status });
    const trigger = vi
      .spyOn(VerifyRepairService.prototype, 'triggerAutoRepair')
      .mockResolvedValue(null);
    await maybeAutoRepair({} as any, 'user', 'op');
    expect(trigger).not.toHaveBeenCalled();
    trigger.mockRestore();
  });
});
