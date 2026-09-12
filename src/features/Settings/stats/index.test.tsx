/**
 * @vitest-environment happy-dom
 */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import StatsSetting from './index';

let responsiveMobile = false;

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, gap, 'data-testid': testId }: any) => (
    <div data-gap={gap} data-testid={testId}>
      {children}
    </div>
  ),
  FormGroup: ({ children, extra, title }: any) => (
    <section>
      <header>
        <div data-testid="form-group-title">{title}</div>
        <div data-testid="form-group-extra">{extra}</div>
      </header>
      {children}
    </section>
  ),
  Grid: ({ children }: React.ComponentProps<'div'>) => <div>{children}</div>,
  Icon: () => null,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Tabs: ({ items }: { items: { key: string; label: string }[] }) => (
    <div>
      {items.map((item) => (
        <span key={item.key}>{item.label}</span>
      ))}
    </div>
  ),
  Text: ({ children }: React.ComponentProps<'span'>) => <span>{children}</span>,
}));

vi.mock('@lobehub/ui/icons', () => ({ ProviderIcon: () => null }));
vi.mock('antd', () => ({
  DatePicker: () => <div data-testid="month-filter" />,
  Divider: ({ dashed: _, ...rest }: React.ComponentProps<'hr'> & { dashed?: boolean }) => (
    <hr {...rest} />
  ),
}));
vi.mock('antd-style', () => ({
  createStaticStyles: () => ({ mobile: 'mobile', mobileUsageGroup: 'mobile-usage-group' }),
  useResponsive: () => ({ mobile: responsiveMobile }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh-CN' }, t: (key: string) => key }),
}));
vi.mock('@/components/AsyncBoundary', () => ({ default: ({ children }: any) => children }));
vi.mock('@/features/CustomerCenter/useMonthlyExchangeRate', () => ({
  useMonthlyExchangeRate: () => ({ notice: 'notice' }),
}));
vi.mock('@/features/Settings/features/SettingHeader', () => ({ default: () => null }));
vi.mock('@/libs/swr', () => ({
  useClientDataSWR: () => ({ data: [], error: undefined, isLoading: false, mutate: vi.fn() }),
}));
vi.mock('@/services/usage', () => ({
  usageService: { findAndGroupByDay: vi.fn() },
}));
vi.mock('./features/overview', () => ({
  ShareButton: () => <button type="button">share</button>,
  TotalAssistants: () => <div>assistants</div>,
  TotalMessages: () => <div>messages</div>,
  TotalTokens: () => <div>tokens</div>,
  TotalTopics: () => <div>topics</div>,
  Welcome: () => <div>welcome</div>,
}));
vi.mock('./features/rankings', () => ({
  AssistantsRank: () => null,
  ModelsRank: () => null,
  TopicsRank: () => null,
}));
vi.mock('./features/usage', () => ({
  UsageCards: () => <div>usage-cards</div>,
  UsageTable: () => <div>usage-table</div>,
  UsageTrends: () => <div>usage-trends</div>,
}));
vi.mock('./features/visualization', () => ({ AiHeatmaps: () => null }));

describe('StatsSetting overview layout', () => {
  beforeEach(() => {
    responsiveMobile = false;
  });

  it('automatically uses the mobile layout in a narrow container', () => {
    responsiveMobile = true;

    render(<StatsSetting />);

    expect(screen.getByTestId('mobile-stats-welcome-header')).toBeInTheDocument();
    expect(screen.getByTestId('overview-metrics')).toHaveStyle({
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    });
  });

  it('lets an explicit mobile prop override the responsive layout', () => {
    responsiveMobile = true;

    render(<StatsSetting mobile={false} />);

    expect(screen.queryByTestId('mobile-stats-welcome-header')).not.toBeInTheDocument();
    expect(screen.getByTestId('overview-metrics')).toHaveStyle({
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    });
  });

  it('keeps the welcome copy and share action in a dedicated mobile header row', () => {
    render(<StatsSetting mobile />);

    expect(screen.getByTestId('mobile-stats-welcome-header')).toHaveStyle({
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) 44px',
    });
  });

  it('uses exactly two bounded columns for the four mobile overview metrics', () => {
    render(<StatsSetting mobile />);

    expect(screen.getByTestId('overview-metrics')).toHaveStyle({
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    });
  });

  it('retains four overview columns on desktop', () => {
    render(<StatsSetting />);

    expect(screen.getByTestId('overview-metrics')).toHaveStyle({
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    });
  });

  it('keeps desktop section boundaries separated by the 24px content rhythm', () => {
    render(<StatsSetting />);

    expect(screen.getByTestId('overview-sections')).toHaveAttribute('data-gap', '24');
    expect(screen.getByTestId('usage-sections')).toHaveAttribute('data-gap', '24');
    expect(screen.getByTestId('usage-summary-sections')).toHaveAttribute('data-gap', '24');
    expect(screen.getByTestId('usage-table-section')).toContainElement(
      screen.getByText('usage-table'),
    );

    const dividers = within(screen.getByTestId('overview-sections')).getAllByRole('separator');
    expect(dividers).toHaveLength(2);
    dividers.forEach((divider) => expect(divider).toHaveStyle({ margin: 0 }));

    expect(within(screen.getByTestId('usage-summary-sections')).getByRole('separator')).toHaveStyle(
      { margin: 0 },
    );
  });

  it('keeps the compact 16px section rhythm on mobile', () => {
    render(<StatsSetting mobile />);

    expect(screen.getByTestId('overview-sections')).toHaveAttribute('data-gap', '16');
    expect(screen.getByTestId('usage-sections')).toHaveAttribute('data-gap', '16');
    expect(screen.getByTestId('usage-summary-sections')).toHaveAttribute('data-gap', '16');
  });

  it('moves the desktop usage filters (month picker and group-by tabs) to the form group extra on the right', () => {
    render(<StatsSetting />);

    const usageTitle = screen
      .getAllByTestId('form-group-title')
      .find((element) => element.textContent?.includes('tab.usage'));

    expect(usageTitle).toBeDefined();
    expect(within(usageTitle!).queryByTestId('month-filter')).not.toBeInTheDocument();
    expect(within(usageTitle!).queryByText('usage.welcome.model')).not.toBeInTheDocument();
    expect(within(usageTitle!).queryByText('usage.welcome.provider')).not.toBeInTheDocument();

    const usageHeader = usageTitle!.closest('header')!;
    const extra = within(usageHeader).getByTestId('form-group-extra');
    expect(within(extra).getByTestId('month-filter')).toBeInTheDocument();
    expect(within(extra).getByText('usage.welcome.model')).toBeInTheDocument();
    expect(within(extra).getByText('usage.welcome.provider')).toBeInTheDocument();
  });
});
