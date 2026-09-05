import { render, screen } from '@testing-library/react';
import type { HTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomerRecordsView } from './TravelServiceLedgerView';

const mocks = vi.hoisted(() => ({
  entriesQuery: vi.fn(),
  ordersQuery: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Block: ({ children }: HTMLAttributes<HTMLDivElement>) => <div>{children}</div>,
  Flexbox: ({ children }: HTMLAttributes<HTMLDivElement>) => <div>{children}</div>,
  Input: () => null,
  TextArea: () => null,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: () => null,
  Select: () => null,
  Text: ({ as: Component = 'span', children }: { as?: 'h2' | 'span'; children: ReactNode }) => (
    <Component>{children}</Component>
  ),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    travelServiceLedger: {
      listEntries: { useQuery: mocks.entriesQuery },
      listOrders: { useQuery: mocks.ordersQuery },
    },
  },
}));

describe('CustomerRecordsView safe customer DTO compatibility', () => {
  beforeEach(() => {
    mocks.entriesQuery.mockReturnValue({
      data: [
        {
          amountFen: -12_800,
          balanceAfterFen: 87_200,
          createdAt: new Date('2026-09-03T08:00:00.000Z'),
          id: 'INTERNAL_ENTRY_ID_MUST_NOT_RENDER',
          reason: 'INTERNAL_REASON_MUST_NOT_RENDER',
          type: 'service_charge',
        },
        {
          amountFen: 20_000,
          balanceAfterFen: 107_200,
          createdAt: new Date('2026-09-03T09:00:00.000Z'),
          type: 'manual_adjustment',
        },
      ],
      error: undefined,
      isLoading: false,
    });
    mocks.ordersQuery.mockReturnValue({
      data: [
        {
          amountFen: 38_800,
          createdAt: new Date('2026-09-03T07:00:00.000Z'),
          id: 'order-safe-opaque-id',
          status: 'completed',
          title: '九寨沟行程策划',
        },
      ],
      error: undefined,
      isLoading: false,
    });
  });

  it('renders customer ledger rows from safe fields without an internal id or reason', () => {
    render(<CustomerRecordsView />);

    expect(screen.getByText('服务扣减')).toBeTruthy();
    expect(screen.getByText('人工入账')).toBeTruthy();
    expect(screen.getByText(/余额 ¥872\.00/)).toBeTruthy();
    expect(screen.getByText(/余额 ¥1072\.00/)).toBeTruthy();
    expect(screen.queryByText('INTERNAL_ENTRY_ID_MUST_NOT_RENDER')).toBeNull();
    expect(screen.queryByText('INTERNAL_REASON_MUST_NOT_RENDER')).toBeNull();
  });

  it('keeps the opaque order id hidden while rendering the customer-safe order', () => {
    render(<CustomerRecordsView />);

    expect(screen.getByText('九寨沟行程策划')).toBeTruthy();
    expect(screen.getByText(/已完成/)).toBeTruthy();
    expect(screen.getByText('¥388.00')).toBeTruthy();
    expect(screen.queryByText('order-safe-opaque-id')).toBeNull();
  });
});
