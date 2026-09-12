import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CreditsOrders from './CreditsOrders';
import { PaymentCheckout } from './PaymentCheckout';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslation: () => ({
    i18n: { language: 'zh-CN' },
    t: (_key: string, opts: any) => opts?.defaultValue ?? _key,
  }),
}));

const mocks = vi.hoisted(() => ({
  configQuery: {
    data: {
      currency: 'CNY',
      unitAmountMinor: 672,
      methods: [
        { id: 'alipay', enabled: true },
        { id: 'wechat', enabled: true },
        { id: 'unionpay', enabled: false },
      ],
    } as
      | {
          currency: string;
          unitAmountMinor: number | null;
          methods: Array<{ id: string; enabled: boolean }>;
        }
      | undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  openCheckout: vi.fn(),
  checkoutCreate: vi.fn(),
  checkoutResume: vi.fn(),
  invalidate: vi.fn(),
  checkoutStatus: { data: undefined, isError: false, refetch: vi.fn() },
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

vi.mock('./PaymentCheckout', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openPaymentCheckout: mocks.openCheckout,
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    useUtils: () => ({
      customerCenter: { invalidate: mocks.invalidate },
      platformCredit: { invalidate: mocks.invalidate },
    }),
    customerCenter: {
      getDisplayExchangeRate: {
        useQuery: () => ({
          data: {
            month: '2026-09',
            rate: 6.711,
            rateDate: '2026-09-04',
            updatedAt: '2026-09-05T00:00:00Z',
          },
        }),
      },
    },
    platformCreditPurchase: {
      checkoutConfig: {
        useQuery: () => mocks.configQuery,
      },
      checkoutStatus: { useQuery: () => mocks.checkoutStatus },
      createCheckout: { useMutation: () => ({ mutateAsync: mocks.checkoutCreate }) },
      resumeCheckout: { useMutation: () => ({ mutateAsync: mocks.checkoutResume }) },
      cancelOrder: { useMutation: () => ({ mutateAsync: mocks.cancelOrder }) },
      createOrder: { useMutation: () => ({ mutateAsync: mocks.createOrder }) },
      listOrders: { useQuery: () => mocks.ordersQuery },
    },
  },
}));

beforeEach(() => {
  Object.assign(mocks.configQuery, {
    data: {
      currency: 'CNY',
      unitAmountMinor: 672,
      methods: [
        { id: 'alipay', enabled: true },
        { id: 'wechat', enabled: true },
        { id: 'unionpay', enabled: false },
      ],
    },
    isLoading: false,
    isError: false,
  });
  mocks.configQuery.refetch.mockReset().mockResolvedValue(undefined);
  mocks.openCheckout.mockClear();
  mocks.checkoutCreate.mockReset();
  mocks.checkoutResume.mockReset();
  mocks.invalidate.mockClear();
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
  it('distinguishes loading and failed checkout configuration from a missing price', () => {
    mocks.configQuery.data = undefined;
    mocks.configQuery.isLoading = true;
    const { rerender } = render(<CreditsOrders locale="zh-CN" />);
    expect(screen.getByText('正在加载充值价格…')).toBeTruthy();
    expect(screen.queryByText('人民币售价待配置')).toBeNull();
    expect(screen.getByRole('button', { name: '充值' })).toBeDisabled();
    mocks.configQuery.isLoading = false;
    mocks.configQuery.isError = true;
    rerender(<CreditsOrders locale="zh-CN" />);
    expect(screen.getByText('充值价格暂时无法读取')).toBeTruthy();
    expect(screen.queryByText('人民币售价待配置')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新加载充值价格' }));
    expect(mocks.configQuery.refetch).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '充值' })).toBeDisabled();
  });
  it('disables checkout when the server has no price configured', () => {
    mocks.configQuery.data!.unitAmountMinor = null;
    render(<CreditsOrders locale="zh-CN" />);
    expect(screen.getByText('人民币售价待配置')).toBeTruthy();
    expect(screen.getByRole('button', { name: '充值' })).toBeDisabled();
  });
  it('opens the shared checkout with the selected quantity without placing an order', () => {
    render(<CreditsOrders locale="zh-CN" />);
    fireEvent.click(screen.getByRole('button', { name: '1000万' }));
    fireEvent.click(screen.getByRole('button', { name: '充值' }));
    expect(mocks.openCheckout).toHaveBeenCalledWith({
      quantity: 10,
      onChanged: expect.any(Function),
    });
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });
  it('rejects blank, fractional and out-of-range custom quantities', () => {
    render(<CreditsOrders locale="zh-CN" />);
    const input = screen.getByRole('spinbutton');
    for (const value of ['', '0', '1.5', '501']) {
      fireEvent.change(input, { target: { value } });
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByRole('button', { name: '充值' })).toBeDisabled();
    }
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });
  it('shows the configured CNY price and opens checkout with the selected quantity', async () => {
    render(<CreditsOrders locale="zh-CN" />);
    fireEvent.click(screen.getByRole('button', { name: '1000万' }));
    expect(screen.getByText(/总计 ¥67.20/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '充值' }));
    await waitFor(() =>
      expect(mocks.openCheckout).toHaveBeenCalledWith({
        onChanged: expect.any(Function),
        quantity: 10,
      }),
    );
  });
  it('shows RMB reference amounts without changing the order currency or credits', () => {
    render(<CreditsOrders locale="zh-CN" />);
    expect(screen.getAllByText(/¥6.71/).length).toBeGreaterThan(0);
    expect(mocks.ordersQuery.data?.[0].currency).toBe('USD');
    expect(mocks.ordersQuery.data?.[0].credits).toBe(1_000_000);
  });
  it('shows the server-owned package, current-user orders, and payment-free boundary', () => {
    render(<CreditsOrders locale="zh-CN" />);

    expect(screen.getAllByText('1,000,000 积分')).toHaveLength(3);
    expect(screen.getAllByText('¥6.71').length).toBeGreaterThan(0);
    expect(screen.getByText('待支付')).toBeTruthy();
    expect(screen.getByText('已取消')).toBeTruthy();
    expect(screen.getByText(/付款确认后自动入账/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^(?:支付|立即到账)$/u })).toBeNull();
    expect(document.body.textContent).not.toMatch(/11111111|22222222|merchantOrderId|userId/iu);
  });

  it('refreshes the order list when checkout reports a change', async () => {
    render(<CreditsOrders locale="zh-CN" />);

    fireEvent.click(screen.getByRole('button', { name: '充值' }));
    expect(mocks.createOrder).not.toHaveBeenCalled();
    mocks.openCheckout.mock.calls[0][0].onChanged();
    expect(mocks.ordersQuery.refetch).toHaveBeenCalledOnce();
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

    fireEvent.click(screen.getByRole('button', { name: '充值' }));
    expect(mocks.openCheckout).toHaveBeenCalledOnce();
    expect(screen.queryByText(/internal detail/)).toBeNull();
    expect(screen.getByRole('button', { name: '充值' })).not.toBeDisabled();
  });
});

