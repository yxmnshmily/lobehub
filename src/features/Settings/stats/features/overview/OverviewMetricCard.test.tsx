/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import OverviewMetricCard from './OverviewMetricCard';

vi.mock('@lobehub/ui/base-ui', () => ({
  Tag: ({ children, style }: React.ComponentProps<'span'>) => <span style={style}>{children}</span>,
}));
vi.mock('antd-style', () => ({
  cssVar: {
    colorSuccess: 'green',
    colorTextDescription: 'gray',
    colorWarning: 'orange',
  },
}));
vi.mock('@/components/StatisticCard', () => ({
  default: ({ statistic, title }: any) => (
    <div>
      {title}
      <div>{statistic.value}</div>
      {statistic.description}
    </div>
  ),
}));
vi.mock('@/components/StatisticCard/TitleWithPercentage', () => ({
  default: ({ title }: { title: string }) => <h2>{title}</h2>,
}));
vi.mock('@/components/Statistic', () => ({
  default: ({ title, value }: any) => (
    <div>
      <span>{value}</span>
      <span>{title}</span>
    </div>
  ),
}));

describe('OverviewMetricCard mobile typography', () => {
  it('keeps the title, growth, value and previous-month fragments intact', () => {
    render(
      <OverviewMetricCard
        mobile
        count={1348}
        prevCount={1200}
        previousTitle="上个月"
        previousValue="1,200"
        title="累计 Token 数"
        value="1.35K"
      />,
    );

    expect(screen.getByRole('heading', { name: '累计 Token 数' })).toHaveStyle({
      whiteSpace: 'nowrap',
    });
    expect(screen.getByText('+12.3%')).toHaveStyle({ whiteSpace: 'nowrap' });
    expect(screen.getByText('上个月')).toHaveStyle({ whiteSpace: 'nowrap' });
    expect(screen.getByText('1,200')).toHaveStyle({ whiteSpace: 'nowrap' });
  });
});
