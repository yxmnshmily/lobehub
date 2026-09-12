// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

import {
  bindPlatformUsageSharedBudget,
  createPlatformUsageSharedBudget,
  runPlatformUsageSharedBudgetStep,
} from './sharedBudget';

const mocks = vi.hoisted(() => ({
  assertCanCallProvider: vi.fn(),
  reserve: vi.fn(),
  settleStep: vi.fn(),
}));
vi.mock('./reservation', () => ({
  PlatformUsageReservationService: class {
    reserveRequest = mocks.reserve;
  },
}));
vi.mock('./settlement', () => ({
  PlatformManagedTextUsageSettlement: class {
    assertCanCallProvider = mocks.assertCanCallProvider;
    settleStep = mocks.settleStep;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

it('runs an uncapped round without reserving Credits and settles only its actual usage', async () => {
  const providerCall = vi.fn(async () => ({
    output: 'done',
    usage: { cost: 0.001, totalTokens: 100 },
  }));
  const handle = await createPlatformUsageSharedBudget({} as any, 'user', {
    expiresAt: new Date(Date.now() + 60_000),
    requestIdentity: 'metered-without-hold',
  });
  bindPlatformUsageSharedBudget('operation-1', handle, { actorUserId: 'user' });

  await expect(
    runPlatformUsageSharedBudgetStep(handle, {
      actorUserId: 'user',
      inputHash: 'input-hash',
      kind: 'call_llm',
      model: 'deepseek-chat',
      operationId: 'operation-1',
      provider: 'deepseek',
      providerCall,
      stepIndex: 3,
    }),
  ).resolves.toBe('done');

  expect(mocks.reserve).not.toHaveBeenCalled();
  expect(mocks.assertCanCallProvider).toHaveBeenCalledOnce();
  expect(mocks.assertCanCallProvider.mock.invocationCallOrder[0]).toBeLessThan(
    providerCall.mock.invocationCallOrder[0]!,
  );
  expect(mocks.settleStep).toHaveBeenCalledWith({
    kind: 'call_llm',
    model: 'deepseek-chat',
    operationId: 'operation-1',
    provider: 'deepseek',
    stepIndex: 3,
    usage: { cost: 0.001, totalTokens: 100 },
    workspaceId: undefined,
  });
});

it('does not admit a prepaid request when atomic reservation fails', async () => {
  mocks.reserve.mockRejectedValue(new Error('insufficient available balance'));
  await expect(
    createPlatformUsageSharedBudget({} as any, 'user', {
      expiresAt: new Date(Date.now() + 60_000),
      maxCredits: 100,
      requestIdentity: 'empty-account',
    }),
  ).rejects.toMatchObject({ code: 'RESERVATION_FAILED' });
});
