// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { platformCreditAccounts, platformCreditEntries } from '../../schemas/platformCredit';
import {
  platformCreditPaymentEvents,
  platformCreditPurchaseOrders,
} from '../../schemas/platformCreditPurchase';
import type { LobeChatDatabase } from '../../type';
import {
  PLATFORM_CREDIT_PAYMENT_EVENT_CONFLICT,
  PLATFORM_CREDIT_PURCHASE_IDEMPOTENCY_CONFLICT,
  PLATFORM_CREDIT_PURCHASE_INVALID_TRANSITION,
  PLATFORM_CREDIT_PURCHASE_STALE_VERSION,
  PlatformCreditPaymentModel,
  PlatformCreditPurchaseModel,
} from '../platformCreditPurchase';

const userA = 'purchase-user-a';
const userB = 'purchase-user-b';

let client: PGlite;
let db: LobeChatDatabase;

const createTestSchema = async () => {
  await client.exec(`
    CREATE TABLE users (id text PRIMARY KEY);

    CREATE TABLE platform_credit_accounts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      user_id text,
      user_id_snapshot text NOT NULL UNIQUE,
      balance_credits bigint DEFAULT 0 NOT NULL,
      accessed_at timestamptz DEFAULT now() NOT NULL,
      created_at timestamptz DEFAULT now() NOT NULL,
      updated_at timestamptz DEFAULT now() NOT NULL
    );

    CREATE TABLE platform_credit_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      account_id uuid NOT NULL,
      user_id text,
      user_id_snapshot text NOT NULL,
      actor_user_id text,
      actor_user_id_snapshot text,
      operator_user_id text,
      reversal_of_entry_id uuid,
      type text NOT NULL,
      amount_credits bigint NOT NULL,
      balance_after_credits bigint NOT NULL,
      reason text NOT NULL,
      idempotency_key text NOT NULL,
      provider text,
      model text,
      generation_id text,
      generation_type text,
      workspace_id text,
      token_usage jsonb,
      cost_usd numeric(30, 15),
      accessed_at timestamptz DEFAULT now() NOT NULL,
      created_at timestamptz DEFAULT now() NOT NULL,
      updated_at timestamptz DEFAULT now() NOT NULL,
      UNIQUE(account_id, idempotency_key)
    );

    CREATE TABLE platform_credit_purchase_orders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      merchant_order_id text NOT NULL UNIQUE,
      user_id text,
      user_id_snapshot text NOT NULL,
      product_id text NOT NULL,
      credits bigint NOT NULL,
      amount_minor bigint NOT NULL,
      currency text NOT NULL,
      idempotency_key text NOT NULL,
      status text NOT NULL,
      refund_status text DEFAULT 'none' NOT NULL,
      version bigint DEFAULT 1 NOT NULL,
      payment_provider text,
      provider_payment_id text,
      credit_entry_id uuid,
      expires_at timestamptz,
      accessed_at timestamptz DEFAULT now() NOT NULL,
      created_at timestamptz DEFAULT now() NOT NULL,
      updated_at timestamptz DEFAULT now() NOT NULL,
      UNIQUE(user_id_snapshot, idempotency_key),
      UNIQUE(credit_entry_id)
    );

    CREATE TABLE platform_credit_payment_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      order_id uuid,
      provider text NOT NULL,
      event_id text NOT NULL,
      event_type text NOT NULL,
      provider_payment_id text NOT NULL,
      merchant_order_id text NOT NULL,
      amount_minor bigint NOT NULL,
      currency text NOT NULL,
      occurred_at timestamptz NOT NULL,
      processing_status text NOT NULL,
      review_reason text,
      accessed_at timestamptz DEFAULT now() NOT NULL,
      created_at timestamptz DEFAULT now() NOT NULL,
      updated_at timestamptz DEFAULT now() NOT NULL,
      UNIQUE(provider, event_id),
      UNIQUE(provider, provider_payment_id)
    );

    INSERT INTO users (id) VALUES ('${userA}'), ('${userB}');
  `);
};

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client) as unknown as LobeChatDatabase;
  await createTestSchema();
});

