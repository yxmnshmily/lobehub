// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRepairRunner } from '../repairService';

const { attachPolicyRun, confirmPlan, ensureForOperation, execAgent, findById, findByOperation } =
  vi.hoisted(() => ({
    attachPolicyRun: vi.fn(),
    confirmPlan: vi.fn(),
    ensureForOperation: vi.fn(),
    execAgent: vi.fn(),
    findById: vi.fn(),
    findByOperation: vi.fn(),
  }));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn(() => ({ execAgent })),
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(() => ({ findById })),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(() => ({ confirmPlan, ensureForOperation, findByOperation })),
}));
vi.mock('../acceptanceService', () => ({
  AcceptanceService: vi.fn(() => ({ attachPolicyRun })),
}));

describe('createRepairRunner', () => {
  beforeEach(() => {
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
