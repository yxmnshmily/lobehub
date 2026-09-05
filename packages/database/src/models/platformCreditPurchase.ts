import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { platformCreditAccounts, platformCreditEntries } from '../schemas/platformCredit';
import {
  type PlatformCreditPaymentEventItem,
  platformCreditPaymentEvents,
  type PlatformCreditPurchaseOrderItem,
  platformCreditPurchaseOrders,
  type PlatformCreditPurchaseStatus,
} from '../schemas/platformCreditPurchase';
import type { LobeChatDatabase, Transaction } from '../type';

export const PLATFORM_CREDIT_PAYMENT_EVENT_CONFLICT = '支付事件标识已用于其他事件内容';
export const PLATFORM_CREDIT_PURCHASE_IDEMPOTENCY_CONFLICT = '幂等键已用于其他 Credits 购买订单';
export const PLATFORM_CREDIT_PURCHASE_INVALID_INPUT = 'Credits 购买订单信息无效';
export const PLATFORM_CREDIT_PURCHASE_INVALID_SETTLEMENT = 'Credits 购买入账结果无效';
export const PLATFORM_CREDIT_PURCHASE_INVALID_TRANSITION = 'Credits 购买订单状态转换无效';
export const PLATFORM_CREDIT_PURCHASE_ORDER_NOT_FOUND = 'Credits 购买订单不存在';
export const PLATFORM_CREDIT_PURCHASE_STALE_VERSION = 'Credits 购买订单版本已失效';

const normalizeText = (value: string, maxLength = 255) => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(PLATFORM_CREDIT_PURCHASE_INVALID_INPUT);
  }
  return normalized;
};

const normalizePositiveInteger = (value: number) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(PLATFORM_CREDIT_PURCHASE_INVALID_INPUT);
  }
  return value;
};

const normalizeCurrency = (value: string) => {
  const currency = normalizeText(value, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error(PLATFORM_CREDIT_PURCHASE_INVALID_INPUT);
  return currency;
};

const normalizeDate = (value: Date) => {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(PLATFORM_CREDIT_PURCHASE_INVALID_INPUT);
  }
  return value;
};

const normalizeVersion = (value: number) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(PLATFORM_CREDIT_PURCHASE_STALE_VERSION);
  }
  return value;
};

const sameQuote = (
  order: PlatformCreditPurchaseOrderItem,
  quote: { amountMinor: number; credits: number; currency: string; productId: string },
) =>
  order.amountMinor === quote.amountMinor &&
  order.credits === quote.credits &&
  order.currency === quote.currency &&
  order.productId === quote.productId;

export interface CreatePlatformCreditPurchaseOrderInput {
  expiresAt?: Date;
  idempotencyKey: string;
  /** Must be resolved from a server-owned product catalog, never accepted from a browser. */
  product: {
    amountMinor: number;
    credits: number;
    currency: string;
    id: string;
  };
}

type CustomerTransitionStatus = 'cancelled' | 'expired' | 'payment_failed' | 'payment_pending';

const customerTransitions: Record<
  PlatformCreditPurchaseStatus,
  readonly CustomerTransitionStatus[]
> = {
  cancelled: [],
  created: ['payment_pending', 'cancelled', 'expired'],
  credited: [],
  expired: [],
  payment_failed: ['payment_pending', 'cancelled', 'expired'],
  payment_pending: ['payment_failed', 'cancelled', 'expired'],
  paid: [],
  review_required: [],
};

export interface VerifiedPlatformCreditPaymentEvent {
  amountMinor: number;
  currency: string;
  eventId: string;
  eventType: 'payment_succeeded';
  merchantOrderId: string;
  occurredAt: Date;
  provider: string;
  providerPaymentId: string;
}

export interface PlatformCreditSettlementContext {
  idempotencyKey: string;
  order: PlatformCreditPurchaseOrderItem;
  transaction: Transaction;
}

interface NormalizedVerifiedEvent extends VerifiedPlatformCreditPaymentEvent {}

