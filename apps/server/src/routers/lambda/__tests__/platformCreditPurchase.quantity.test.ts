// @vitest-environment node
import { PlatformCreditPurchaseModel } from '@lobechat/database';
import { afterEach, expect, it, vi } from 'vitest';

import { platformCreditPurchaseRouter } from '../platformCreditPurchase';

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: (opts: any) => opts.next({ ctx: opts.ctx }),
}));
afterEach(() => vi.restoreAllMocks());
const caller = () =>
  platformCreditPurchaseRouter.createCaller({ serverDB: {}, userId: 'test-user' } as any);

it('calculates quantity prices on the server and retains the one-million default', async () => {
  const create = vi.spyOn(PlatformCreditPurchaseModel.prototype, 'createOrder').mockImplementation(
    async ({ product }) =>
      ({
        ...product,
        productId: product.id,
        status: 'created',
      }) as any,
  );
  await caller().createOrder({ packageId: 'credits-1m', idempotencyKey: 'default' });
  expect(create.mock.calls[0][0].product).toEqual({
    id: 'credits-1m',
    amountMinor: 1000,
    credits: 1_000_000,
    currency: 'CNY',
  });
  await caller().createOrder({ packageId: 'credits-1m', quantity: 10, idempotencyKey: 'ten' });
  expect(create.mock.calls[1][0].product).toEqual({
    id: 'credits-10m',
    amountMinor: 10000,
    credits: 10_000_000,
    currency: 'CNY',
  });
});

it('rejects invalid quantities, client prices, and unauthenticated requests before creating orders', async () => {
  const create = vi.spyOn(PlatformCreditPurchaseModel.prototype, 'createOrder');
  for (const extra of [
    { quantity: 0 },
    { quantity: 501 },
    { quantity: 1.5 },
    { quantity: '10' },
    { amountMinor: 1 },
    { userId: 'other' },
  ]) {
    await expect(
      caller().createOrder({
        packageId: 'credits-1m',
        idempotencyKey: 'invalid',
        ...extra,
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  }
  await expect(
    platformCreditPurchaseRouter
      .createCaller({ serverDB: {} } as any)
      .createOrder({ packageId: 'credits-1m', idempotencyKey: 'anonymous' }),
  ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  expect(create).not.toHaveBeenCalled();
});
