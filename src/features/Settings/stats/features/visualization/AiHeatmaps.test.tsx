/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AiHeatmaps from './AiHeatmaps';

const heatmapsPropsMock = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/charts', () => ({
  Heatmaps: (props: unknown) => {
    heatmapsPropsMock(props);
    return <div>Heatmaps</div>;
  },
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: React.ComponentProps<'div'>) => <div>{children}</div>,
  Icon: () => <span />,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Tabs: () => <div />,
  Tag: ({ children }: React.ComponentProps<'span'>) => <span>{children}</span>,
}));
vi.mock('antd-style', () => ({ cssVar: { colorTextDescription: 'gray' } }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'heatmaps.months.apr': '四月',
        'heatmaps.months.aug': '八月',
        'heatmaps.months.dec': '十二月',
        'heatmaps.months.feb': '二月',
        'heatmaps.months.jan': '一月',
        'heatmaps.months.jul': '七月',
        'heatmaps.months.jun': '六月',
        'heatmaps.months.mar': '三月',
        'heatmaps.months.may': '五月',
        'heatmaps.months.nov': '十一月',
        'heatmaps.months.oct': '十月',
        'heatmaps.months.sep': '九月',
      })[key] || key,
  }),
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: () => ({
    data: [{ count: 0, date: '2026-08-09', level: 0 }],
    isLoading: false,
  }),
}));
vi.mock('@/libs/swr/keys', () => ({ statsKeys: { heatmaps: () => ['heatmaps'] } }));
vi.mock('@/services/message', () => ({
  messageService: { getHeatmaps: vi.fn(), getTokenHeatmaps: vi.fn() },
}));

describe('AiHeatmaps share layout', () => {
  it('renders non-truncated month labels with the month suffix in the exported card', () => {
    render(<AiHeatmaps inShare />);

    expect(screen.getByText('1月')).toBeInTheDocument();
    expect(screen.getByText('10月')).toBeInTheDocument();
    expect(screen.getByText('11月')).toBeInTheDocument();
    expect(screen.getByText('12月')).toBeInTheDocument();
    expect(screen.getByText('8月').parentElement).toHaveStyle({
      display: 'grid',
      fontSize: '10px',
      gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
      textAlign: 'center',
    });
    expect(heatmapsPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        hideMonthLabels: true,
      }),
    );
  });
});