const normalizeVerifiedEvent = (
  input: VerifiedPlatformCreditPaymentEvent,
): NormalizedVerifiedEvent => {
  if (input.eventType !== 'payment_succeeded') {
    throw new Error(PLATFORM_CREDIT_PURCHASE_INVALID_INPUT);
  }
  return {
    amountMinor: normalizePositiveInteger(input.amountMinor),
    currency: normalizeCurrency(input.currency),
    eventId: normalizeText(input.eventId),
    eventType: input.eventType,
    merchantOrderId: normalizeText(input.merchantOrderId),
    occurredAt: normalizeDate(input.occurredAt),
    provider: normalizeText(input.provider),
    providerPaymentId: normalizeText(input.providerPaymentId),
  };
};

const sameEvent = (event: PlatformCreditPaymentEventItem, input: NormalizedVerifiedEvent) =>
  event.amountMinor === input.amountMinor &&
  event.currency === input.currency &&
  event.eventId === input.eventId &&
  event.eventType === input.eventType &&
  event.merchantOrderId === input.merchantOrderId &&
  event.occurredAt.getTime() === input.occurredAt.getTime() &&
  event.provider === input.provider &&
  event.providerPaymentId === input.providerPaymentId;

const sameProviderPayment = (
  event: PlatformCreditPaymentEventItem,
  input: NormalizedVerifiedEvent,
) =>
  event.amountMinor === input.amountMinor &&
  event.currency === input.currency &&
  event.eventType === input.eventType &&
  event.merchantOrderId === input.merchantOrderId &&
  event.provider === input.provider &&
  event.providerPaymentId === input.providerPaymentId;

export class PlatformCreditPurchaseModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {}

  async createOrder(
    input: CreatePlatformCreditPurchaseOrderInput,
  ): Promise<PlatformCreditPurchaseOrderItem> {
    const userId = normalizeText(this.userId);
    const idempotencyKey = normalizeText(input.idempotencyKey, 200);
    const quote = {
      amountMinor: normalizePositiveInteger(input.product.amountMinor),
      credits: normalizePositiveInteger(input.product.credits),
      currency: normalizeCurrency(input.product.currency),
      productId: normalizeText(input.product.id),
    };
    if (
      input.expiresAt !== undefined &&
      (!(input.expiresAt instanceof Date) || !Number.isFinite(input.expiresAt.getTime()))
    ) {
      throw new Error(PLATFORM_CREDIT_PURCHASE_INVALID_INPUT);
    }

    return this.db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const [existing] = await transaction
        .select()
        .from(platformCreditPurchaseOrders)
        .where(
          and(
            eq(platformCreditPurchaseOrders.userIdSnapshot, userId),
            eq(platformCreditPurchaseOrders.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        if (
          !sameQuote(existing, quote) ||
          existing.expiresAt?.getTime() !== input.expiresAt?.getTime()
        ) {
          throw new Error(PLATFORM_CREDIT_PURCHASE_IDEMPOTENCY_CONFLICT);
        }
        return existing;
      }
      if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
        throw new Error(PLATFORM_CREDIT_PURCHASE_INVALID_INPUT);
      }

      const [created] = await transaction
        .insert(platformCreditPurchaseOrders)
        .values({
          ...quote,
          expiresAt: input.expiresAt,
          idempotencyKey,
          merchantOrderId: randomUUID(),
          status: 'created',
          userId,
          userIdSnapshot: userId,
        })
        .returning();
      return created;
    });
  }

  async transitionOrder(input: {
    expectedVersion: number;
    orderId: string;
    status: CustomerTransitionStatus;
  }): Promise<PlatformCreditPurchaseOrderItem> {
    const expectedVersion = normalizeVersion(input.expectedVersion);
    const orderId = normalizeText(input.orderId);
    const userId = normalizeText(this.userId);

    return this.db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const [order] = await transaction
        .select()
        .from(platformCreditPurchaseOrders)
        .where(
          and(
            eq(platformCreditPurchaseOrders.id, orderId),
            eq(platformCreditPurchaseOrders.userIdSnapshot, userId),
          ),
        )
        .limit(1)
        .for('update');
      if (!order) throw new Error(PLATFORM_CREDIT_PURCHASE_ORDER_NOT_FOUND);
      if (order.version !== expectedVersion) {
        throw new Error(PLATFORM_CREDIT_PURCHASE_STALE_VERSION);
      }
      if (!customerTransitions[order.status].includes(input.status)) {
        throw new Error(PLATFORM_CREDIT_PURCHASE_INVALID_TRANSITION);
      }

      const [updated] = await transaction
        .update(platformCreditPurchaseOrders)
        .set({ status: input.status, updatedAt: new Date(), version: order.version + 1 })
        .where(
          and(
            eq(platformCreditPurchaseOrders.id, order.id),
            eq(platformCreditPurchaseOrders.status, order.status),
            eq(platformCreditPurchaseOrders.version, order.version),
          ),
        )
        .returning();
      if (!updated) throw new Error(PLATFORM_CREDIT_PURCHASE_STALE_VERSION);
      return updated;
    });
  }
}

