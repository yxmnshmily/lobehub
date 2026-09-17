import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GoalProgress } from './GoalProgress';

vi.mock('@/features/CustomerCenter/useMonthlyExchangeRate', () => ({
  useMonthlyExchangeRate: () => ({ format: () => '¥0.110167', notice: '月度参考汇率' }),
}));

describe('goal list usage', () => {
  it('shows equivalent credits from recorded cost rather than a currency amount', () => {
    render(
      <GoalProgress
        findingCount={0}
        pendingDecisions={0}
        taskDone={0}
        taskTotal={0}
        totalRunCost={0.015301}
        totalRunDuration={120000}
      />,
    );
    expect(screen.getByText(/15,301/)).toBeVisible();
    expect(screen.queryByText('¥0.110167')).not.toBeInTheDocument();
  });
  it('does not turn missing or invalid cost into zero credits', () => {
    render(
      <GoalProgress
        findingCount={0}
        pendingDecisions={0}
        taskDone={0}
        taskTotal={0}
        totalRunCost={Number.NaN}
        totalRunDuration={0}
      />,
    );
    expect(screen.queryByText(/NaN|Infinity|0 credits/)).not.toBeInTheDocument();
  });
});
