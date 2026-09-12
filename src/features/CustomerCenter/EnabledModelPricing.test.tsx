import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import EnabledModelPricing, { formatModelRate } from './EnabledModelPricing';

const query = vi.hoisted(() => ({
  data: undefined as any,
  error: undefined as unknown,
  isLoading: false,
  mutate: vi.fn(),
}));
vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: (selector: any) => selector({ useFetchAiProviderRuntimeState: () => query }),
}));
vi.mock('./useMonthlyExchangeRate', () => ({
  useMonthlyExchangeRate: () => ({
    quote: { rate: 7, rateDate: '2026-09-01' },
    stale: false,
    isCny: true,
    notice: '每月1日更新',
  }),
}));
vi.mock('@/utils/i18n/travel', () => ({ useTravelTranslation: () => (text: string) => text }));
afterEach(() => {
  cleanup();
  query.data = undefined;
  query.error = undefined;
});

it('converts USD to CNY, preserves CNY and zero, and shows tiered ranges', () => {
  expect(
    formatModelRate(
      { name: 'textInput', unit: 'millionTokens', strategy: 'fixed', rate: 2 },
      'USD',
      7,
      'zh-CN',
    ),
  ).toBe('¥14.00');
  expect(
    formatModelRate(
      { name: 'textInput', unit: 'millionTokens', strategy: 'fixed', rate: 2 },
      'CNY',
      7,
      'zh-CN',
    ),
  ).toBe('¥2.00');
  expect(
    formatModelRate(
      { name: 'textInput', unit: 'millionTokens', strategy: 'fixed', rate: 0 },
      'USD',
      7,
      'zh-CN',
    ),
  ).toBe('¥0.00');
  expect(
    formatModelRate(
      {
        name: 'textInput',
        unit: 'millionTokens',
        strategy: 'tiered',
        tiers: [
          { upTo: 100, rate: 1 },
          { upTo: 'infinity', rate: 2 },
        ],
      },
      'USD',
      7,
      'zh-CN',
    ),
  ).toBe('¥7.00 – ¥14.00');
});

it('does not invent prices for missing, negative, or unsupported-currency data', () => {
  expect(formatModelRate(undefined, 'USD', 7, 'zh-CN')).toBeNull();
  expect(
    formatModelRate(
      { name: 'textInput', unit: 'millionTokens', strategy: 'fixed', rate: -1 },
      'USD',
      7,
      'zh-CN',
    ),
  ).toBeNull();
  expect(
    formatModelRate(
      { name: 'textInput', unit: 'millionTokens', strategy: 'fixed', rate: 2 },
      'EUR',
      7,
      'zh-CN',
    ),
  ).toBeNull();
});

it('lists enabled runtime models with their own price units and missing-price state', () => {
  query.data = {
    enabledChatModelList: [
      {
        id: 'test-provider',
        name: 'Test provider',
        children: [
          {
            id: 'priced',
            displayName: 'Priced model',
            pricing: {
              currency: 'USD',
              units: [{ name: 'textInput', unit: 'millionTokens', strategy: 'fixed', rate: 2 }],
            },
          },
          { id: 'unpriced', displayName: 'Unpriced model' },
        ],
      },
    ],
    enabledImageModelList: [
      {
        id: 'test-provider',
        name: 'Test provider',
        children: [
          {
            id: 'image',
            displayName: 'Image model',
            pricing: {
              currency: 'CNY',
              units: [{ name: 'imageGeneration', unit: 'image', strategy: 'fixed', rate: 1 }],
            },
          },
        ],
      },
    ],
  };
  render(<EnabledModelPricing />);
  expect(screen.getByText('¥14.00')).toBeTruthy();
  expect(screen.getByText('¥1.00')).toBeTruthy();
  expect(screen.getByText('/ 百万 Token')).toBeTruthy();
  expect(screen.getByText('/ 张')).toBeTruthy();
  expect(
    within(screen.getByText('Unpriced model').closest('tr')!).getAllByText('未配置价格').length,
  ).toBeGreaterThan(0);
});

