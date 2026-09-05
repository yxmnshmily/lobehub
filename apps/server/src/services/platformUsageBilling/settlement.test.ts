import type { LobeChatDatabase, PlatformCreditModel } from '@lobechat/database';
import { describe, expect, it, vi } from 'vitest';

import {
  PlatformManagedImageUsageSettlement,
  PlatformManagedTextUsageSettlement,
  PlatformManagedTextUsageSettlementError,
} from './settlement';

const createLedger = (balanceCredits: number) =>
  ({
    chargeUsage: vi.fn(async (input) => ({ id: 'entry-1', ...input })),
    getAccount: vi.fn(async () => ({ balanceCredits })),
  }) as unknown as Pick<PlatformCreditModel, 'chargeUsage' | 'getAccount'>;

const createSettlement = (balanceCredits: number) => {
  const ledger = createLedger(balanceCredits);
  const settlement = new PlatformManagedTextUsageSettlement(
    {} as LobeChatDatabase,
    'customer-1',
    ledger,
  );

  return { ledger, settlement };
};

describe('PlatformManagedTextUsageSettlement', () => {
  it('allows the provider call only when the actor has a positive Credits balance', async () => {
    const { settlement } = createSettlement(1);

    await expect(settlement.assertCanCallProvider()).resolves.toBeUndefined();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
    'fails the provider preflight for an invalid or empty balance (%s)',
    async (balanceCredits) => {
      const { settlement } = createSettlement(balanceCredits);

      await expect(settlement.assertCanCallProvider()).rejects.toBeInstanceOf(
        PlatformManagedTextUsageSettlementError,
      );
    },
  );

  it('settles actual runtime cost through preparePlatformUsageCharge', async () => {
    const { ledger, settlement } = createSettlement(1000);

    await settlement.settleStep({
      kind: 'call_llm',
      model: 'deepseek-chat',
      operationId: 'operation-1',
      provider: 'deepseek',
      stepIndex: 3,
      usage: { cost: 0.0006, totalInputTokens: 100, totalOutputTokens: 50, totalTokens: 150 },
      workspaceId: 'workspace-1',
    });

    expect(ledger.chargeUsage).toHaveBeenCalledWith({
      actorUserId: 'customer-1',
      costUsd: 0.0006,
      credits: 600,
      generationId: 'operation-1:step:3:call_llm',
      generationType: 'agent-runtime-text-step',
      idempotencyKey: expect.stringMatching(/^platform-usage:v1:[a-f0-9]{64}$/),
      model: 'deepseek-chat',
      provider: 'deepseek',
      tokenUsage: { totalInputTokens: 100, totalOutputTokens: 50, totalTokens: 150 },
      workspaceId: 'workspace-1',
    });
  });

  it('uses operationId plus stepIndex as the durable step identity', async () => {
    const { ledger, settlement } = createSettlement(1000);
    const base = {
      kind: 'call_llm' as const,
      model: 'deepseek-chat',
      operationId: 'operation-1',
      provider: 'deepseek',
      usage: { cost: 0.0001, totalTokens: 10 },
    };

    await settlement.settleStep({ ...base, stepIndex: 1 });
    await settlement.settleStep({ ...base, stepIndex: 2 });

    const first = vi.mocked(ledger.chargeUsage).mock.calls[0]![0];
    const second = vi.mocked(ledger.chargeUsage).mock.calls[1]![0];
    expect(first.generationId).toBe('operation-1:step:1:call_llm');
    expect(second.generationId).toBe('operation-1:step:2:call_llm');
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  });

  it('separates call_llm and compress_context at the same operation step', async () => {
    const { ledger, settlement } = createSettlement(1000);
    const base = {
      model: 'deepseek-chat',
      operationId: 'operation-1',
      provider: 'deepseek',
      stepIndex: 1,
      usage: { cost: 0.0001, totalTokens: 10 },
    };

    await settlement.settleStep({ ...base, kind: 'call_llm' });
    await settlement.settleStep({ ...base, kind: 'compress_context' });

    const first = vi.mocked(ledger.chargeUsage).mock.calls[0]![0];
    const second = vi.mocked(ledger.chargeUsage).mock.calls[1]![0];
    expect(first.generationId).toBe('operation-1:step:1:call_llm');
    expect(second.generationId).toBe('operation-1:step:1:compress_context');
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  });

  it('rejects an empty operation id instead of creating an ambiguous step identity', async () => {
    const { ledger, settlement } = createSettlement(1000);

    await expect(
      settlement.settleStep({
        kind: 'call_llm',
        model: 'deepseek-chat',
        operationId: '   ',
        provider: 'deepseek',
        stepIndex: 1,
        usage: { cost: 0.0001, totalTokens: 10 },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STEP_IDENTITY' });
    expect(ledger.chargeUsage).not.toHaveBeenCalled();
  });

  it.each([
    ['missing usage', undefined],
    ['missing runtime cost', { totalTokens: 10 }],
  ])('fails closed for %s without writing a charge', async (_label, usage) => {
    const { ledger, settlement } = createSettlement(1000);

    await expect(
      settlement.settleStep({
        kind: 'call_llm',
        model: 'deepseek-chat',
        operationId: 'operation-1',
        provider: 'deepseek',
        stepIndex: 1,
        usage,
      }),
    ).rejects.toBeInstanceOf(PlatformManagedTextUsageSettlementError);
    expect(ledger.chargeUsage).not.toHaveBeenCalled();
  });
});

describe('PlatformManagedImageUsageSettlement', () => {
  const createImageSettlement = (balanceCredits: number) => {
    const ledger = createLedger(balanceCredits);
    const settlement = new PlatformManagedImageUsageSettlement(
      {} as LobeChatDatabase,
      'customer-1',
      ledger,
    );

    return { ledger, settlement };
  };

  it('requires a positive Credits balance before the image provider call', async () => {
    const { settlement } = createImageSettlement(0);

    await expect(settlement.assertCanCallProvider()).rejects.toMatchObject({
      code: 'BALANCE_EMPTY',
    });
  });

  it('settles authoritative image model usage under the async task and generation identity', async () => {
    const { ledger, settlement } = createImageSettlement(1000);

    await settlement.settleImage({
      asyncTaskId: 'task-1',
      generationId: 'generation-1',
      model: 'gpt-image-1',
      provider: 'openai',
      usage: {
        cost: 0.0006,
        inputTextTokens: 100,
        outputImageTokens: 500,
        totalTokens: 600,
      },
      workspaceId: 'workspace-1',
    });

    expect(ledger.chargeUsage).toHaveBeenCalledWith({
      actorUserId: 'customer-1',
      costUsd: 0.0006,
      credits: 600,
      generationId: 'generation-1:async-task:task-1:image',
      generationType: 'platform-managed-image',
      idempotencyKey: expect.stringMatching(/^platform-usage:v1:[a-f0-9]{64}$/),
      model: 'gpt-image-1',
      provider: 'openai',
      tokenUsage: { inputTextTokens: 100, outputImageTokens: 500, totalTokens: 600 },
      workspaceId: 'workspace-1',
    });
  });

  it('uses a stable key for a replay and a distinct key for another async task', async () => {
    const { ledger, settlement } = createImageSettlement(1000);
    const input = {
      asyncTaskId: 'task-1',
      generationId: 'generation-1',
      model: 'gpt-image-1',
      provider: 'openai',
      usage: { cost: 0.0001, totalTokens: 10 },
    };

    await settlement.settleImage(input);
    await settlement.settleImage(input);
    await settlement.settleImage({ ...input, asyncTaskId: 'task-2' });

    const [first, replay, other] = vi
      .mocked(ledger.chargeUsage)
      .mock.calls.map(([charge]) => charge);
    expect(replay!.idempotencyKey).toBe(first!.idempotencyKey);
    expect(other!.idempotencyKey).not.toBe(first!.idempotencyKey);
  });

  it.each([
    ['missing usage', undefined],
    ['missing cost', { totalTokens: 10 }],
  ])('fails closed for %s without writing an image charge', async (_label, usage) => {
    const { ledger, settlement } = createImageSettlement(1000);

    await expect(
      settlement.settleImage({
        asyncTaskId: 'task-1',
        generationId: 'generation-1',
        model: 'gpt-image-1',
        provider: 'openai',
        usage,
      }),
    ).rejects.toMatchObject({ code: 'SETTLEMENT_FAILED' });
    expect(ledger.chargeUsage).not.toHaveBeenCalled();
  });
});
