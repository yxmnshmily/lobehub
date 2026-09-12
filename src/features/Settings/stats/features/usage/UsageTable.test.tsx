/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@lobehub/icons', () => ({
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
  type: 'chat',
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: () => ({ ...swrState, mutate: mutateMock }),
}));

vi.mock('@/services/usage', () => ({
  usageService: { findByMonth: vi.fn() },
}));

// The rows on screen are the assertion, so the table only has to report which
// slice it was handed.
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
