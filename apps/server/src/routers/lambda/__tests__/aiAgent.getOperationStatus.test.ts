// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { agentOperations } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentRouter } from '../aiAgent';
import { cleanupTestUser, createTestUser } from './integration/setup';

let testDB: LobeChatDatabase;
const getOperationStatus = vi.fn();
const getPendingInterventions = vi.fn();
const processHumanIntervention = vi.fn();
const startExecution = vi.fn();
const interruptTask = vi.fn();

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn(() => ({
    getOperationStatus,
    getPendingInterventions,
    processHumanIntervention,
    startExecution,
  })),
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn(() => ({ interruptTask })),
}));
vi.mock('@/server/services/aiChat', () => ({
  AiChatService: vi.fn(() => ({})),
}));

describe('aiAgentRouter.getOperationStatus ownership', () => {
  const operationId = 'operation-owned-by-user-a';
  let ownerUserId: string;
  let otherUserId: string;

  const caller = (userId: string) =>
    aiAgentRouter.createCaller({ jwtPayload: { userId }, userId } as any);

  beforeEach(async () => {
    testDB = await getTestDB();
    ownerUserId = await createTestUser(testDB);
    otherUserId = await createTestUser(testDB);
    await testDB.insert(agentOperations).values({
      id: operationId,
      status: 'running',
      userId: ownerUserId,
    });
    getOperationStatus.mockResolvedValue({ currentState: { status: 'running' } });
    getPendingInterventions.mockResolvedValue([]);
    processHumanIntervention.mockResolvedValue({ messageId: 'scheduled-message' });
    startExecution.mockResolvedValue({ operationId });
    interruptTask.mockResolvedValue({ operationId, success: true });
  });

  afterEach(async () => {
    await testDB.delete(agentOperations).where(eq(agentOperations.id, operationId));
    await cleanupTestUser(testDB, ownerUserId);
    await cleanupTestUser(testDB, otherUserId);
    vi.clearAllMocks();
  });

  it('does not touch runtime storage for another users operation id', async () => {
    await expect(caller(otherUserId).getOperationStatus({ operationId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(getOperationStatus).not.toHaveBeenCalled();
  });

  it('returns runtime status for the operation owner', async () => {
    await expect(caller(ownerUserId).getOperationStatus({ operationId })).resolves.toEqual({
      currentState: { status: 'running' },
    });
    expect(getOperationStatus).toHaveBeenCalledWith({
      historyLimit: 10,
      includeHistory: false,
      operationId,
    });
  });

  it.each([
    ['getPendingInterventions', () => caller(otherUserId).getPendingInterventions({ operationId })],
    [
      'processHumanIntervention',
      () =>
        caller(otherUserId).processHumanIntervention({
          action: 'reject',
          operationId,
          reason: 'no',
        }),
    ],
    ['startExecution', () => caller(otherUserId).startExecution({ operationId })],
    [
      'submitHeteroIntervention',
      () =>
        caller(otherUserId).submitHeteroIntervention({
          operationId,
          result: { approved: true },
          stepIndex: 1,
          toolCallId: 'tool-call-1',
        }),
    ],
    ['interruptTask', () => caller(otherUserId).interruptTask({ operationId })],
  ])('rejects another users operation before %s reaches runtime state', async (_name, invoke) => {
    await expect(invoke()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('ignores a caller supplied userId when listing pending interventions', async () => {
    await caller(otherUserId).getPendingInterventions({ userId: ownerUserId });

    expect(getPendingInterventions).toHaveBeenCalledWith({
      operationId: undefined,
      userId: otherUserId,
    });
  });
});
