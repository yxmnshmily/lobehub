import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import SubscriptionWorkspace from './SubscriptionWorkspace';

vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: (selector: any) =>
    selector({
      useFetchAiProviderRuntimeState: () => ({
        data: {
          enabledChatModelList: [
            {
              id: 'test',
              children: [2, 4].map((rate) => ({
                id: `model-${rate}`,
                pricing: {
                  currency: 'USD',
                  units: [
                    { name: 'textInput', strategy: 'fixed', unit: 'millionTokens', rate },
                    {
                      name: 'textOutput',
                      strategy: 'fixed',
                      unit: 'millionTokens',
                      rate: rate * 4,
                    },
                  ],
                },
              })),
            },
          ],
        },
      }),
    }),
}));

const queries = vi.hoisted(() => ({ overview: vi.fn(), details: vi.fn() }));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    customerCenter: {
      getOverview: { useQuery: queries.overview },
      getUsageDetails: { useQuery: queries.details },
      getDisplayExchangeRate: { useQuery: () => ({ data: { rate: 7 } }) },
    },
  },
}));
vi.mock('./CreditsOrders', () => ({ default: () => null }));
vi.mock('./CreditLedger', () => ({ default: () => null }));
vi.mock('@/utils/i18n/travel', () => ({
  getTravelLocale: () => 'zh-CN',
  translateTravel: (value: string) => value,
  useTravelTranslation: () => (value: string) => value,
}));
afterEach(cleanup);
beforeEach(() => {
  queries.overview.mockReturnValue({
    data: { credits: { account: { availableCredits: 12345, balanceCredits: 12345 } }, usage: null },
  });
  queries.details.mockReturnValue({
    data: [
      {
        id: 'message:a',
        createdAt: '2026-09-01T00:00:00Z',
        kind: 'chat',
        model: 'test-model',
        inputTokens: 100,
        outputTokens: 25,
        totalTokens: 125,
      },
      {
        id: 'message:b',
        createdAt: '2026-09-02T00:00:00Z',
        kind: 'chat',
        model: 'test-model',
        inputTokens: 200,
        outputTokens: null,
        totalTokens: null,
      },
    ],
  });
});

it('shows a clearly labelled measured subtotal instead of discarding incomplete usage', () => {
  render(
    <MemoryRouter>
      <SubscriptionWorkspace section="usage" />
    </MemoryRouter>,
  );
  expect(screen.getByRole('main', { name: '账户用量' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '账户用量' })).toBeNull();
  expect(screen.getByText('12,345')).toBeTruthy();
  expect(screen.getByText('最近记录 Token 用量')).toBeTruthy();
  expect(screen.getByText('300')).toBeTruthy();
  expect(screen.getByText('— 积分')).toBeTruthy();
  expect(screen.getByText(/仅汇总已记录的数值/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '查看实际积分扣费' })).toHaveAttribute(
    'href',
    '/settings/credits#credit-ledger',
  );
});

it('keeps complete lifetime totals instead of replacing them with the recent subtotal', () => {
  const metric = (value: number) => ({ available: true, value });
  queries.overview.mockReturnValue({
    data: {
      credits: { account: { availableCredits: 12345, balanceCredits: 12345 } },
      usage: {
        canonicalTotals: {
          totalInputTokens: metric(1000),
          totalOutputTokens: metric(500),
          totalTokens: metric(1500),
        },
      },
    },
  });
  render(
    <MemoryRouter>
      <SubscriptionWorkspace section="usage" />
    </MemoryRouter>,
  );
  expect(screen.getByText('总 Token 用量')).toBeTruthy();
  expect(screen.getByText('1500')).toBeTruthy();
  expect(screen.getByText('6,000 积分')).toBeTruthy();
  expect(screen.getByText('2,000 积分')).toBeTruthy();
  expect(screen.getByText('4,000 积分')).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: /估算模型|Estimate model/ }), {
    target: { value: 'model-4' },
  });
  expect(screen.getByText('12,000 积分')).toBeTruthy();
  expect(screen.getByText('8,000 积分')).toBeTruthy();
  expect(screen.queryByText('最近记录 Token 用量')).toBeNull();
});

it('does not claim a recent subtotal when the details query failed', () => {
  queries.details.mockReturnValue({ isError: true, refetch: vi.fn() });
  render(
    <MemoryRouter>
      <SubscriptionWorkspace section="usage" />
    </MemoryRouter>,
  );
  expect(screen.getByText('用量记录暂时无法读取')).toBeTruthy();
  expect(screen.queryByText('最近记录 Token 用量')).toBeNull();
});
