/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import type { TFunction } from 'i18next';
import type { Pricing } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EnabledProviderWithModels } from '@/types/aiProvider';

import zhComponents from '../../../../locales/zh-CN/components.json';
import { useModelDetailPanel } from './useModelDetailPanel';

const language = vi.hoisted(() => ({ value: 'en-US' }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: language.value }, t }),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    customerCenter: {
      getDisplayExchangeRate: {
        useQuery: () => ({
          data: {
            month: '2026-09',
            rate: 7,
            rateDate: '2026-08-31',
            updatedAt: '2026-09-01T00:00:00Z',
          },
        }),
      },
    },
  },
}));

const {
  globalState,
  updateExpandedKeysMock,
  useBusinessModelPricingMock,
  useEnabledChatModelsMock,
} = vi.hoisted(() => ({
  globalState: {
    status: {
      modelDetailPanelExpandedKeys: ['pricing'],
    },
    updateModelDetailPanelExpandedKeys: vi.fn(),
  },
  updateExpandedKeysMock: vi.fn(),
  useBusinessModelPricingMock: vi.fn(),
  useEnabledChatModelsMock: vi.fn(),
}));

vi.mock('@/hooks/useEnabledChatModels', () => ({
  useEnabledChatModels: useEnabledChatModelsMock,
}));

vi.mock('@/business/client/hooks/useBusinessModelPricing', () => ({
  useBusinessModelPricing: useBusinessModelPricingMock,
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: typeof globalState) => unknown) => selector(globalState),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    modelDetailPanelExpandedKeys: (state: typeof globalState) =>
      state.status.modelDetailPanelExpandedKeys,
  },
}));

const translations: Record<string, string> = {
  'ModelSwitchPanel.detail.pricing.credits.input': 'Input {{amount}} credits/M tokens',
  'ModelSwitchPanel.detail.pricing.credits.millionTokens': 'credits/M tokens',
  'ModelSwitchPanel.detail.pricing.credits.output': 'Output {{amount}} credits/M tokens',
  'ModelSwitchPanel.detail.pricing.credits.perImage': '~ {{amount}} credits / image',
  'ModelSwitchPanel.detail.pricing.credits.perVideo': '~ {{amount}} credits / video',
};

const t = ((key: string, options?: Record<string, string>) => {
  const template =
    (language.value === 'zh-CN'
      ? (zhComponents as Record<string, string>)[key]
      : translations[key]) ??
    options?.defaultValue ??
    key;

  return template.replaceAll(/\{\{(\w+)\}\}/g, (_, name) => options?.[name] ?? '');
}) as TFunction<'components'>;

