// @vitest-environment node
import { generateKeyPairSync, sign } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import {
  platformCreditAccounts,
  platformCreditEntries,
  platformCreditPurchaseOrders,
  users,
} from '@/database/schemas';
import { platformCreditPurchaseRouter } from '@/server/routers/lambda/platformCreditPurchase';

import * as gateways from './gateways';
import { createCheckout, receivePayment, resumeCheckout } from './index';

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: (opts: any) => opts.next({ ctx: opts.ctx }),
}));

const db = await getTestDB();
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKey = keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const env = {
  PAYMENT_PUBLIC_BASE_URL: 'https://travel.example/lobehub',
  PAYMENT_CNY_FEN_PER_MILLION: '672',
  ALIPAY_APP_ID: 'app123',
  ALIPAY_SELLER_ID: 'seller123',
  ALIPAY_PRIVATE_KEY: privateKey,
  ALIPAY_PUBLIC_KEY: keys.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
};
const userId = 'domestic-payment-test-user';
beforeAll(async () => {
  await db.insert(users).values({ id: userId });
});
const checkout = (idempotencyKey: string) =>
  createCheckout(
    db,
    userId,
    {
      method: 'alipay',
      quantity: 2,
      expectedAmountMinor: 1344,
      idempotencyKey,
    },
    env,
  );
const notice = async (id: string, amount = '13.44') => {
  const [order] = await db
    .select()
    .from(platformCreditPurchaseOrders)
    .where(eq(platformCreditPurchaseOrders.id, id));
  const fields = {
    app_id: 'app123',
    seller_id: 'seller123',
    out_trade_no: order.merchantOrderId.replaceAll('-', ''),
    total_amount: amount,
    trade_status: 'TRADE_SUCCESS',
    trade_no: `trade-${id}`,
    gmt_payment: '2026-09-06 18:00:01',
  };
  const canonical = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k as keyof typeof fields]}`)
    .join('&');
  return new URLSearchParams({
    ...fields,
    sign_type: 'RSA2',
    sign: sign('RSA-SHA256', Buffer.from(canonical), privateKey).toString('base64'),
  }).toString();
};

describe('checkout to credit ledger', () => {
  it('isolates checkout status and prevents local cancellation of a remotely payable order', async () => {
    const { order } = await checkout('status-isolation');
    const owner = platformCreditPurchaseRouter.createCaller({ serverDB: db, userId } as any);
    const stranger = platformCreditPurchaseRouter.createCaller({
      serverDB: db,
      userId: 'other-user',
    } as any);
    const status = await owner.checkoutStatus({ orderId: order.id });
    expect(status.status).toBe('payment_pending');
    expect(status).not.toHaveProperty('merchantOrderId');
    await expect(stranger.checkoutStatus({ orderId: order.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      owner.cancelOrder({ orderId: order.id, expectedVersion: status.version }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await owner.checkoutStatus({ orderId: order.id })).status).toBe('payment_pending');
  });
  it('persists pending before an ambiguous gateway failure so a later notification can settle', async () => {
    const gateway = vi.spyOn(gateways, 'createPayment').mockRejectedValueOnce(new Error('timeout'));
    await expect(checkout('timeout')).rejects.toThrow();
    gateway.mockRestore();
    const [order] = await db
      .select()
      .from(platformCreditPurchaseOrders)
      .where(eq(platformCreditPurchaseOrders.idempotencyKey, 'timeout'));
    expect(order.status).toBe('payment_pending');
  });
  it('creates a server-priced order, resumes the same order and rejects foreign access', async () => {
    const first = await checkout('one');
    const repeated = await checkout('one');
    expect(first.order).toMatchObject({
      amountMinor: 1344,
      currency: 'CNY',
      credits: 2_000_000,
      status: 'payment_pending',
    });
    expect(repeated.order.id).toBe(first.order.id);
    await expect(resumeCheckout(db, 'other-user', first.order.id, env)).rejects.toThrow();
    await expect(
      createCheckout(
        db,
        userId,
        { method: 'alipay', quantity: 2, expectedAmountMinor: 1, idempotencyKey: 'tampered-price' },
        env,
      ),
    ).rejects.toThrow();
    await expect(
      createCheckout(
        db,
        userId,
        { method: 'alipay', quantity: 0, expectedAmountMinor: 0, idempotencyKey: 'zero' },
        env,
      ),
    ).rejects.toThrow();
  });

  it('settles an authenticated payment exactly once, including duplicate notifications', async () => {
    creditNotice.mockClear();
    const { order } = await checkout('paid');
    expect(creditNotice).not.toHaveBeenCalled();
    const body = await notice(order.id);
    await receivePayment(db, 'alipay', body, new Headers(), env);
    await receivePayment(db, 'alipay', body, new Headers(), env);
    const entries = await db
      .select()
      .from(platformCreditEntries)
      .where(eq(platformCreditEntries.idempotencyKey, `payment-credit:${order.id}`));
    expect(entries).toHaveLength(1);
    expect(creditNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        eventId: entries[0].id,
        type: 'credits_top_up_completed',
      }),
    );
    expect(entries[0]).toMatchObject({
      type: 'top_up',
      amountCredits: 2_000_000,
      operatorUserId: null,
    });
    const [account] = await db
      .select()
      .from(platformCreditAccounts)
      .where(eq(platformCreditAccounts.userIdSnapshot, userId));
    expect(account.balanceCredits).toBe(2_000_000);
    const result = await resumeCheckout(db, userId, order.id, env);
    expect(result.order.status).toBe('credited');
    expect(result.payment).toBeNull();
  });

  it('never credits a forged notification or a signed payment with a different amount', async () => {
    creditNotice.mockClear();
    const { order } = await checkout('mismatch');
    const body = await notice(order.id, '0.01');
    await expect(
      receivePayment(db, 'alipay', `${body}&total_amount=13.44`, new Headers(), env),
    ).rejects.toThrow();
    await receivePayment(db, 'alipay', body, new Headers(), env);
    const [result] = await db
      .select()
      .from(platformCreditPurchaseOrders)
      .where(eq(platformCreditPurchaseOrders.id, order.id));
    expect(result.status).toBe('review_required');
    expect(result.creditEntryId).toBeNull();
    expect(creditNotice).not.toHaveBeenCalled();
  });
});

const creditNotice = vi.hoisted(() => vi.fn(async (_event: unknown) => {}));
vi.mock('@/server/services/notification/index', () => ({ notifyUser: creditNotice }));
