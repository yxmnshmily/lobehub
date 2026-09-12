// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { platformCreditEntries, platformCreditPurchaseOrders, users } from '@/database/schemas';

import { platformCreditPurchaseRouter } from '../platformCreditPurchase';

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: vi.fn((opts: any) => opts.next({ ctx: opts.ctx })),
}));

const db = await getTestDB();
const userAId = 'platform-credit-purchase-user-a';
const userBId = 'platform-credit-purchase-user-b';
const userIds = [userAId, userBId];

const callerA = () =>
  platformCreditPurchaseRouter.createCaller({ serverDB: db, userId: userAId } as any);
const callerB = () =>
  platformCreditPurchaseRouter.createCaller({ serverDB: db, userId: userBId } as any);

beforeAll(async () => {
  await db
    .insert(users)
    .values(userIds.map((id) => ({ id })))
    .onConflictDoNothing();
});

beforeEach(async () => {
  await db
    .delete(platformCreditPurchaseOrders)
    .where(inArray(platformCreditPurchaseOrders.userIdSnapshot, userIds));
});

afterAll(async () => {
  await db
    .delete(platformCreditPurchaseOrders)
    .where(inArray(platformCreditPurchaseOrders.userIdSnapshot, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
});

describe('platform Credits purchase tRPC contracts', () => {
  it('creates only the fixed Credits exchange package and rejects browser-owned quote or identity', async () => {
    const first = await callerA().createOrder({
      idempotencyKey: 'purchase:create-1',
      packageId: 'credits-1m',
    });
    const repeated = await callerA().createOrder({
      idempotencyKey: 'purchase:create-1',
      packageId: 'credits-1m',
    });

    expect(first).toMatchObject({
      amountMinor: 1000,
      credits: 1_000_000,
      currency: 'CNY',
      productId: 'credits-1m',
      status: 'created',
      version: 1,
    });
    expect(repeated.id).toBe(first.id);
    expect(Object.keys(first).sort()).toEqual([
      'amountMinor',
      'createdAt',
      'credits',
      'currency',
      'expiresAt',
      'id',
      'productId',
      'refundStatus',
      'status',
      'updatedAt',
      'version',
    ]);

    for (const [label, forged] of [
      ['amount', { amountMinor: 1 }],
      ['credits', { credits: 9_999_999 }],
      ['currency', { currency: 'CNY' }],
      ['target-user', { targetUserId: userBId }],
    ] as const) {
      await expect(
        callerA().createOrder({
          ...forged,
          idempotencyKey: `purchase:forged-${label}`,
          packageId: 'credits-1m',
        } as any),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    await expect(
      callerA().createOrder({
        idempotencyKey: 'purchase:unknown-package',
        packageId: 'credits-custom',
      } as any),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(
      await db
        .select({ userId: platformCreditPurchaseOrders.userIdSnapshot })
        .from(platformCreditPurchaseOrders),
    ).toEqual([{ userId: userAId }]);
  });

  it('lists only the current user orders with a safe payment-free projection', async () => {
    await callerA().createOrder({
      idempotencyKey: 'purchase:list-a',
      packageId: 'credits-1m',
    });
    await callerB().createOrder({
      idempotencyKey: 'purchase:list-b',
      packageId: 'credits-1m',
    });

    const orders = await callerA().listOrders({ limit: 20 });

    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ productId: 'credits-1m', status: 'created' });
    expect(JSON.stringify(orders)).not.toMatch(
      /merchantOrderId|userId|idempotencyKey|paymentProvider|providerPaymentId|creditEntryId|checkout|secret|token/i,
    );
  });

  it('cancels only the current user mutable order and rejects replay, expiry, and cross-user ids', async () => {
    const own = await callerA().createOrder({
      idempotencyKey: 'purchase:cancel-own',
      packageId: 'credits-1m',
    });
    const other = await callerB().createOrder({
      idempotencyKey: 'purchase:cancel-other',
      packageId: 'credits-1m',
    });
    const [expired] = await db
      .insert(platformCreditPurchaseOrders)
      .values({
        amountMinor: 100,
        credits: 1_000_000,
        currency: 'USD',
        expiresAt: new Date(Date.now() - 1_000),
        idempotencyKey: 'purchase:expired',
        merchantOrderId: 'purchase-expired-order',
        productId: 'credits-1m',
        status: 'expired',
        userId: userAId,
        userIdSnapshot: userAId,
      })
      .returning();

    await expect(
      callerA().cancelOrder({ expectedVersion: other.version, orderId: other.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      callerA().cancelOrder({ expectedVersion: expired.version, orderId: expired.id }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const cancelled = await callerA().cancelOrder({
      expectedVersion: own.version,
      orderId: own.id,
    });
    expect(cancelled).toMatchObject({ id: own.id, status: 'cancelled', version: 2 });
    await expect(
      callerA().cancelOrder({ expectedVersion: own.version, orderId: own.id }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(
      await db
        .select({ id: platformCreditEntries.id })
        .from(platformCreditEntries)
        .where(eq(platformCreditEntries.userIdSnapshot, userAId)),
    ).toHaveLength(0);
  });
});
