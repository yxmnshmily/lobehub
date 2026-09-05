import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CreditsOrders from './CreditsOrders';

const mocks = vi.hoisted(() => ({
  cancelOrder: vi.fn(),
  createOrder: vi.fn(),
  ordersQuery: {
    data: undefined as
      | Array<{
          amountMinor: number;
          createdAt: Date;
          credits: number;
          currency: string;
          expiresAt: Date | null;
          id: string;
          productId: string;
          refundStatus: string;
          status: string;
          updatedAt: Date;
          version: number;
        }>
      | undefined,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    platformCreditPurchase: {
      cancelOrder: { useMutation: () => ({ mutateAsync: mocks.cancelOrder }) },
      createOrder: { useMutation: () => ({ mutateAsync: mocks.createOrder }) },
      listOrders: { useQuery: () => mocks.ordersQuery },
    },
  },
}));

beforeEach(() => {
  mocks.cancelOrder.mockReset().mockResolvedValue({ status: 'cancelled' });
  mocks.createOrder.mockReset().mockResolvedValue({ status: 'created' });
  mocks.ordersQuery.refetch.mockReset().mockResolvedValue(undefined);
  Object.assign(mocks.ordersQuery, {
    data: [
      {
        amountMinor: 100,
        createdAt: new Date('2026-09-04T08:00:00.000Z'),
        credits: 1_000_000,
        currency: 'USD',
        expiresAt: null,
        id: '11111111-1111-4111-8111-111111111111',
        productId: 'credits-1m',
        refundStatus: 'none',
        status: 'created',
        updatedAt: new Date('2026-09-04T08:00:00.000Z'),
        version: 3,
      },
      {
        amountMinor: 100,
        createdAt: new Date('2026-09-03T08:00:00.000Z'),
        credits: 1_000_000,
        currency: 'USD',
        expiresAt: null,
        id: '22222222-2222-4222-8222-222222222222',
        productId: 'credits-1m',
        refundStatus: 'none',
        status: 'cancelled',
        updatedAt: new Date('2026-09-03T09:00:00.000Z'),
        version: 2,
      },
    ],
    isError: false,
    isLoading: false,
  });
});

afterEach(cleanup);

describe('CreditsOrders', () => {
  it('shows the server-owned package, current-user orders, and payment-free boundary', () => {
    render(<CreditsOrders locale="zh-CN" />);

    expect(screen.getAllByText('1,000,000 Credits')).toHaveLength(3);
    expect(screen.getAllByText('US$1.00').length).toBeGreaterThan(0);
    expect(screen.getByText('待支付')).toBeTruthy();
    expect(screen.getByText('已取消')).toBeTruthy();
    expect(screen.getByText(/尚未接入支付渠道/)).toBeTruthy();
    expect(screen.getByText(/不会自动增加 Credits/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^(?:支付|立即到账)$/u })).toBeNull();
    expect(document.body.textContent).not.toMatch(/11111111|22222222|merchantOrderId|userId/iu);
  });

  it('creates only the fixed package and refreshes the current-user order list', async () => {
    render(<CreditsOrders locale="zh-CN" />);

    fireEvent.click(screen.getByRole('button', { name: '创建充值订单' }));

    await waitFor(() => expect(mocks.createOrder).toHaveBeenCalledOnce());
    expect(mocks.createOrder).toHaveBeenCalledWith({
      idempotencyKey: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
      ),
      packageId: 'credits-1m',
    });
    expect(mocks.ordersQuery.refetch).toHaveBeenCalledOnce();
    expect(screen.getByText('订单已创建，但尚未付款或增加 Credits。')).toBeTruthy();
  });

  it('cancels only a pending order with the server-returned id and version', async () => {
    render(<CreditsOrders locale="zh-CN" />);

    const cancelButtons = screen.getAllByRole('button', { name: '取消待支付订单' });
    expect(cancelButtons).toHaveLength(1);
    fireEvent.click(cancelButtons[0]);

    await waitFor(() =>
      expect(mocks.cancelOrder).toHaveBeenCalledWith({
        expectedVersion: 3,
        orderId: '11111111-1111-4111-8111-111111111111',
      }),
    );
    expect(mocks.ordersQuery.refetch).toHaveBeenCalledOnce();
    expect(screen.getByText('待支付订单已取消。')).toBeTruthy();
  });

  it('keeps read and mutation failures explicit and retryable', async () => {
    Object.assign(mocks.ordersQuery, { data: undefined, isError: true });
    mocks.createOrder.mockRejectedValueOnce(new Error('internal detail must stay hidden'));
    render(<CreditsOrders locale="zh-CN" />);

    fireEvent.click(screen.getByRole('button', { name: '重新读取订单' }));
    expect(mocks.ordersQuery.refetch).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: '创建充值订单' }));
    expect(await screen.findByText('订单未创建，请稍后重试。')).toBeTruthy();
    expect(screen.queryByText(/internal detail/)).toBeNull();
    expect(screen.getByRole('button', { name: '创建充值订单' })).not.toBeDisabled();
  });
});
