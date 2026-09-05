import { createHash } from 'node:crypto';

import { TravelServiceLedgerAdminModel, TravelServiceLedgerModel } from '@lobechat/database';
import { z } from 'zod';

import type {
  TravelServiceAccountItem,
  TravelServiceLedgerEntryItem,
  TravelServiceOrderItem,
} from '@/database/schemas/serviceLedger';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import { requirePlatformAdmin } from './_helpers/platformAdminGuard';

const customerProcedure = authedProcedure.use(serverDatabase);
const platformAdminProcedure = customerProcedure.use(requirePlatformAdmin);

const limitInput = z
  .object({ limit: z.number().int().min(1).max(200).default(100) })
  .strict()
  .optional();
const auditedWriteBase = {
  idempotencyKey: z.string().trim().min(1).max(128),
  reason: z.string().trim().min(1).max(500),
};

const toCustomerAccount = (account: TravelServiceAccountItem) => ({
  balanceFen: account.balanceFen,
  currency: account.currency,
  updatedAt: account.updatedAt,
});

const toCustomerEntry = (entry: TravelServiceLedgerEntryItem) => ({
  amountFen: entry.amountFen,
  balanceAfterFen: entry.balanceAfterFen,
  createdAt: entry.createdAt,
  type: entry.type,
});

const toPublicOrderId = (internalId: string) =>
  createHash('sha256')
    .update(`travel-service-order-public-id:v1:${internalId}`)
    .digest('base64url');

const toCustomerOrder = (order: TravelServiceOrderItem) => ({
  amountFen: order.amountFen,
  createdAt: order.createdAt,
  id: toPublicOrderId(order.id),
  status: order.status,
  title: order.title,
  updatedAt: order.updatedAt,
});

export const travelServiceLedgerRouter = router({
  getAccount: customerProcedure
    .input(z.undefined())
    .query(async ({ ctx }) =>
      toCustomerAccount(await new TravelServiceLedgerModel(ctx.serverDB, ctx.userId).getAccount()),
    ),
  listEntries: customerProcedure.input(limitInput).query(async ({ ctx, input }) => {
    const entries = await new TravelServiceLedgerModel(ctx.serverDB, ctx.userId).listEntries(
      input?.limit,
    );
    return entries.map(toCustomerEntry);
  }),
  listOrders: customerProcedure.input(limitInput).query(async ({ ctx, input }) => {
    const orders = await new TravelServiceLedgerModel(ctx.serverDB, ctx.userId).listOrders(
      input?.limit,
    );
    return orders.map(toCustomerOrder);
  }),
  adminListAccounts: platformAdminProcedure
    .input(limitInput)
    .query(({ ctx, input }) =>
      new TravelServiceLedgerAdminModel(ctx.serverDB, ctx.userId).listAccounts(input?.limit),
    ),
  adminListEntries: platformAdminProcedure
    .input(limitInput)
    .query(({ ctx, input }) =>
      new TravelServiceLedgerAdminModel(ctx.serverDB, ctx.userId).listAllEntries(input?.limit),
    ),
  adminListOrders: platformAdminProcedure
    .input(limitInput)
    .query(({ ctx, input }) =>
      new TravelServiceLedgerAdminModel(ctx.serverDB, ctx.userId).listAllOrders(input?.limit),
    ),
  adminCreateOrder: platformAdminProcedure
    .input(
      z.object({
        amountFen: z.number().int().min(1).max(2_000_000_000),
        idempotencyKey: z.string().trim().min(1).max(128),
        targetUserId: z.string().trim().min(1).max(255),
        title: z.string().trim().min(1).max(200),
      }),
    )
    .mutation(({ ctx, input }) =>
      new TravelServiceLedgerAdminModel(ctx.serverDB, ctx.userId).createOrder(input),
    ),
  adminPostManualEntry: platformAdminProcedure
    .input(
      z.object({
        ...auditedWriteBase,
        amountFen: z.number().int().min(-2_000_000_000).max(2_000_000_000).refine(Boolean),
        targetUserId: z.string().min(1).max(255),
      }),
    )
    .mutation(({ ctx, input }) =>
      new TravelServiceLedgerAdminModel(ctx.serverDB, ctx.userId).postManualEntry(input),
    ),
  adminReverseEntry: platformAdminProcedure
    .input(z.object({ ...auditedWriteBase, entryId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      new TravelServiceLedgerAdminModel(ctx.serverDB, ctx.userId).reverseEntry(input),
    ),
});
