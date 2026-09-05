import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { PlatformCredentialResolver } from '@/server/services/platformAiRuntime';

import { pricePlatformTextUsage, resolvePlatformModelPricing } from './modelPricing';

const mocks = vi.hoisted(() => ({
  getAiProviderModelList: vi.fn(),
  getServerGlobalConfig: vi.fn(),
  resolveOwnerId: vi.fn(),
}));

vi.mock('@/database/repositories/aiInfra', () => ({
  AiInfraRepos: vi.fn().mockImplementation(() => ({
    getAiProviderModelList: mocks.getAiProviderModelList,
  })),
}));
vi.mock('@/server/globalConfig', () => ({
  getServerGlobalConfig: mocks.getServerGlobalConfig,
}));
vi.mock('@/server/services/platformAiRuntime', () => ({
  PlatformCredentialResolver: vi.fn().mockImplementation(() => ({
    resolveOwnerId: mocks.resolveOwnerId,
  })),
}));

const pricing = {
  currency: 'USD' as const,
  units: [
    {
      name: 'textInput' as const,
      rate: 1,
      strategy: 'fixed' as const,
      unit: 'millionTokens' as const,
    },
    {
      name: 'textOutput' as const,
      rate: 2,
      strategy: 'fixed' as const,
      unit: 'millionTokens' as const,
    },
  ],
};

const resolveCatalogPricing = async (candidatePricing: unknown) => {
  mocks.getAiProviderModelList.mockResolvedValue([
    {
      enabled: true,
      id: 'admin-custom-model',
      pricing: candidatePricing,
      type: 'chat',
    },
  ]);

  return resolvePlatformModelPricing({} as LobeChatDatabase, {
    model: 'admin-custom-model',
    provider: 'custom-provider',
  });
};

