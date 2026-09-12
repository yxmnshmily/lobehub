import { act, cleanup, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, expect, it, vi } from 'vitest';

import { useMonthlyExchangeRate } from './useMonthlyExchangeRate';

vi.unmock('react-i18next');
const quote = vi.hoisted(() => ({
  month: '2026-09',
  rate: 7,
  rateDate: '2026-09-07',
  updatedAt: '2026-09-07T10:00:00Z',
}));
const refetch = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    customerCenter: {
      getDisplayExchangeRate: {
        useQuery: () => ({
          data: quote,
          refetch,
        }),
      },
    },
  },
}));
afterEach(() => {
  cleanup();
  refetch.mockClear();
  vi.useRealTimers();
  quote.rate = 7;
  quote.month = '2026-09';
  quote.rateDate = '2026-09-07';
  quote.updatedAt = '2026-09-07T10:00:00Z';
});

const FreshAmount = () => {
  const { format, stale, notice } = useMonthlyExchangeRate();
  return (
    <p>
      {format(1)} {stale ? 'stale' : 'fresh'} {notice}
    </p>
  );
};

const Refresh = () => {
  useMonthlyExchangeRate(true);
  return null;
};

it('sends no periodic requests within the month and refreshes at the first Beijing midnight', async () => {
  const i18n = createInstance();
  await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: {} } } });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-01T00:00:00+08:00'));
  quote.rateDate = '2026-08-31';
  quote.updatedAt = '2026-08-31T16:00:00Z';
  const { unmount } = render(
    <I18nextProvider i18n={i18n}>
      <Refresh />
    </I18nextProvider>,
  );
  await act(() => vi.advanceTimersByTimeAsync(30 * 86_400_000 - 1));
  expect(refetch).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(refetch).toHaveBeenCalledTimes(1);
  unmount();
  await act(() => vi.advanceTimersByTimeAsync(86_400_000));
  expect(refetch).toHaveBeenCalledTimes(1);
});

it('keeps the monthly quote valid until Beijing month rollover and shows the new quote', async () => {
  const i18n = createInstance();
  await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: {} } } });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-07T10:05:00Z'));
  const view = (
    <I18nextProvider i18n={i18n}>
      <FreshAmount />
    </I18nextProvider>
  );
  const { rerender } = render(view);
  expect(screen.getByText(/fresh/)).toBeTruthy();
  expect(screen.getByText(/¥7.00/)).toBeTruthy();
  vi.setSystemTime(new Date('2026-09-30T15:59:59Z'));
  rerender(
    <I18nextProvider i18n={i18n}>
      <FreshAmount />
    </I18nextProvider>,
  );
  expect(screen.getByText(/fresh/)).toBeTruthy();
  vi.setSystemTime(new Date('2026-09-30T16:00:00Z'));
  rerender(
    <I18nextProvider i18n={i18n}>
      <FreshAmount />
    </I18nextProvider>,
  );
  expect(screen.getByText(/stale/)).toBeTruthy();
  quote.rate = 8;
  quote.month = '2026-10';
  quote.rateDate = '2026-09-30';
  quote.updatedAt = '2026-09-30T16:00:00Z';
  rerender(
    <I18nextProvider i18n={i18n}>
      <FreshAmount />
    </I18nextProvider>,
  );
  expect(screen.getByText(/fresh/)).toBeTruthy();
  expect(screen.getByText(/¥8.00/)).toBeTruthy();
  expect(screen.getByText(/每月1日/)).toBeTruthy();
  quote.rate = 7;
  quote.updatedAt = '2026-09-07T10:00:00Z';
  vi.useRealTimers();
});

it('updates mounted costs, original CNY prices and notices on a language switch', async () => {
  const i18n = createInstance();
  await i18n.init({
    lng: 'zh-CN',
    fallbackLng: 'en-US',
    resources: {
      'zh-CN': { translation: {} },
      'en-US': { translation: {} },
    },
  });
  const Amounts = () => {
    const { format, money, notice, symbol, convert, toUsd } = useMonthlyExchangeRate();
    return (
      <>
        <div data-testid="cost">{format(1)}</div>
        <div data-testid="plan">{money(70, 'CNY')}</div>
        <div data-testid="card">
          {symbol}
          {convert(1)}
        </div>
        <div data-testid="budget">{toUsd(convert(5))}</div>
        <p>{notice}</p>
      </>
    );
  };
  render(
    <I18nextProvider i18n={i18n}>
      <Amounts />
    </I18nextProvider>,
  );
  expect(screen.getByTestId('cost').textContent).toBe('¥7.00');
  expect(screen.getByTestId('plan').textContent).toBe('¥70.00');
  expect(screen.getByTestId('budget').textContent).toBe('5');
  await act(() => i18n.changeLanguage('en-US'));
  expect(screen.getByTestId('cost').textContent).toBe('$1.00');
  expect(screen.getByTestId('plan').textContent).toBe('$10.00');
  expect(screen.getByTestId('card').textContent).toBe('$1');
  expect(screen.getByTestId('budget').textContent).toBe('5');
  expect(screen.getByText(/USD amounts/)).toBeTruthy();
  await act(() => i18n.changeLanguage('zh-CN'));
  expect(screen.getByTestId('cost').textContent).toBe('¥7.00');
});
