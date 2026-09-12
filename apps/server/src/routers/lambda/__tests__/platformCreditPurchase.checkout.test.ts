// @vitest-environment node
import { expect, it, vi } from 'vitest';

import { platformCreditPurchaseRouter } from '../platformCreditPurchase';

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: (opts: any) => opts.next({ ctx: opts.ctx }),
}));
const caller = (userId?: string) =>
  platformCreditPurchaseRouter.createCaller({ serverDB: {}, userId } as any);

it('requires login and exposes only safe checkout configuration', async () => {
  await expect(caller().checkoutConfig()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  const config = await caller('test').checkoutConfig();
  expect(Object.keys(config).sort()).toEqual(['currency', 'methods', 'unitAmountMinor']);
  expect(config.methods.map((x) => x.id)).toEqual(['alipay', 'wechat', 'unionpay']);
});

it('rejects client-owned identity, unsupported channels and invalid quantities before payment', async () => {
  for (const extra of [
    { method: 'stripe' },
    { quantity: 0 },
    { quantity: 501 },
    { userId: 'other' },
    { currency: 'USD' },
  ]) {
    await expect(
      caller('test').createCheckout({
        method: 'alipay',
        quantity: 1,
        expectedAmountMinor: 672,
        idempotencyKey: 'test',
        ...extra,
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  }
  await expect(caller('test').resumeCheckout({ orderId: 'invalid' })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
});

it('does not expose database failures when resuming checkout', async () => {
  await expect(
    caller('test').resumeCheckout({ orderId: '11111111-1111-4111-8111-111111111111' }),
  ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR', message: '购买订单暂时无法创建' });
});