describe('platform model pricing contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOwnerId.mockResolvedValue('platform-admin');
    mocks.getServerGlobalConfig.mockResolvedValue({ aiProvider: { custom: { enabled: true } } });
  });

  it('resolves the exact enabled model from the validated platform owner catalog', async () => {
    mocks.getAiProviderModelList.mockResolvedValue([
      { enabled: true, id: 'admin-custom-model', pricing, type: 'chat' },
    ]);
    const db = {} as LobeChatDatabase;

    await expect(
      resolvePlatformModelPricing(db, {
        model: 'admin-custom-model',
        provider: 'custom-provider',
      }),
    ).resolves.toEqual({ model: 'admin-custom-model', pricing, provider: 'custom-provider' });

    expect(PlatformCredentialResolver).toHaveBeenCalledWith(db);
    expect(AiInfraRepos).toHaveBeenCalledWith(
      db,
      'platform-admin',
      { custom: { enabled: true } },
      undefined,
    );
    expect(mocks.getAiProviderModelList).toHaveBeenCalledWith('custom-provider', {
      enabled: true,
    });
  });

  it.each([
    ['missing exact model', [{ enabled: true, id: 'other-model', pricing, type: 'chat' }]],
    ['missing pricing', [{ enabled: true, id: 'admin-custom-model', type: 'chat' }]],
    [
      'cross-provider model',
      [
        {
          enabled: true,
          id: 'admin-custom-model',
          pricing,
          providerId: 'other-provider',
          type: 'chat',
        },
      ],
    ],
  ])('fails closed for %s', async (_label, models) => {
    mocks.getAiProviderModelList.mockResolvedValue(models);

    await expect(
      resolvePlatformModelPricing({} as LobeChatDatabase, {
        model: 'admin-custom-model',
        provider: 'custom-provider',
      }),
    ).resolves.toBeUndefined();
  });

  it('recomputes authoritative USD cost from the same server pricing snapshot', () => {
    const usage = {
      cost: 999,
      totalInputTokens: 1_000,
      totalOutputTokens: 500,
      totalTokens: 1_500,
    };

    expect(
      pricePlatformTextUsage(
        { model: 'admin-custom-model', pricing, provider: 'custom-provider' },
        usage,
      ),
    ).toEqual({ ...usage, cost: 0.002 });
    expect(usage.cost).toBe(999);
  });

  it.each([
    ['input', [{ name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' }]],
    ['output', [{ name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' }]],
  ])('rejects pricing that cannot charge representative %s-only usage', async (_label, units) => {
    await expect(resolveCatalogPricing({ currency: 'USD', units })).resolves.toBeUndefined();
  });

  it.each([
    ['zero output', { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' }],
    ['negative output', { name: 'textOutput', rate: -2, strategy: 'fixed', unit: 'millionTokens' }],
    [
      'non-finite cache rate',
      {
        name: 'textInput_cacheRead',
        rate: Number.POSITIVE_INFINITY,
        strategy: 'fixed',
        unit: 'millionTokens',
      },
    ],
    [
      'invalid tier rate',
      {
        name: 'audioInput',
        strategy: 'tiered',
        tiers: [
          { rate: 0, upTo: 10_000 },
          { rate: 1, upTo: 'infinity' },
        ],
        unit: 'millionTokens',
      },
    ],
    [
      'invalid lookup price',
      {
        lookup: { prices: { standard: Number.NaN }, pricingParams: ['quality'] },
        name: 'imageInput',
        strategy: 'lookup',
        unit: 'millionTokens',
      },
    ],
  ])('rejects a catalog with %s before it becomes a platform snapshot', async (_label, unit) => {
    await expect(
      resolveCatalogPricing({
        currency: 'USD',
        units: [pricing.units[0], pricing.units[1], unit],
      }),
    ).resolves.toBeUndefined();
  });

  it('accepts positive per-million-token prices for every declared chat usage category', async () => {
    const multimodalPricing = {
      currency: 'USD' as const,
      units: [
        ...pricing.units,
        {
          name: 'textInput_cacheRead' as const,
          rate: 0.1,
          strategy: 'fixed' as const,
          unit: 'millionTokens' as const,
        },
        {
          name: 'textInput_cacheWrite' as const,
          rate: 1.25,
          strategy: 'fixed' as const,
          unit: 'millionTokens' as const,
        },
        {
          name: 'audioInput' as const,
          rate: 3,
          strategy: 'fixed' as const,
          unit: 'millionTokens' as const,
        },
        {
          name: 'audioInput_cacheRead' as const,
          rate: 0.3,
          strategy: 'fixed' as const,
          unit: 'millionTokens' as const,
        },
        {
          name: 'audioOutput' as const,
          rate: 6,
          strategy: 'fixed' as const,
          unit: 'millionTokens' as const,
        },
        {
          name: 'imageInput' as const,
          rate: 4,
          strategy: 'fixed' as const,
          unit: 'millionTokens' as const,
        },
        {
          name: 'imageInput_cacheRead' as const,
          rate: 0.4,
          strategy: 'fixed' as const,
          unit: 'millionTokens' as const,
        },
        {
          name: 'imageOutput' as const,
          rate: 8,
          strategy: 'fixed' as const,
          unit: 'millionTokens' as const,
        },
        {
          name: 'videoInput' as const,
          rate: 5,
          strategy: 'fixed' as const,
          unit: 'millionTokens' as const,
        },
      ],
    };

    await expect(resolveCatalogPricing(multimodalPricing)).resolves.toEqual({
      model: 'admin-custom-model',
      pricing: multimodalPricing,
      provider: 'custom-provider',
    });
  });

  it('fails closed when exact pricing cannot produce a trustworthy token cost', () => {
    expect(() =>
      pricePlatformTextUsage(
        {
          model: 'admin-custom-model',
          pricing: {
            units: [
              {
                lookup: { prices: {}, pricingParams: ['tier'] },
                name: 'textInput',
                strategy: 'lookup',
                unit: 'millionTokens',
              },
            ],
          },
          provider: 'custom-provider',
        },
        { totalInputTokens: 1, totalTokens: 1 },
      ),
    ).toThrow('Exact platform model usage cost is unavailable');
  });

  it('does not silently charge zero when aggregate usage cannot be split into priced units', () => {
    expect(() =>
      pricePlatformTextUsage(
        { model: 'admin-custom-model', pricing, provider: 'custom-provider' },
        { totalTokens: 10 },
      ),
    ).toThrow('Exact platform model usage cost is unavailable');
  });
});
