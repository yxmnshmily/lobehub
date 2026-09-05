import {
  PLATFORM_CREDIT_PURCHASE_IDEMPOTENCY_CONFLICT,
  PLATFORM_CREDIT_PURCHASE_INVALID_INPUT,
  PLATFORM_CREDIT_PURCHASE_INVALID_TRANSITION,
  PLATFORM_CREDIT_PURCHASE_ORDER_NOT_FOUND,
  PLATFORM_CREDIT_PURCHASE_STALE_VERSION,
  PlatformCreditPurchaseModel,
} from '@lobechat/database';
import { TRPCError } from '@trpc/server';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  type PlatformCreditPurchaseOrderItem,
  platformCreditPurchaseOrders,
} from '@/database/schemas/platformCreditPurchase';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const customerProcedure = authedProcedure.use(serverDatabase);

const PURCHASE_PACKAGES = {
  'credits-1m': {
    // Credits exchange denomination only. Provider model costs still use their own per-token pricing.
    amountMinor: 100,
    credits: 1_000_000,
    currency: 'USD',
    id: 'credits-1m',
  },
} as const;

const createOrderInput = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(200),
    packageId: z.literal('credits-1m'),
  })
  .strict();
const listOrdersInput = z
  .object({ limit: z.number().int().min(1).max(50).default(20) })
  .strict()
  .optional();
const cancelOrderInput = z
  .object({
    expectedVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    orderId: z.string().uuid(),
  })
  .strict();

type SafeOrderSource = Pick<
  PlatformCreditPurchaseOrderItem,
  | 'amountMinor'
  | 'createdAt'
  | 'credits'
  | 'currency'
  | 'expiresAt'
  | 'id'
  | 'productId'
  | 'refundStatus'
  | 'status'
  | 'updatedAt'
  | 'version'
>;

const safeOrderSelection = {
  amountMinor: platformCreditPurchaseOrders.amountMinor,
  createdAt: platformCreditPurchaseOrders.createdAt,
  credits: platformCreditPurchaseOrders.credits,
  currency: platformCreditPurchaseOrders.currency,
  expiresAt: platformCreditPurchaseOrders.expiresAt,
  id: platformCreditPurchaseOrders.id,
  productId: platformCreditPurchaseOrders.productId,
  refundStatus: platformCreditPurchaseOrders.refundStatus,
  status: platformCreditPurchaseOrders.status,
  updatedAt: platformCreditPurchaseOrders.updatedAt,
  version: platformCreditPurchaseOrders.version,
} as const;

const toSafeOrder = (order: SafeOrderSource) => ({
  amountMinor: order.amountMinor,
  createdAt: order.createdAt,
  credits: order.credits,
  currency: order.currency,
  expiresAt: order.expiresAt,
  id: order.id,
  productId: order.productId,
  refundStatus: order.refundStatus,
  status: order.status,
  updatedAt: order.updatedAt,
  version: order.version,
});

const unavailableOrder = () => new TRPCError({ code: 'NOT_FOUND', message: '购买订单不可用' });
const conflictedOrder = () => new TRPCError({ code: 'CONFLICT', message: '购买订单状态已变更' });
const invalidOrder = () => new TRPCError({ code: 'BAD_REQUEST', message: '购买订单请求无效' });
const unavailablePurchaseService = (action: '创建' | '取消') =>
  new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `购买订单暂时无法${action}` });

export const platformCreditPurchaseRouter = router({
  cancelOrder: customerProcedure.input(cancelOrderInput).mutation(async ({ ctx, input }) => {
    try {
      const order = await new PlatformCreditPurchaseModel(ctx.serverDB, ctx.userId).transitionOrder(
        {
          expectedVersion: input.expectedVersion,
          orderId: input.orderId,
          status: 'cancelled',
        },
      );
      return toSafeOrder(order);
    } catch (error) {
      if (error instanceof Error && error.message === PLATFORM_CREDIT_PURCHASE_ORDER_NOT_FOUND) {
        throw unavailableOrder();
      }
      if (
        error instanceof Error &&
        (error.message === PLATFORM_CREDIT_PURCHASE_INVALID_TRANSITION ||
          error.message === PLATFORM_CREDIT_PURCHASE_STALE_VERSION)
      ) {
        throw conflictedOrder();
      }
      throw unavailablePurchaseService('取消');
    }
  }),

  createOrder: customerProcedure.input(createOrderInput).mutation(async ({ ctx, input }) => {
    try {
      const order = await new PlatformCreditPurchaseModel(ctx.serverDB, ctx.userId).createOrder({
        idempotencyKey: input.idempotencyKey,
        product: PURCHASE_PACKAGES[input.packageId],
      });
      return toSafeOrder(order);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === PLATFORM_CREDIT_PURCHASE_IDEMPOTENCY_CONFLICT) {
          throw conflictedOrder();
        }
        if (error.message === PLATFORM_CREDIT_PURCHASE_INVALID_INPUT) throw invalidOrder();
      }
      throw unavailablePurchaseService('创建');
    }
  }),

  listOrders: customerProcedure.input(listOrdersInput).query(async ({ ctx, input }) => {
    const orders = await ctx.serverDB
      .select(safeOrderSelection)
      .from(platformCreditPurchaseOrders)
      .where(eq(platformCreditPurchaseOrders.userIdSnapshot, ctx.userId))
      .orderBy(desc(platformCreditPurchaseOrders.createdAt), desc(platformCreditPurchaseOrders.id))
      .limit(input?.limit ?? 20);
    return orders.map(toSafeOrder);
  }),
});