describe('PlatformCreditPurchase schema', () => {
  it('keeps Credits purchases separate with durable identity and safe normalized events', () => {
    const orderConfig = getTableConfig(platformCreditPurchaseOrders);
    const eventConfig = getTableConfig(platformCreditPaymentEvents);

    expect(orderConfig.indexes.map(({ config }) => config.name)).toEqual(
      expect.arrayContaining([
        'platform_credit_purchase_orders_merchant_order_unique',
        'platform_credit_purchase_orders_user_idempotency_unique',
      ]),
    );
    expect(eventConfig.indexes.map(({ config }) => config.name)).toContain(
      'platform_credit_payment_events_provider_event_unique',
    );
    expect(eventConfig.indexes.map(({ config }) => config.name)).toContain(
      'platform_credit_payment_events_provider_payment_unique',
    );
    expect(orderConfig.checks.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'platform_credit_purchase_orders_credit_entry_consistent',
        'platform_credit_purchase_orders_payment_identity_complete',
        'platform_credit_purchase_orders_unpaid_identity_empty',
      ]),
    );
    expect(eventConfig.columns.map(({ name }) => name)).not.toEqual(
      expect.arrayContaining(['raw_payload', 'secret', 'signature']),
    );
  });
});

describe('PlatformCreditPurchaseModel', () => {
  const createOrder = (model: PlatformCreditPurchaseModel, suffix = 'default') =>
    model.createOrder({
      idempotencyKey: `purchase:${suffix}`,
      product: { amountMinor: 990, credits: 1_000_000, currency: 'CNY', id: 'credits-1m' },
    });

  const moveToPaymentPending = async (model: PlatformCreditPurchaseModel, suffix = 'default') => {
    const order = await createOrder(model, suffix);
    return model.transitionOrder({
      expectedVersion: order.version,
      orderId: order.id,
      status: 'payment_pending',
    });
  };

  const verifiedPayment = (
    merchantOrderId: string,
    overrides?: Partial<{
      amountMinor: number;
      currency: string;
      eventId: string;
      merchantOrderId: string;
      provider: string;
      providerPaymentId: string;
    }>,
  ) => ({
    amountMinor: 990,
    currency: 'CNY',
    eventId: 'payment-event-1',
    eventType: 'payment_succeeded' as const,
    merchantOrderId,
    occurredAt: new Date('2026-09-04T00:00:00.000Z'),
    provider: 'test-provider',
    providerPaymentId: 'provider-payment-1',
    ...overrides,
  });

  it('creates one server-priced order per user and idempotency key', async () => {
    const modelA = new PlatformCreditPurchaseModel(db, userA);
    const input = {
      idempotencyKey: 'purchase:request-1',
      product: { amountMinor: 990, credits: 1_000_000, currency: 'CNY', id: 'credits-1m' },
    };

    const first = await modelA.createOrder(input);
    const repeated = await modelA.createOrder(input);
    const otherUser = await new PlatformCreditPurchaseModel(db, userB).createOrder(input);

    expect(repeated.id).toBe(first.id);
    expect(first).toMatchObject({
      amountMinor: 990,
      credits: 1_000_000,
      currency: 'CNY',
      productId: 'credits-1m',
      refundStatus: 'none',
      status: 'created',
      userIdSnapshot: userA,
      version: 1,
    });
    expect(otherUser.id).not.toBe(first.id);

    await expect(
      modelA.createOrder({
        ...input,
        product: { ...input.product, amountMinor: 1090 },
      }),
    ).rejects.toThrow(PLATFORM_CREDIT_PURCHASE_IDEMPOTENCY_CONFLICT);
  });

  it('rejects an order expiry that is not strictly in the future', async () => {
    const model = new PlatformCreditPurchaseModel(db, userA);

    await expect(
      model.createOrder({
        expiresAt: new Date(Date.now() - 1),
        idempotencyKey: 'purchase:expired-at-creation',
        product: { amountMinor: 990, credits: 1_000_000, currency: 'CNY', id: 'credits-1m' },
      }),
    ).rejects.toThrow('Credits 购买订单信息无效');
  });

  it('enforces the non-payment state graph and optimistic version', async () => {
    const model = new PlatformCreditPurchaseModel(db, userA);
    const pending = await moveToPaymentPending(model, 'state');

    expect(pending).toMatchObject({ status: 'payment_pending', version: 2 });
    await expect(
      model.transitionOrder({
        expectedVersion: pending.version,
        orderId: pending.id,
        status: 'credited' as 'payment_pending',
      }),
    ).rejects.toThrow(PLATFORM_CREDIT_PURCHASE_INVALID_TRANSITION);
    await expect(
      model.transitionOrder({
        expectedVersion: 1,
        orderId: pending.id,
        status: 'payment_failed',
      }),
    ).rejects.toThrow(PLATFORM_CREDIT_PURCHASE_STALE_VERSION);

    await expect(
      model.transitionOrder({
        expectedVersion: pending.version,
        orderId: pending.id,
        status: 'payment_failed',
      }),
    ).resolves.toMatchObject({ status: 'payment_failed', version: 3 });
  });

  it('records one verified event and moves a matching pending order to paid', async () => {
    const model = new PlatformCreditPurchaseModel(db, userA);
    const paymentModel = new PlatformCreditPaymentModel(db);
    const pending = await moveToPaymentPending(model, 'verified-event');
    const payment = verifiedPayment(pending.merchantOrderId);

    const first = await paymentModel.recordVerifiedPaymentEvent(payment);
    const repeated = await paymentModel.recordVerifiedPaymentEvent(payment);

    expect(first.order).toMatchObject({
      paymentProvider: 'test-provider',
      providerPaymentId: 'provider-payment-1',
      status: 'paid',
      version: 3,
    });
    expect(first.event).toMatchObject({ processingStatus: 'accepted', reviewReason: null });
    expect(repeated.event.id).toBe(first.event.id);
    expect(await db.select().from(platformCreditPaymentEvents)).toHaveLength(1);
    await expect(
      paymentModel.recordVerifiedPaymentEvent({ ...payment, amountMinor: 991 }),
    ).rejects.toThrow(PLATFORM_CREDIT_PAYMENT_EVENT_CONFLICT);
  });

  it('deduplicates a provider payment across different event IDs without touching another order', async () => {
    const modelA = new PlatformCreditPurchaseModel(db, userA);
    const modelB = new PlatformCreditPurchaseModel(db, userB);
    const paymentModel = new PlatformCreditPaymentModel(db);
    const pendingA = await moveToPaymentPending(modelA, 'provider-payment-a');
    const pendingB = await moveToPaymentPending(modelB, 'provider-payment-b');
    const firstPayment = verifiedPayment(pendingA.merchantOrderId, {
      eventId: 'provider-replay-event-1',
      providerPaymentId: 'provider-replay-payment',
    });

    const first = await paymentModel.recordVerifiedPaymentEvent(firstPayment);
    const samePaymentReplay = await paymentModel.recordVerifiedPaymentEvent({
      ...firstPayment,
      eventId: 'provider-replay-event-2',
    });

    expect(samePaymentReplay.event.id).toBe(first.event.id);
    expect(await db.select().from(platformCreditPaymentEvents)).toHaveLength(1);

    await expect(
      paymentModel.recordVerifiedPaymentEvent({
        ...firstPayment,
        eventId: 'provider-replay-event-3',
        merchantOrderId: pendingB.merchantOrderId,
      }),
    ).rejects.toThrow(PLATFORM_CREDIT_PAYMENT_EVENT_CONFLICT);
    expect(
      await db
        .select({ status: platformCreditPurchaseOrders.status })
        .from(platformCreditPurchaseOrders)
        .where(eq(platformCreditPurchaseOrders.id, pendingB.id)),
    ).toEqual([{ status: 'payment_pending' }]);
  });

  it.each([
    ['amount', { amountMinor: 991 }],
    ['currency', { currency: 'USD' }],
  ])('sends a verified event with mismatched %s to review', async (_label, mismatch) => {
    const model = new PlatformCreditPurchaseModel(db, userA);
    const paymentModel = new PlatformCreditPaymentModel(db);
    const pending = await moveToPaymentPending(model, `mismatch-${_label}`);

    const result = await paymentModel.recordVerifiedPaymentEvent(
      verifiedPayment(pending.merchantOrderId, mismatch),
    );

    expect(result.event.processingStatus).toBe('review_required');
    expect(result.order).toMatchObject({ status: 'review_required', version: 3 });
  });

  it('records an unknown merchant order as review without changing another order', async () => {
    const model = new PlatformCreditPurchaseModel(db, userA);
    const paymentModel = new PlatformCreditPaymentModel(db);
    const pending = await moveToPaymentPending(model, 'unknown-merchant');

    const result = await paymentModel.recordVerifiedPaymentEvent(
      verifiedPayment('unknown-merchant-order'),
    );

    expect(result.event).toMatchObject({ orderId: null, processingStatus: 'review_required' });
    expect(result.order).toBeUndefined();
    expect(
      await db
        .select({ status: platformCreditPurchaseOrders.status })
        .from(platformCreditPurchaseOrders)
        .where(eq(platformCreditPurchaseOrders.id, pending.id)),
    ).toEqual([{ status: 'payment_pending' }]);
  });

  it('credits a paid order atomically and never invokes settlement twice', async () => {
    const model = new PlatformCreditPurchaseModel(db, userA);
    const paymentModel = new PlatformCreditPaymentModel(db);
    const pending = await moveToPaymentPending(model, 'settlement');
    const { order: paid } = await paymentModel.recordVerifiedPaymentEvent(
      verifiedPayment(pending.merchantOrderId),
    );
    if (!paid) throw new Error('expected paid order');
    const [account] = await db
      .insert(platformCreditAccounts)
      .values({ userId: userA, userIdSnapshot: userA })
      .returning();
    const postCreditEntry = vi.fn(
      async ({
        idempotencyKey,
        order,
        transaction,
      }: Parameters<Parameters<typeof paymentModel.settlePaidOrder>[0]['postCreditEntry']>[0]) => {
        const [entry] = await transaction
          .insert(platformCreditEntries)
          .values({
            accountId: account.id,
            amountCredits: order.credits,
            balanceAfterCredits: order.credits,
            idempotencyKey,
            reason: '已验证支付自动入账',
            type: 'top_up',
            userId: userA,
            userIdSnapshot: userA,
          })
          .returning();
        await transaction
          .update(platformCreditAccounts)
          .set({ balanceCredits: order.credits })
          .where(eq(platformCreditAccounts.id, account.id));
        return { entryId: entry.id };
      },
    );

    const credited = await paymentModel.settlePaidOrder({ orderId: paid.id, postCreditEntry });
    const repeated = await paymentModel.settlePaidOrder({
      orderId: paid.id,
      postCreditEntry: vi.fn(() => Promise.reject(new Error('must not run'))),
    });

    expect(credited).toMatchObject({ creditEntryId: expect.any(String), status: 'credited' });
    expect(repeated.id).toBe(credited.id);
    expect(postCreditEntry).toHaveBeenCalledTimes(1);
    expect(await db.select().from(platformCreditEntries)).toHaveLength(1);
    expect(await db.select().from(platformCreditAccounts)).toEqual([
      expect.objectContaining({ balanceCredits: 1_000_000 }),
    ]);
  });

  it('rolls back a Credits entry when settlement fails before the order is credited', async () => {
    const model = new PlatformCreditPurchaseModel(db, userA);
    const paymentModel = new PlatformCreditPaymentModel(db);
    const pending = await moveToPaymentPending(model, 'settlement-rollback');
    const { order: paid } = await paymentModel.recordVerifiedPaymentEvent(
      verifiedPayment(pending.merchantOrderId, {
        eventId: 'payment-event-rollback',
        providerPaymentId: 'provider-payment-rollback',
      }),
    );
    if (!paid) throw new Error('expected paid order');
    const [account] = await db
      .insert(platformCreditAccounts)
      .values({ userId: userA, userIdSnapshot: userA })
      .returning();

    await expect(
      paymentModel.settlePaidOrder({
        orderId: paid.id,
        postCreditEntry: async ({ idempotencyKey, order, transaction }) => {
          await transaction.insert(platformCreditEntries).values({
            accountId: account.id,
            amountCredits: order.credits,
            balanceAfterCredits: order.credits,
            idempotencyKey,
            reason: '测试回滚',
            type: 'top_up',
            userId: userA,
            userIdSnapshot: userA,
          });
          throw new Error('ledger write failed');
        },
      }),
    ).rejects.toThrow('ledger write failed');

    expect(await db.select().from(platformCreditEntries)).toHaveLength(0);
    expect(
      await db
        .select({
          creditEntryId: platformCreditPurchaseOrders.creditEntryId,
          status: platformCreditPurchaseOrders.status,
        })
        .from(platformCreditPurchaseOrders)
        .where(eq(platformCreditPurchaseOrders.id, paid.id)),
    ).toEqual([{ creditEntryId: null, status: 'paid' }]);
  });
});