/** Internal payment boundary. Callers must verify the provider signature before invoking it. */
export class PlatformCreditPaymentModel {
  constructor(private readonly db: LobeChatDatabase) {}

  async recordVerifiedPaymentEvent(input: VerifiedPlatformCreditPaymentEvent): Promise<{
    event: PlatformCreditPaymentEventItem;
    order?: PlatformCreditPurchaseOrderItem;
  }> {
    const event = normalizeVerifiedEvent(input);

    return this.db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const [existing] = await transaction
        .select()
        .from(platformCreditPaymentEvents)
        .where(
          and(
            eq(platformCreditPaymentEvents.provider, event.provider),
            eq(platformCreditPaymentEvents.eventId, event.eventId),
          ),
        )
        .limit(1)
        .for('update');
      if (existing) {
        if (!sameEvent(existing, event)) throw new Error(PLATFORM_CREDIT_PAYMENT_EVENT_CONFLICT);
        if (!existing.orderId) return { event: existing };
        const [order] = await transaction
          .select()
          .from(platformCreditPurchaseOrders)
          .where(eq(platformCreditPurchaseOrders.id, existing.orderId))
          .limit(1);
        return { event: existing, order };
      }

      const [existingPayment] = await transaction
        .select()
        .from(platformCreditPaymentEvents)
        .where(
          and(
            eq(platformCreditPaymentEvents.provider, event.provider),
            eq(platformCreditPaymentEvents.providerPaymentId, event.providerPaymentId),
          ),
        )
        .limit(1)
        .for('update');
      if (existingPayment) {
        if (!sameProviderPayment(existingPayment, event)) {
          throw new Error(PLATFORM_CREDIT_PAYMENT_EVENT_CONFLICT);
        }
        if (!existingPayment.orderId) return { event: existingPayment };
        const [order] = await transaction
          .select()
          .from(platformCreditPurchaseOrders)
          .where(eq(platformCreditPurchaseOrders.id, existingPayment.orderId))
          .limit(1);
        return { event: existingPayment, order };
      }

      const [order] = await transaction
        .select()
        .from(platformCreditPurchaseOrders)
        .where(eq(platformCreditPurchaseOrders.merchantOrderId, event.merchantOrderId))
        .limit(1)
        .for('update');
      if (!order) {
        const [recorded] = await transaction
          .insert(platformCreditPaymentEvents)
          .values({
            ...event,
            processingStatus: 'review_required',
            reviewReason: 'order_not_found',
          })
          .returning();
        return { event: recorded };
      }

      const quoteMatches =
        order.amountMinor === event.amountMinor && order.currency === event.currency;
      const identityMatches =
        order.paymentProvider === null ||
        (order.paymentProvider === event.provider &&
          order.providerPaymentId === event.providerPaymentId);
      const canAccept =
        quoteMatches &&
        identityMatches &&
        (order.status === 'payment_pending' ||
          order.status === 'paid' ||
          order.status === 'credited');

      if (!canAccept) {
        const reviewReason = !quoteMatches
          ? 'quote_mismatch'
          : !identityMatches
            ? 'payment_identity_mismatch'
            : 'invalid_order_state';
        let reviewedOrder = order;
        if (order.status !== 'credited') {
          const [updated] = await transaction
            .update(platformCreditPurchaseOrders)
            .set({ status: 'review_required', updatedAt: new Date(), version: order.version + 1 })
            .where(eq(platformCreditPurchaseOrders.id, order.id))
            .returning();
          reviewedOrder = updated;
        }
        const [recorded] = await transaction
          .insert(platformCreditPaymentEvents)
          .values({
            ...event,
            orderId: order.id,
            processingStatus: 'review_required',
            reviewReason,
          })
          .returning();
        return { event: recorded, order: reviewedOrder };
      }

      let paidOrder = order;
      if (order.status === 'payment_pending') {
        const [updated] = await transaction
          .update(platformCreditPurchaseOrders)
          .set({
            paymentProvider: event.provider,
            providerPaymentId: event.providerPaymentId,
            status: 'paid',
            updatedAt: new Date(),
            version: order.version + 1,
          })
          .where(eq(platformCreditPurchaseOrders.id, order.id))
          .returning();
        paidOrder = updated;
      }
      const [recorded] = await transaction
        .insert(platformCreditPaymentEvents)
        .values({
          ...event,
          orderId: order.id,
          processingStatus: 'accepted',
        })
        .returning();
      return { event: recorded, order: paidOrder };
    });
  }

  async settlePaidOrder(input: {
    orderId: string;
    postCreditEntry: (context: PlatformCreditSettlementContext) => Promise<{ entryId: string }>;
  }): Promise<PlatformCreditPurchaseOrderItem> {
    const orderId = normalizeText(input.orderId);

    return this.db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const [order] = await transaction
        .select()
        .from(platformCreditPurchaseOrders)
        .where(eq(platformCreditPurchaseOrders.id, orderId))
        .limit(1)
        .for('update');
      if (!order) throw new Error(PLATFORM_CREDIT_PURCHASE_ORDER_NOT_FOUND);
      if (order.status === 'credited' && order.creditEntryId) return order;
      if (order.status !== 'paid') throw new Error(PLATFORM_CREDIT_PURCHASE_INVALID_TRANSITION);

      const idempotencyKey = `payment-credit:${order.id}`;
      const { entryId } = await input.postCreditEntry({
        idempotencyKey,
        order,
        transaction: tx,
      });
      const [posted] = await transaction
        .select({
          accountBalance: platformCreditAccounts.balanceCredits,
          accountUserId: platformCreditAccounts.userIdSnapshot,
          amountCredits: platformCreditEntries.amountCredits,
          balanceAfterCredits: platformCreditEntries.balanceAfterCredits,
          id: platformCreditEntries.id,
          idempotencyKey: platformCreditEntries.idempotencyKey,
          type: platformCreditEntries.type,
          userId: platformCreditEntries.userIdSnapshot,
        })
        .from(platformCreditEntries)
        .innerJoin(
          platformCreditAccounts,
          eq(platformCreditAccounts.id, platformCreditEntries.accountId),
        )
        .where(eq(platformCreditEntries.id, normalizeText(entryId)))
        .limit(1);
      if (
        !posted ||
        posted.accountBalance !== posted.balanceAfterCredits ||
        posted.accountUserId !== order.userIdSnapshot ||
        posted.amountCredits !== order.credits ||
        posted.idempotencyKey !== idempotencyKey ||
        posted.type !== 'top_up' ||
        posted.userId !== order.userIdSnapshot
      ) {
        throw new Error(PLATFORM_CREDIT_PURCHASE_INVALID_SETTLEMENT);
      }

      const [credited] = await transaction
        .update(platformCreditPurchaseOrders)
        .set({
          creditEntryId: posted.id,
          status: 'credited',
          updatedAt: new Date(),
          version: order.version + 1,
        })
        .where(
          and(
            eq(platformCreditPurchaseOrders.id, order.id),
            eq(platformCreditPurchaseOrders.status, 'paid'),
            eq(platformCreditPurchaseOrders.version, order.version),
          ),
        )
        .returning();
      if (!credited) throw new Error(PLATFORM_CREDIT_PURCHASE_STALE_VERSION);
      return credited;
    });
  }
}