// Checkout interactions belong to this existing credits-flow integration suite.
it('opens with three channels but never creates an order before explicit confirmation', () => {
  render(<PaymentCheckout quantity={2} onChanged={() => {}} />);
  expect(screen.getByText('¥13.44')).toBeTruthy();
  expect(screen.getByRole('radio', { name: /支付宝/ })).toBeEnabled();
  expect(screen.getByRole('radio', { name: /微信支付/ })).toBeEnabled();
  expect(screen.getByRole('radio', { name: /网银/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: '确认充值' })).toBeDisabled();
  expect(mocks.checkoutCreate).not.toHaveBeenCalled();
});

it('confirms a server quote and renders only the returned payment form, not a success claim', async () => {
  mocks.checkoutCreate.mockResolvedValue({
    order: {
      id: 'order1',
      amountMinor: 1344,
      credits: 2_000_000,
      currency: 'CNY',
      status: 'payment_pending',
      productId: 'domestic-credits-2m-alipay',
      createdAt: new Date(),
    },
    payment: {
      type: 'form',
      action: 'https://openapi.alipay.com/gateway.do?charset=utf-8',
      fields: { sign: 'signed', biz_content: '<script>unsafe</script>' },
    },
  });
  render(<PaymentCheckout quantity={2} onChanged={() => {}} />);
  fireEvent.click(screen.getByRole('radio', { name: /支付宝/ }));
  fireEvent.click(screen.getByRole('button', { name: '确认充值' }));
  await waitFor(() =>
    expect(mocks.checkoutCreate).toHaveBeenCalledWith({
      quantity: 2,
      method: 'alipay',
      expectedAmountMinor: 1344,
      idempotencyKey: expect.any(String),
    }),
  );
  const button = await screen.findByRole('button', { name: '前往支付平台' });
  expect(button.closest('form')).toHaveAttribute(
    'action',
    'https://openapi.alipay.com/gateway.do?charset=utf-8',
  );
  expect(button.closest('form')).toHaveAttribute('accept-charset', 'UTF-8');
  expect(document.querySelector('script')).toBeNull();
  expect(screen.queryByText('充值已到账')).toBeNull();
});

it('reuses the idempotency key after a network error and does not display internal errors', async () => {
  mocks.checkoutCreate.mockRejectedValue(new Error('SECRET internal details'));
  render(<PaymentCheckout quantity={1} onChanged={() => {}} />);
  fireEvent.click(screen.getByRole('radio', { name: /微信支付/ }));
  fireEvent.click(screen.getByRole('button', { name: '确认充值' }));
  await screen.findByText('支付发起失败，请重试或到订单列表继续支付。');
  fireEvent.click(screen.getByRole('button', { name: '确认充值' }));
  await waitFor(() => expect(mocks.checkoutCreate).toHaveBeenCalledTimes(2));
  expect(mocks.checkoutCreate.mock.calls[1][0].idempotencyKey).toBe(
    mocks.checkoutCreate.mock.calls[0][0].idempotencyKey,
  );
  expect(screen.queryByText(/SECRET/)).toBeNull();
});
