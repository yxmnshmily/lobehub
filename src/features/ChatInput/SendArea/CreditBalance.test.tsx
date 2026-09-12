import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import CreditBalance from './CreditBalance';
import { openCreditDialog } from './openCreditDialog';

vi.mock('./openCreditDialog', () => ({ openCreditDialog: vi.fn() }));

const state = vi.hoisted(() => ({
  balance: 49661 as number | undefined,
  error: false,
  loggedIn: true,
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    customerCenter: {
      getOverview: {
        useQuery: () => ({
          data: { credits: { account: { availableCredits: state.balance } } },
          isError: state.error,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));
vi.mock('@/libs/better-auth/auth-client', () => ({
  useSession: () => ({ data: state.loggedIn ? { user: { id: 'user' } } : null }),
}));
vi.mock('@/utils/i18n/travel', () => ({
  getTravelLocale: () => 'zh-CN',
  useTravelTranslation: () => (text: string) => text,
}));
beforeEach(() => {
  state.balance = 49661;
  state.error = false;
  state.loggedIn = true;
});
afterEach(cleanup);

it('shows actual available credits and opens the balance actions', async () => {
  render(<CreditBalance />);
  fireEvent.click(screen.getByRole('button', { name: /积分额度/ }));
  expect(await screen.findByText('49,661')).toBeInTheDocument();
  fireEvent.click(await screen.findByText('充值积分'));
  expect(openCreditDialog).toHaveBeenCalledWith('credits');
});
it('shows zero as a valid balance', () => {
  state.balance = 0;
  render(<CreditBalance />);
  expect(screen.getByRole('button', { name: /积分额度/ })).toHaveTextContent('0');
});
it('does not present cached credits as current when the request fails', () => {
  state.error = true;
  render(<CreditBalance />);
  expect(screen.getByRole('button', { name: /积分额度/ })).toHaveTextContent('—');
});
it('does not show a balance for a signed-out visitor', () => {
  state.loggedIn = false;
  render(<CreditBalance />);
  expect(screen.queryByRole('button', { name: /积分额度/ })).toBeNull();
});
