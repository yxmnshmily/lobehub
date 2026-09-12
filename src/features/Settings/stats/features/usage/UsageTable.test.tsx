/**
 * @vitest-environment happy-dom
 */
import { TooltipGroup } from '@lobehub/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import spend from '@/locales/default/spend';

import zhSpend from '../../../../../../locales/zh-CN/spend.json';
import UsageTable from './UsageTable';

let mobile = false;
const mutateMock = vi.hoisted(() => vi.fn());
let swrState: { data?: typeof rows; error?: unknown; isLoading: boolean };

vi.mock('antd-style', () => ({
  createStaticStyles: (
    factory: (input: { css: typeof String.raw; cssVar: Record<string, string> }) => unknown,
  ) =>
    factory({
      css: String.raw,
      cssVar: new Proxy({}, { get: () => '' }),
    }),
  cssVar: { colorBgContainer: 'white' },
  useResponsive: () => ({ mobile }),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    customerCenter: {
      getDisplayExchangeRate: { useQuery: () => ({ data: undefined }) },
    },
  },
}));

vi.unmock('react-i18next');
vi.mock('@/components/LobeIcons', () => ({
  ProviderIcon: ({ provider }: { provider: string }) => <span>{provider}</span>,
}));

const rows = Array.from({ length: 12 }, (_, index) => ({
  createdAt: new Date(2026, 0, index + 1).toISOString(),
  id: `row-${index + 1}`,
  model: 'gpt-5-mini',
  provider: 'openai',
  spend: index,
  totalInputTokens: index,
  totalOutputTokens: index,
  totalTokens: index * 2,
  tps: 1,
  ttft: 1,
  type: index === 0 ? 'speechRecognition' : 'chat',
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: () => ({ ...swrState, mutate: mutateMock }),
}));

vi.mock('@/services/usage', () => ({
  usageService: { findByMonth: vi.fn() },
}));

// Keep pagination lightweight while exercising the actual type column renderer.
vi.mock('@/components/InlineTable', () => ({
  default: ({
    className,
    columns,
    dataSource,
    scroll,
    tableLayout,
  }: {
    className?: string;
    columns?: {
      dataIndex?: string;
      key?: string;
      render?: (value: unknown, record: (typeof rows)[number]) => ReactNode;
      responsive?: string[];
      width?: number;
    }[];
    dataSource?: typeof rows;
    scroll?: { x?: string };
    tableLayout?: string;
  }) => (
    <div
      data-class-name={className ?? 'none'}
      data-column-widths={columns?.map((column) => column.width ?? 'auto').join(',')}
      data-scroll-x={scroll?.x ?? 'none'}
      data-table-layout={tableLayout ?? 'auto'}
      data-testid="rows"
      data-visible-columns={columns
        ?.filter((column) => !mobile || !column.responsive?.includes('sm'))
        .map((column) => column.key)
        .join(',')}
    >
      {dataSource?.map((row) => row.id).join(',')}
      <div data-testid="token-cell">
        {dataSource?.[0] &&
          columns
            ?.find((column) => column.key === 'totalTokens')
            ?.render?.(dataSource[0].totalTokens, dataSource[0])}
        {dataSource?.map((row) => (
          <div data-testid={`type-${row.id}`} key={row.id}>
            {columns?.find((column) => column.dataIndex === 'type')?.render?.(row.type, row)}
          </div>
        ))}
      </div>
    </div>
  ),
}));

// Stands in for the real footer, whose `onChange` likewise reports the page and
// the page size together on every interaction.
vi.mock('@/components/TablePagination', () => ({
  default: ({
    className,
    current,
    onChange,
    pageSize,
  }: {
    className?: string;
    current: number;
    onChange: (page: number, size: number) => void;
    pageSize: number;
  }): ReactNode => (
    <div data-pagination-style={className} data-testid="pagination">
      <button type="button" onClick={() => onChange(current + 1, pageSize)}>
        next-page
      </button>
      <button type="button" onClick={() => onChange(1, 10)}>
        resize
      </button>
    </div>
  ),
}));

vi.mock('@/components/TotalToken', () => ({
  default: () => <span>detailed-token-breakdown</span>,
}));

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

const renderTable = () =>
  render(
    <MemoryRouter>
      <UsageTable />
    </MemoryRouter>,
  );

describe('UsageTable', () => {
  beforeEach(() => {
    mobile = false;
    mutateMock.mockReset();
    swrState = { data: rows, isLoading: false };
  });

  it.each([
    ['en-US', 'Voice Transcription'],
    ['zh-CN', '语音转写'],
  ])('renders the speech-recognition icon and label in %s', async (lng, label) => {
    const i18n = createInstance();
    await i18n.init({
      lng,
      resources: { 'en-US': { spend }, 'zh-CN': { spend: zhSpend } },
    });
    render(
      <I18nextProvider i18n={i18n}>
        <TooltipGroup popupContainer={document.body}>
          <MemoryRouter>
            <UsageTable />
          </MemoryRouter>
        </TooltipGroup>
      </I18nextProvider>,
    );

    const cell = screen.getByTestId('type-row-1');
    expect(cell.querySelector('svg.lucide-mic')).toBeInTheDocument();
    expect(cell.querySelector('svg.lucide-circle-dot-dashed')).not.toBeInTheDocument();
    await userEvent.hover(cell.querySelector('svg')!);
    expect(await screen.findByText(label)).toBeInTheDocument();
  });

  it('moves to the next page when only the page changes', async () => {
    renderTable();
    expect(screen.getByTestId('rows')).toHaveTextContent('row-1,row-2,row-3,row-4,row-5');

    // Page and page size are written in one update. Writing them through two
    // separate query-param setters lost the page, because the second setter
    // rebuilt the URL from the params captured before the first one navigated.
    await userEvent.click(screen.getByText('next-page'));

    expect(screen.getByTestId('rows')).toHaveTextContent('row-6,row-7,row-8,row-9,row-10');
  });

  it('keeps the page the size picker asked for when the page size changes', async () => {
    renderTable();

    await userEvent.click(screen.getByText('next-page'));
    await userEvent.click(screen.getByText('resize'));

    expect(screen.getByTestId('rows')).toHaveTextContent(
      'row-1,row-2,row-3,row-4,row-5,row-6,row-7,row-8,row-9,row-10',
    );
  });

  it('keeps mobile usage columns readable with native horizontal scrolling', () => {
    mobile = true;

    renderTable();

    const table = screen.getByTestId('rows');
    expect(table).toHaveAttribute('data-scroll-x', 'max-content');
    expect(table).toHaveAttribute('data-table-layout', 'auto');
    expect(table).toHaveAttribute('data-class-name', 'none');
    expect(table).toHaveAttribute('data-column-widths', '150,80,auto,180,auto,auto,auto');
    expect(table).toHaveAttribute('data-visible-columns', 'createdAt,model,totalTokens,spend');
    expect(screen.getByTestId('token-cell')).toHaveTextContent('detailed-token-breakdown');

    const paginationStyle = screen.getByTestId('pagination').getAttribute('data-pagination-style');

    expect(paginationStyle).toMatch(/@media\s*\(width\s*<=\s*575\.98px\)/);
    expect(paginationStyle).toMatch(/overflow:\s*visible/);
    expect(paginationStyle).toMatch(/flex-wrap:\s*wrap/);
  });

  it('shows a retryable error instead of an empty table when loading fails', async () => {
    swrState = { error: new Error('usage request failed'), isLoading: false };

    renderTable();

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load');
    expect(screen.queryByTestId('rows')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mutateMock).toHaveBeenCalledOnce();
  });
});
