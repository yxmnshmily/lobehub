import type { LobeChatDatabase } from '@lobechat/database';
import deepseekModels from 'model-bank/deepseek';
import moonshotModels from 'model-bank/moonshot';
import qwenModels from 'model-bank/qwen';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { PlatformCredentialResolver } from '@/server/services/platformAiRuntime';

import { pricePlatformTextUsage, resolvePlatformModelPricing } from './modelPricing';

const mocks = vi.hoisted(() => ({
  getBillingExchangeRate: vi.fn(),
  getAiProviderModelList: vi.fn(),
  getServerGlobalConfig: vi.fn(),
  resolveOwnerId: vi.fn(),
}));
vi.mock('@/server/services/monthlyExchangeRate', () => ({
  getBillingExchangeRate: mocks.getBillingExchangeRate,
}));

vi.mock('@/database/repositories/aiInfra', () => ({
  AiInfraRepos: vi.fn().mockImplementation(function () {
    return {
      getAiProviderModelList: mocks.getAiProviderModelList,
    };
  }),
}));
vi.mock('@/server/globalConfig', () => ({
  getServerGlobalConfig: mocks.getServerGlobalConfig,
}));
vi.mock('@/server/services/platformAiRuntime', () => ({
  PlatformCredentialResolver: vi.fn().mockImplementation(function () {
    return {
      resolveOwnerId: mocks.resolveOwnerId,
    };
  }),
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
  it.each(['qwen3.8-max', 'kimi/kimi-k3', 'ZHIPU/GLM-5.2'])(
    'includes billing metadata for enabled Qwen model %s',
    (id) => {
      const model = qwenModels.find((item) => item.id === id);
      expect(model?.contextWindowTokens).toBeGreaterThan(0);
      expect(model?.maxOutput).toBeGreaterThan(0);
      expect(model?.pricing?.units.map((unit) => unit.name)).toEqual(
        expect.arrayContaining(['textInput', 'textOutput']),
      );
    },
  );
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.getBillingExchangeRate.mockResolvedValue({
      month: '2026-09',
      rate: 7.12,
      rateDate: '2026-09-04',
      updatedAt: '2026-09-07T00:00:00Z',
    });
    mocks.resolveOwnerId.mockResolvedValue('platform-admin');
    mocks.getServerGlobalConfig.mockResolvedValue({ aiProvider: { custom: { enabled: true } } });
  });

  it.each([2048, undefined])(
    'preserves optional catalog output limit (%s) in the pricing snapshot',
    async (maxOutput) => {
      mocks.getAiProviderModelList.mockResolvedValue([
        {
          enabled: true,
          id: 'admin-custom-model',
          type: 'chat',
          contextWindowTokens: 8192,
          ...(maxOutput === undefined ? {} : { maxOutput }),
          pricing,
        },
      ]);
      const snapshot = await resolvePlatformModelPricing({} as LobeChatDatabase, {
        model: 'admin-custom-model',
        provider: 'custom-provider',
      });
      expect(snapshot).toMatchObject({ contextWindowTokens: 8192, maxOutput });
    },
  );

  it('freezes the latest FX for CNY admission and charges that quote after it changes', async () => {
    mocks.getBillingExchangeRate.mockResolvedValue({
      month: '2026-09',
      rate: 7,
      rateDate: '2026-09-07',
      updatedAt: '2026-09-07T10:00:00Z',
    });
    const snapshot = await resolveCatalogPricing({
      ...pricing,
      currency: 'CNY',
      units: pricing.units.map((unit) => ({ ...unit, rate: unit.rate * 7 })),
    });
    mocks.getBillingExchangeRate.mockResolvedValue({
      month: '2026-09',
      rate: 8,
      rateDate: '2026-09-07',
      updatedAt: '2026-09-07T11:00:00Z',
    });
    const result = pricePlatformTextUsage(snapshot!, { totalInputTokens: 1_000_000 });
    expect(result.cost).toBe(1);
    expect(result.costExchangeRate).toEqual({
      rate: 7,
      rateDate: '2026-09-07',
      updatedAt: '2026-09-07T10:00:00Z',
    });
    expect(snapshot!.pricing.currency).toBe('USD');
    expect(snapshot!.pricing.units[1]).toMatchObject({ rate: 2 });
  });

  it('does not admit CNY pricing when the latest FX cannot be obtained', async () => {
    mocks.getBillingExchangeRate.mockRejectedValue(new Error('FX unavailable'));
    await expect(resolveCatalogPricing({ ...pricing, currency: 'CNY' })).rejects.toThrow(
      'FX unavailable',
    );
  });

  it('charges the default domestic Kimi K3 input in CNY, not USD', () => {
    const kimiPricing = moonshotModels.find((model) => model.id === 'kimi-k3')!.pricing!;
    const inputUnit = kimiPricing.units.find((unit) => unit.name === 'textInput');
    expect(kimiPricing.currency).toBe('CNY');
    expect(inputUnit).toMatchObject({ strategy: 'fixed', unit: 'millionTokens' });
    if (inputUnit?.strategy !== 'fixed') throw new Error('Expected fixed input pricing');
    const result = pricePlatformTextUsage(
      {
        model: 'kimi-k3',
        provider: 'moonshot',
        pricing: kimiPricing,
        exchangeRate: { rate: 7.12, rateDate: '2026-09-04', updatedAt: '2026-09-07T00:00:00Z' },
      },
      { totalInputTokens: 1_000_000 },
    );
    expect(result.cost).toBe(Math.ceil((inputUnit.rate / 7.12) * 1_000_000) / 1_000_000);
  });

  it.each([
    ['2026-09-07T00:59:59Z', 0.702248],
    ['2026-09-07T01:00:00Z', 1.404495],
    ['2026-09-07T03:59:59Z', 1.404495],
    ['2026-09-07T04:00:00Z', 0.702248],
    ['2026-09-07T06:00:00Z', 1.404495],
    ['2026-09-07T10:00:00Z', 0.702248],
    ['2026-09-06T01:00:00Z', 0.702248],
  ])('freezes the default DeepSeek rate at admission time %s', async (now, cost) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    mocks.getAiProviderModelList.mockResolvedValue([deepseekModels[0]]);
    const snapshot = await resolvePlatformModelPricing({} as LobeChatDatabase, {
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
    });
    vi.setSystemTime(new Date('2026-09-08T00:00:00Z'));
    expect(
      pricePlatformTextUsage(snapshot!, {
        totalInputTokens: 1_000_000,
        totalOutputTokens: 1_000_000,
      }).cost,
    ).toBe(cost);
    vi.useRealTimers();
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

  it('admits ordinary text when an unused cache-write price requires TTL', async () => {
    const snapshot = await resolveCatalogPricing({
      ...pricing,
      units: [
        ...pricing.units,
        {
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
          lookup: { pricingParams: ['ttl'], prices: { '1h': 0.017 } },
        },
      ],
    });
    expect(snapshot).toBeDefined();
    expect(
      pricePlatformTextUsage(snapshot!, { totalInputTokens: 1000, totalOutputTokens: 100 }).cost,
    ).toBeCloseTo(0.0012);
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