const basePricing = {
  currency: 'USD',
  units: [
    { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
    { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
  ],
} as Pricing;

const discountedPricing = {
  currency: 'USD',
  units: [
    { name: 'textInput', originalRate: 5, rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
    { name: 'textOutput', originalRate: 25, rate: 12.5, strategy: 'fixed', unit: 'millionTokens' },
    {
      name: 'textInput_cacheRead',
      originalRate: 1,
      rate: 0.3,
      strategy: 'fixed',
      unit: 'millionTokens',
    },
  ],
} as Pricing;

const unitPricing = {
  currency: 'USD',
  units: [
    {
      name: 'imageGeneration',
      strategy: 'tiered',
      tiers: [{ originalRate: 0.05, rate: 0.02, upTo: 'infinity' }],
      unit: 'image',
    },
    {
      lookup: { originalPrices: { standard: 0.5 }, prices: { standard: 0.3 } },
      name: 'videoGeneration',
      strategy: 'lookup',
      unit: 'video',
    },
  ],
} as Pricing;

const createEnabledList = (
  provider: string,
  pricing: Pricing,
  overrides: Record<string, unknown> = {},
): EnabledProviderWithModels[] => [
  {
    children: [
      {
        abilities: {},
        contextWindowTokens: 1_000_000,
        displayName: 'Test Model',
        id: 'test-model',
        pricing,
        type: 'chat',
        ...overrides,
      } as any,
    ],
    id: provider,
    name: provider,
    source: 'builtin',
  },
];

const renderModelDetailPanelHook = (
  params: Partial<Parameters<typeof useModelDetailPanel>[0]> = {},
) =>
  renderHook(() =>
    useModelDetailPanel({
      enabledList: createEnabledList('lobehub', basePricing),
      modelId: 'test-model',
      provider: 'lobehub',
      t,
      ...params,
    }),
  );

describe('useModelDetailPanel', () => {
  it('converts native CNY quotes for English without changing the original pricing', () => {
    const pricing = {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 14, strategy: 'fixed', unit: 'millionTokens' },
      ],
    } as Pricing;
    const { result } = renderModelDetailPanelHook({
      enabledList: createEnabledList('deepseek', pricing),
      provider: 'deepseek',
    });
    expect(result.current.formatPrice?.input.current).toBe('$1.00');
    expect(result.current.formatPrice?.output.current).toBe('$2.00');
    expect(pricing.currency).toBe('CNY');
    expect(pricing.units[0]).toMatchObject({ rate: 7 });
  });
  beforeEach(() => {
    language.value = 'en-US';
    globalState.status.modelDetailPanelExpandedKeys = ['pricing'];
    globalState.updateModelDetailPanelExpandedKeys = updateExpandedKeysMock;
    updateExpandedKeysMock.mockReset();
    useEnabledChatModelsMock.mockReturnValue([]);
    useBusinessModelPricingMock.mockReturnValue(({ pricing }: { pricing?: Pricing }) => pricing);
  });

  it('localizes every generation price denominator without rescaling the price', () => {
    language.value = 'zh-CN';
    const { result } = renderModelDetailPanelHook({
      enabledList: createEnabledList('openai', basePricing),
      provider: 'openai',
      pricingMode: 'image',
    });
    expect(result.current.formatUnitPrice(basePricing.units[0]).current).toBe('¥35.00');
    expect(result.current.getUnitPriceSuffix('millionTokens')).toBe('/百万 Token');
    expect(result.current.getUnitPriceSuffix('millionCharacters')).toBe('/百万字符');
    expect(result.current.getUnitPriceSuffix('megapixel')).toBe('/百万像素');
    expect(result.current.getUnitPriceSuffix('image')).toBe('/张');
    expect(result.current.getUnitPriceSuffix('video')).toBe('/条视频');
    expect(result.current.getUnitPriceSuffix('second')).toBe('/秒');
    expect(basePricing.units[0]).toMatchObject({ rate: 5, unit: 'millionTokens' });
  });

  it('localizes credit amounts and cached/token tooltips and follows a language switch', () => {
    language.value = 'zh-CN';
    const { result, rerender } = renderModelDetailPanelHook({
      enabledList: createEnabledList('lobehub', discountedPricing),
    });
    expect(result.current.formatPrice?.input.current).toBe('250万');
    expect(result.current.formatPrice?.cachedInput.current).toBe('30万');
    expect(result.current.getPricingTooltip('input', '250万')).toBe('输入 250万 积分/百万 Token');
    expect(result.current.contextWindowLabel).toBe('100万 tokens');
    language.value = 'en-US';
    rerender();
    expect(result.current.formatPrice?.input.current).toBe('2.5M');
    expect(result.current.contextWindowLabel).toBe('1M tokens');
  });

  it('applies business pricing before formatting LobeHub credit prices', () => {
    useBusinessModelPricingMock.mockReturnValue(
      ({ pricing, model, provider }: { model?: string; pricing?: Pricing; provider?: string }) =>
        provider === 'lobehub' && model === 'test-model' ? discountedPricing : pricing,
    );

    const { result } = renderModelDetailPanelHook();

    expect(result.current.isCreditPricing).toBe(true);
    expect(result.current.formatPrice?.input).toEqual({ current: '2.5M', original: '5M' });
    expect(result.current.formatPrice?.output).toEqual({ current: '12.5M', original: '25M' });
    expect(result.current.formatPrice?.cachedInput).toEqual({
      current: '0.3M',
      original: '1M',
    });
    expect(result.current.hasCachedInputPricing).toBe(true);
    expect(result.current.getUnitPriceSuffix('millionTokens')).toBe(' credits/M tokens');
  });

  it('formats original unit prices for tiered and lookup units', () => {
    const { result } = renderModelDetailPanelHook({
      enabledList: createEnabledList('lobehub', unitPricing),
    });

    expect(result.current.formatUnitPrice(unitPricing.units[0])).toEqual({
      current: '20.0K',
      original: '50.0K',
    });
    expect(result.current.formatUnitPrice(unitPricing.units[1])).toEqual({
      current: '300.0K',
      original: '500.0K',
    });
  });

  it('uses the enabled model list hook when no list is provided', () => {
    useEnabledChatModelsMock.mockReturnValue(
      createEnabledList('lobehub', basePricing, {
        abilities: { reasoning: true },
      }),
    );

    const { result } = renderModelDetailPanelHook({ enabledList: undefined });

    expect(result.current.model?.id).toBe('test-model');
    expect(result.current.contextWindowLabel).toBe('1M tokens');
    expect(result.current.hasAbilities).toBe(true);
  });

  it('updates expanded detail sections', () => {
    const { result } = renderModelDetailPanelHook();

    act(() => {
      result.current.handleExpandedChange(['abilities']);
    });

    expect(updateExpandedKeysMock).toHaveBeenCalledWith(['abilities']);
  });
});
