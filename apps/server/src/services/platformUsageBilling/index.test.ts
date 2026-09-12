import { CREDITS_PER_DOLLAR } from '@lobechat/const/currency';
import { describe, expect, it } from 'vitest';

import { type PlatformUsageBillingError, preparePlatformUsageCharge } from './index';

const identity = {
  actorUserId: 'user-customer-1',
  generationId: 'generation-1',
  generationType: 'chat',
  model: 'deepseek-chat',
  provider: 'deepseek',
  workspaceId: 'workspace-1',
} as const;

describe('preparePlatformUsageCharge', () => {
  it('keeps the settled FX snapshot in ledger usage metadata', () => {
    const costExchangeRate = { rate: 7, rateDate: '2026-09-07', updatedAt: '2026-09-07T10:00:00Z' };
    const charge = preparePlatformUsageCharge({
      ...identity,
      usage: { cost: 1, costExchangeRate },
    });
    expect(charge.tokens).toEqual({ costExchangeRate });
    expect(charge.credits).toBe(1_000_000);
  });
  it.each([
    [0.000123, 123],
    [0.000249, 249],
    [0.00012300000001, 124],
    [1e-12, 1],
    [1.0000001, 1_000_001],
  ])('converts decimal USD %s without a floating-point extra credit', (cost, credits) => {
    expect(preparePlatformUsageCharge({ ...identity, usage: { cost } }).credits).toBe(credits);
  });

  it('converts the authoritative USD cost to integer LobeHub credits', () => {
    const charge = preparePlatformUsageCharge({
      ...identity,
      usage: {
        cost: 1.25,
        totalInputTokens: 1_000_000,
        totalOutputTokens: 250_000,
        totalTokens: 1_250_000,
      },
    });

    expect(charge.costUsd).toBe(1.25);
    expect(charge.credits).toBe(1.25 * CREDITS_PER_DOLLAR);
    expect(charge.creditsPerDollar).toBe(CREDITS_PER_DOLLAR);
  });

  it('uses the same ceiling rule as LobeHub image and video cost conversion', () => {
    expect(
      preparePlatformUsageCharge({
        ...identity,
        usage: { cost: 0.0000001 },
      }).credits,
    ).toBe(1);
    expect(
      preparePlatformUsageCharge({
        ...identity,
        usage: { cost: 0 },
      }).credits,
    ).toBe(0);
  });

  it('preserves every supplied standard token-usage detail without deriving prices', () => {
    const usage = {
      acceptedPredictionTokens: 11,
      cost: 0.42,
      inputAudioTokens: 12,
      inputCachedAudioTokens: 13,
      inputCachedImageTokens: 14,
      inputCachedTextTokens: 15,
      inputCachedTokens: 16,
      inputCachedVideoTokens: 17,
      inputCacheMissTokens: 18,
      inputCitationTokens: 19,
      inputImageTokens: 20,
      inputTextTokens: 21,
      inputToolTokens: 22,
      inputVideoTokens: 23,
      inputWriteCacheTokens: 24,
      outputAudioTokens: 25,
      outputImageTokens: 26,
      outputReasoningTokens: 27,
      outputTextTokens: 28,
      rejectedPredictionTokens: 29,
      totalInputTokens: 30,
      totalOutputTokens: 31,
      totalTokens: 61,
    };

    const charge = preparePlatformUsageCharge({ ...identity, usage });
    const { cost: _cost, ...expectedTokens } = usage;

    expect(charge.tokens).toEqual(expectedTokens);
    expect(charge.costUsd).toBe(usage.cost);
  });

  it('builds a stable opaque idempotency key from the billing identity', () => {
    const first = preparePlatformUsageCharge({ ...identity, usage: { cost: 0.1 } });
    const replay = preparePlatformUsageCharge({ ...identity, usage: { cost: 0.2 } });

    expect(replay.idempotency).toEqual(first.idempotency);
    expect(first.idempotency.key).toMatch(/^platform-usage:v1:[a-f0-9]{64}$/);
    expect(first.idempotency.material).toEqual({
      actorUserId: identity.actorUserId,
      generationId: identity.generationId,
      generationType: identity.generationType,
      model: identity.model,
      provider: identity.provider,
      version: 1,
      workspaceId: identity.workspaceId,
    });
  });

  it.each([
    ['actor', { actorUserId: '' }],
    ['generation', { generationId: '   ' }],
    ['model', { model: '' }],
    ['provider', { provider: '' }],
  ])('fails closed when the %s identity is missing', (_label, patch) => {
    expect(() =>
      preparePlatformUsageCharge({ ...identity, ...patch, usage: { cost: 0.1 } }),
    ).toThrowError(
      expect.objectContaining<Partial<PlatformUsageBillingError>>({ code: 'INVALID_IDENTITY' }),
    );
  });

  it('changes the idempotency key when any billing identity component changes', () => {
    const base = preparePlatformUsageCharge({ ...identity, usage: { cost: 0.1 } }).idempotency.key;
    const variants = [
      { actorUserId: 'user-customer-2' },
      { generationId: 'generation-2' },
      { generationType: 'image' },
      { model: 'another-model' },
      { provider: 'another-provider' },
      { workspaceId: 'workspace-2' },
    ];

    for (const variant of variants) {
      const key = preparePlatformUsageCharge({
        ...identity,
        ...variant,
        usage: { cost: 0.1 },
      }).idempotency.key;
      expect(key).not.toBe(base);
    }
  });

  it.each([
    ['missing usage', undefined, 'USAGE_MISSING'],
    ['missing cost', {}, 'COST_MISSING'],
    ['negative cost', { cost: -0.1 }, 'INVALID_COST'],
    ['NaN cost', { cost: Number.NaN }, 'INVALID_COST'],
    ['infinite cost', { cost: Number.POSITIVE_INFINITY }, 'INVALID_COST'],
  ] as const)('fails closed for %s', (_label, usage, code) => {
    expect(() => preparePlatformUsageCharge({ ...identity, usage })).toThrowError(
      expect.objectContaining<Partial<PlatformUsageBillingError>>({ code }),
    );
  });

  it('rejects malformed token usage and unsafe credit totals', () => {
    expect(() =>
      preparePlatformUsageCharge({
        ...identity,
        usage: { cost: 0.1, totalInputTokens: -1 },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PlatformUsageBillingError>>({
        code: 'INVALID_TOKEN_USAGE',
      }),
    );

    expect(() =>
      preparePlatformUsageCharge({
        ...identity,
        usage: { cost: Number.MAX_SAFE_INTEGER / CREDITS_PER_DOLLAR + 1 },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PlatformUsageBillingError>>({
        code: 'CREDITS_OVERFLOW',
      }),
    );
  });
});
