import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  PlatformCreditAdminModel,
  PlatformCreditModel,
  type PlatformCreditPendingReservationItem,
} from '@/database/models/platformCredit';
import type {
  PlatformCreditAccountItem,
  PlatformCreditEntryItem,
} from '@/database/schemas/platformCredit';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { notifyCreditEntry } from '@/server/services/notification/credit';
import { getRegistrationCredits } from '@/server/services/user/registrationCredits';

import { requirePlatformAdmin } from './_helpers/platformAdminGuard';

const customerProcedure = authedProcedure.use(serverDatabase);
const platformAdminProcedure = customerProcedure.use(requirePlatformAdmin);

const safeIntegerCredits = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const positiveCredits = safeIntegerCredits.min(1);
const nonZeroCredits = safeIntegerCredits.refine((credits) => credits !== 0, {
  message: 'Credits must not be zero',
});
const targetUserId = z.string().trim().min(1).max(255);
const idempotencyKey = z.string().trim().min(1).max(200);
const reason = z.string().trim().min(1).max(500);
const entryId = z.string().uuid();
const limit = z.number().int().min(1).max(200).optional();

const listOwnEntriesInput = z.object({ limit }).strict().optional();
const targetUserInput = z.object({ targetUserId }).strict();
const listUserEntriesInput = z
  .object({
    limit,
    offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    targetUserId,
  })
  .strict();
const postCreditsInput = z
  .object({
    credits: safeIntegerCredits,
    idempotencyKey,
    reason,
    targetUserId,
  })
  .strict();
const reverseInput = z.object({ entryId, idempotencyKey, reason }).strict();

const assertSafeCredits = (credits: number, allowNegative: boolean) => {
  if (!Number.isSafeInteger(credits) || (!allowNegative && credits < 0)) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Credits ledger contains invalid data',
    });
  }
  return credits;
};

const toSafeAccount = (account: PlatformCreditAccountItem) => ({
  balanceCredits: assertSafeCredits(account.balanceCredits, false),
  updatedAt: account.updatedAt,
});

const toAdminEntry = (entry: PlatformCreditEntryItem) => ({
  amountCredits: assertSafeCredits(entry.amountCredits, true),
  balanceAfterCredits: assertSafeCredits(entry.balanceAfterCredits, false),
  costUsd: entry.costUsd,
  createdAt: entry.createdAt,
  generationId: entry.generationId,
  generationType: entry.generationType,
  id: entry.id,
  model: entry.model,
  provider: entry.provider,
  reason: entry.reason,
  reversalOfEntryId: entry.reversalOfEntryId,
  type: entry.type,
  updatedAt: entry.updatedAt,
});

const toCustomerEntry = (entry: PlatformCreditEntryItem) => ({
  amountCredits: assertSafeCredits(entry.amountCredits, true),
  balanceAfterCredits: assertSafeCredits(entry.balanceAfterCredits, false),
  createdAt: entry.createdAt,
  id: entry.id,
  type: entry.type,
});

const toAdminPendingReservation = (reservation: PlatformCreditPendingReservationItem) => ({
  actorUserId: reservation.actorUserId,
  callKind: reservation.callKind,
  createdAt: reservation.createdAt,
  expiresAt: reservation.expiresAt,
  generationId: reservation.generationId,
  generationType: reservation.generationType,
  id: reservation.id,
  model: reservation.model,
  payerUserId: reservation.payerUserId,
  provider: reservation.provider,
  providerRequestId: reservation.providerRequestId,
  reservedCredits: assertSafeCredits(reservation.reservedCredits, false),
  settledCredits: assertSafeCredits(reservation.settledCredits, false),
  status: reservation.status,
  updatedAt: reservation.updatedAt,
});

export const platformCreditRouter = router({
  getOwnRegistrationCredits: customerProcedure
    .input(z.undefined())
    .query(({ ctx }) => getRegistrationCredits(ctx.serverDB, ctx.userId)),
  adjust: platformAdminProcedure
    .input(postCreditsInput.extend({ credits: nonZeroCredits }))
    .mutation(async ({ ctx, input }) => {
      const entry = await new PlatformCreditAdminModel(ctx.serverDB, ctx.userId).adjust(input);
      await notifyCreditEntry(entry);
      return toAdminEntry(entry);
    }),

  getOwnAccount: customerProcedure
    .input(z.undefined())
    .query(async ({ ctx }) =>
      toSafeAccount(await new PlatformCreditModel(ctx.serverDB, ctx.userId).getAccount()),
    ),

  getUserAccount: platformAdminProcedure
    .input(targetUserInput)
    .query(async ({ ctx, input }) =>
      toSafeAccount(
        await new PlatformCreditAdminModel(ctx.serverDB, ctx.userId).getAccountForUser(
          input.targetUserId,
        ),
      ),
    ),

  listOwnEntries: customerProcedure.input(listOwnEntriesInput).query(async ({ ctx, input }) => {
    const entries = await new PlatformCreditModel(ctx.serverDB, ctx.userId).listEntries(
      input?.limit,
    );
    return entries.map(toCustomerEntry);
  }),

  listUserEntries: platformAdminProcedure
    .input(listUserEntriesInput)
    .query(async ({ ctx, input }) => {
      const entries = await new PlatformCreditAdminModel(
        ctx.serverDB,
        ctx.userId,
      ).listEntriesForUser(input.targetUserId, input.limit, input.offset);
      return entries.map(toAdminEntry);
    }),

  listPendingReservations: platformAdminProcedure
    .input(listUserEntriesInput)
    .query(async ({ ctx, input }) => {
      const reservations = await new PlatformCreditAdminModel(
        ctx.serverDB,
        ctx.userId,
      ).listPendingReservationsForUser(input.targetUserId, input.limit, input.offset);
      return reservations.map(toAdminPendingReservation);
    }),

  reverse: platformAdminProcedure.input(reverseInput).mutation(async ({ ctx, input }) => {
    const entry = await new PlatformCreditAdminModel(ctx.serverDB, ctx.userId).reverse(input);
    await notifyCreditEntry(entry);
    return toAdminEntry(entry);
  }),

  topUp: platformAdminProcedure
    .input(postCreditsInput.extend({ credits: positiveCredits }))
    .mutation(async ({ ctx, input }) => {
      const entry = await new PlatformCreditAdminModel(ctx.serverDB, ctx.userId).topUp(input);
      await notifyCreditEntry(entry);
      return toAdminEntry(entry);
    }),
});
