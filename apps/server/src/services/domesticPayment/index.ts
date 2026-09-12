import { PlatformCreditPaymentModel, PlatformCreditPurchaseModel } from '@lobechat/database';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import { CREDIT_PURCHASE_MAX_QUANTITY, CREDIT_PURCHASE_UNIT } from '@/const/creditPurchase';
import {
  platformCreditAccounts,
  platformCreditEntries,
  platformCreditPurchaseOrders,
} from '@/database/schemas';
import type { PlatformCreditPurchaseOrderItem } from '@/database/schemas/platformCreditPurchase';
import type { LobeChatDatabase } from '@/database/type';
import { notifyCreditEntry } from '@/server/services/notification/credit';

import {
  createPayment,
  getCheckoutConfig,
  type PaymentEnvironment,
  type PaymentMethod,
  verifyNotification,
} from './gateways';

const unavailable = () =>
  new TRPCError({ code: 'BAD_REQUEST', message: '支付通道、售价或订单不可用，请刷新后重试。' });
const safeOrder = (order: PlatformCreditPurchaseOrderItem) => ({
  id: order.id,
  status: order.status,
  amountMinor: order.amountMinor,
  currency: order.currency,
  credits: order.credits,
  productId: order.productId,
  createdAt: order.createdAt,
});
export const orderPaymentMethod = (productId: string): PaymentMethod | undefined => {
  const match = /^domestic-credits-\d+m-(alipay|wechat|unionpay)$/.exec(productId);
  return match?.[1] as PaymentMethod | undefined;
};

export async function createCheckout(
  db: LobeChatDatabase,
  userId: string,
  input: {
    quantity: number;
    method: PaymentMethod;
    expectedAmountMinor: number;
    idempotencyKey: string;
  },
  env: PaymentEnvironment = process.env,
) {
  if (
    !Number.isInteger(input.quantity) ||
    input.quantity < 1 ||
    input.quantity > CREDIT_PURCHASE_MAX_QUANTITY
  )
    throw unavailable();
  const config = getCheckoutConfig(env);
  if (!config.unitAmountMinor || !config.methods.find((x) => x.id === input.method)?.enabled)
    throw unavailable();
  const productId = `domestic-credits-${input.quantity}m-${input.method}`;
  const [existing] = await db
    .select()
    .from(platformCreditPurchaseOrders)
    .where(
      and(
        eq(platformCreditPurchaseOrders.userIdSnapshot, userId),
        eq(platformCreditPurchaseOrders.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (existing) {
    if (existing.productId !== productId || existing.amountMinor !== input.expectedAmountMinor)
      throw unavailable();
    return resumeCheckout(db, userId, existing.id, env);
  }
  const amountMinor = config.unitAmountMinor * input.quantity;
  if (input.expectedAmountMinor !== amountMinor) throw unavailable();
  const order = await new PlatformCreditPurchaseModel(db, userId).createOrder({
    idempotencyKey: input.idempotencyKey,
    product: {
      id: productId,
      amountMinor,
      credits: CREDIT_PURCHASE_UNIT.credits * input.quantity,
      currency: 'CNY',
    },
  });
  return resumeCheckout(db, userId, order.id, env);
}

export async function resumeCheckout(
  db: LobeChatDatabase,
  userId: string,
  orderId: string,
  env: PaymentEnvironment = process.env,
) {
  // Commit pending before external I/O: a timeout may still have created a payable remote order.
  const order = await db.transaction(async (tx) => {
    const [order] = await tx
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
    if (!order || !order.userId) throw unavailable();
    const method = orderPaymentMethod(order.productId);
    if (!method || order.currency !== 'CNY') throw unavailable();
    if (['paid', 'credited', 'review_required'].includes(order.status)) return order;
    if (
      !['created', 'payment_pending'].includes(order.status) ||
      Date.now() >= order.createdAt.getTime() + 30 * 60_000
    )
      throw unavailable();
    if (order.status === 'created') {
      const [pending] = await tx
        .update(platformCreditPurchaseOrders)
        .set({ status: 'payment_pending', updatedAt: new Date(), version: order.version + 1 })
        .where(eq(platformCreditPurchaseOrders.id, order.id))
        .returning();
      return pending;
    }
    return order;
  });
  if (order.status !== 'payment_pending') return { order: safeOrder(order), payment: null };
  try {
    return {
      order: safeOrder(order),
      payment: await createPayment(orderPaymentMethod(order.productId)!, order, env),
    };
  } catch {
    throw new TRPCError({
      code: 'BAD_GATEWAY',
      message: '暂时无法发起支付，请在订单列表重试；请勿重复下单。',
    });
  }
}

export async function receivePayment(
  db: LobeChatDatabase,
  method: PaymentMethod,
  body: string,
  headers: Headers,
  env: PaymentEnvironment = process.env,
) {
  const event = verifyNotification(method, body, headers, env);
  if (!event) return;
  const entry = await db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(platformCreditPurchaseOrders)
      .where(eq(platformCreditPurchaseOrders.merchantOrderId, event.merchantOrderId))
      .limit(1)
      .for('update');
    if (!source || !source.userId || orderPaymentMethod(source.productId) !== method)
      throw unavailable();
    const payments = new PlatformCreditPaymentModel(tx as unknown as LobeChatDatabase);
    const result = await payments.recordVerifiedPaymentEvent(event);
    if (result.event.processingStatus !== 'accepted' || !result.order) return;
    const credited = await payments.settlePaidOrder({
      orderId: source.id,
      postCreditEntry: async ({ transaction, order, idempotencyKey }) => {
        await transaction
          .insert(platformCreditAccounts)
          .values({ userId: order.userId, userIdSnapshot: order.userIdSnapshot })
          .onConflictDoNothing({ target: platformCreditAccounts.userIdSnapshot });
        const [account] = await transaction
          .select()
          .from(platformCreditAccounts)
          .where(eq(platformCreditAccounts.userIdSnapshot, order.userIdSnapshot))
          .limit(1)
          .for('update');
        if (!account) throw unavailable();
        const [existing] = await transaction
          .select()
          .from(platformCreditEntries)
          .where(
            and(
              eq(platformCreditEntries.accountId, account.id),
              eq(platformCreditEntries.idempotencyKey, idempotencyKey),
            ),
          )
          .limit(1);
        if (existing) return { entryId: existing.id };
        const balanceAfterCredits = account.balanceCredits + order.credits;
        if (!Number.isSafeInteger(balanceAfterCredits)) throw unavailable();
        const [entry] = await transaction
          .insert(platformCreditEntries)
          .values({
            accountId: account.id,
            userId: order.userId,
            userIdSnapshot: order.userIdSnapshot,
            type: 'top_up',
            amountCredits: order.credits,
            balanceAfterCredits,
            idempotencyKey,
            reason: `在线充值：${method} / ${order.id}`,
            provider: method,
          })
          .returning();
        await transaction
          .update(platformCreditAccounts)
          .set({ balanceCredits: balanceAfterCredits, updatedAt: new Date() })
          .where(eq(platformCreditAccounts.id, account.id));
        return { entryId: entry.id };
      },
    });
    const [posted] = await tx
      .select()
      .from(platformCreditEntries)
      .where(eq(platformCreditEntries.id, credited.creditEntryId!))
      .limit(1);
    return posted;
  });
  if (entry) await notifyCreditEntry(entry);
}
