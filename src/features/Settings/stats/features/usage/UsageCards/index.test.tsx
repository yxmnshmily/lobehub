/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import UsageCards from './index';

const childPropsMock = vi.hoisted(() => vi.fn());

vi.mock('./TodaySpend', () => ({
  default: (props: unknown) => {
    childPropsMock('today', props);
    return <div>today</div>;
  },
}));
vi.mock('./MonthSpend', () => ({
  default: (props: unknown) => {
    childPropsMock('month', props);
    return <div>month</div>;
  },
}));
vi.mock('./ActiveModels', () => ({
  default: (props: unknown) => {
    childPropsMock('models', props);
    return <div>models</div>;
  },
}));

describe('UsageCards', () => {
  it('uses two readable columns and gives active models the full row on mobile', () => {
    render(<UsageCards mobile />);

    const layout = screen.getByTestId('mobile-usage-cards');
    expect(layout).toHaveStyle({
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    });
    expect(screen.getByText('models').parentElement).toHaveStyle({ gridColumn: '1 / -1' });
    expect(childPropsMock).toHaveBeenCalledWith('today', expect.objectContaining({ mobile: true }));
    expect(childPropsMock).toHaveBeenCalledWith('month', expect.objectContaining({ mobile: true }));
    expect(childPropsMock).toHaveBeenCalledWith('models', expect.objectContaining({ mobile: true }));
  });
});
