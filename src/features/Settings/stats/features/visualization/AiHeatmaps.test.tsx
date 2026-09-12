/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AiHeatmaps from './AiHeatmaps';

const heatmapsPropsMock = vi.hoisted(() => vi.fn());
const mutateMock = vi.hoisted(() => vi.fn());
let swrState: { data?: { count: number; date: string; level: number }[]; error?: unknown };

vi.mock('@lobehub/charts', () => ({
  Heatmaps: (props: unknown) => {
    heatmapsPropsMock(props);
    return <div>Heatmaps</div>;
  },
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, ...props }: React.ComponentProps<'div'>) => (
    <div {...props}>{children}</div>
  ),
  Icon: () => <span />,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Tabs: () => <div />,
  Tag: ({ children }: React.ComponentProps<'span'>) => <span>{children}</span>,
}));
vi.mock('antd-style', () => ({
  createStaticStyles: (factory: (helpers: { css: () => string }) => unknown) =>
    factory({ css: () => 'test-class' }),
  cssVar: { colorTextDescription: 'gray' },
  useResponsive: () => ({ mobile: true }),
}));

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
    ...swrState,
    isLoading: false,
    mutate: mutateMock,
  }),
}));
vi.mock('@/libs/swr/keys', () => ({ statsKeys: { heatmaps: () => ['heatmaps'] } }));
vi.mock('@/services/message', () => ({
  messageService: { getHeatmaps: vi.fn(), getTokenHeatmaps: vi.fn() },
}));
vi.mock('../components/StatsFormGroup', () => ({
  default: ({ children }: React.ComponentProps<'div'>) => <div>{children}</div>,
}));
vi.mock('./HeatmapStats', () => ({ default: () => <div>Heatmap stats</div> }));
vi.mock('@/components/AsyncBoundary', () => ({
  default: ({ children, data, error, onRetry }: any) =>
    error && data === undefined ? (
      <div role="alert">
        Unable to load
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      </div>
    ) : (
      children
    ),
}));

describe('AiHeatmaps share layout', () => {
  beforeEach(() => {
    mutateMock.mockReset();
    swrState = { data: [{ count: 0, date: '2026-08-09', level: 0 }] };
  });

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

  it('keeps the mobile heatmap swipeable without exposing a horizontal scrollbar', () => {
    render(<AiHeatmaps mobile />);

    const heatmap = screen.getByText('Heatmaps');
    expect(heatmap.parentElement?.style.maxWidth).toBe('100%');
    expect(heatmap.parentElement?.style.overflowX).toBe('auto');
    expect(heatmap.parentElement?.style.scrollbarWidth).toBe('none');
    expect(heatmapsPropsMock).toHaveBeenLastCalledWith(expect.objectContaining({ blockSize: 6 }));
  });

  it('shows a retryable error instead of a permanent loading heatmap', async () => {
    swrState = { error: new Error('heatmap request failed') };

    render(<AiHeatmaps />);

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load');
    expect(screen.queryByText('Heatmaps')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mutateMock).toHaveBeenCalledOnce();
  });
});