it('shows an actionable error instead of an empty list when model loading fails', () => {
  query.error = new Error('offline');
  render(<EnabledModelPricing />);
  expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  expect(screen.queryByText('暂无已启用模型')).toBeNull();
});

it('paginates enabled models in fixed pages of 20 and clamps a shrinking list', () => {
  const children = Array.from({ length: 41 }, (_, index) => ({
    id: `model-${index + 1}`,
    displayName: `Model ${index + 1}`,
  }));
  query.data = { enabledChatModelList: [{ id: 'test', children }] };
  const { rerender } = render(<EnabledModelPricing />);
  expect(screen.getAllByRole('row')).toHaveLength(21);
  expect(screen.getByText('Model 1')).toBeTruthy();
  expect(screen.queryByText('Model 21')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '2' }));
  expect(screen.getAllByRole('row')).toHaveLength(21);
  expect(screen.getByText('Model 21')).toBeTruthy();
  expect(screen.queryByText('Model 1')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '3' }));
  expect(screen.getAllByRole('row')).toHaveLength(2);
  expect(screen.getByText('Model 41')).toBeTruthy();
  query.data = { enabledChatModelList: [{ id: 'test', children: children.slice(0, 5) }] };
  rerender(<EnabledModelPricing />);
  expect(screen.getAllByRole('row')).toHaveLength(6);
  expect(screen.getByText('Model 1')).toBeTruthy();
});

vi.mock('@lobehub/icons', () => ({
  ModelIcon: ({ model }: { model: string }) => <span data-testid={`model-logo-${model}`} />,
}));

it('merges provider duplicates into one model with a logo and retains configured pricing', () => {
  query.data = {
    enabledChatModelList: [
      {
        id: 'openai',
        name: 'OpenAI',
        children: [
          {
            id: 'gpt-5.6-terra',
            displayName: 'GPT-5.6 Terra',
            pricing: {
              currency: 'USD',
              units: [{ name: 'textInput', unit: 'millionTokens', strategy: 'fixed', rate: 2 }],
            },
          },
        ],
      },
      {
        id: 'chatgpt',
        name: 'ChatGPT',
        children: [{ id: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra' }],
      },
    ],
  };
  render(<EnabledModelPricing />);
  expect(screen.getAllByRole('row')).toHaveLength(2);
  expect(screen.getByTestId('model-logo-gpt-5.6-terra')).toBeTruthy();
  expect(screen.getByText('¥14.00')).toBeTruthy();
  expect(screen.queryByText('未配置价格')).toBeNull();
  expect(screen.getByText(/OpenAI.*ChatGPT/)).toBeTruthy();
});

it('keeps different provider quotes inside the same model row', () => {
  query.data = {
    enabledChatModelList: [2, 3].map((rate) => ({
      id: `provider-${rate}`,
      name: `Provider ${rate}`,
      children: [
        {
          id: 'same-model',
          displayName: 'Shared model',
          pricing: {
            currency: 'USD',
            units: [{ name: 'textInput', unit: 'millionTokens', strategy: 'fixed', rate }],
          },
        },
      ],
    })),
  };
  render(<EnabledModelPricing />);
  expect(screen.getAllByRole('row')).toHaveLength(2);
  const row = screen.getByText('Shared model').closest('tr')!;
  expect(within(row).getByText('¥14.00')).toBeTruthy();
  expect(within(row).getByText('¥21.00')).toBeTruthy();
});

it('gives the pricing table a readable minimum width inside its mobile scroll region', () => {
  query.data = {
    enabledChatModelList: [
      {
        id: 'deepseek',
        children: [{ id: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash' }],
      },
    ],
  };
  render(<EnabledModelPricing />);

  const region = screen.getByRole('region', { name: '模型价格表' });
  const stylesheet = [...document.querySelectorAll('style')]
    .map((node) => node.textContent)
    .join('\n')
    .replaceAll(/\s/g, '');

  expect(region.querySelector('table')).toBeTruthy();
  expect(stylesheet).toMatch(new RegExp(`\\.${region.className}\\{[^}]*overflow-x:auto`));
  expect(stylesheet).toMatch(new RegExp(`\\.${region.className}table\\{[^}]*min-width:720px`));
});
