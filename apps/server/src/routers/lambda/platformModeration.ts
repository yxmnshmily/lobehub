import { Buffer } from 'node:buffer';

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { PlatformModerationAdminModel } from '@/database/models/platformModeration';
import { UserModel } from '@/database/models/user';
import type { PlatformModerationAuditItem } from '@/database/schemas/platformModeration';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import { requirePlatformAdmin } from './_helpers/platformAdminGuard';

const platformAdminProcedure = authedProcedure.use(serverDatabase).use(requirePlatformAdmin);

const recordIdInput = z.object({ id: z.string().uuid() }).strict();
const safetyCursorPattern = /^[\w-]{1,512}$/;
const categorySchema = z.enum([
  'credential',
  'email',
  'government_id',
  'phone',
  'provider_moderation',
]);
const severitySchema = z.enum(['critical', 'high', 'medium']);
const dispositionSchema = z.enum(['pending', 'reviewed', 'cleared', 'ban_recommended']);
const listInput = z
  .object({
    disposition: dispositionSchema.optional(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
    userId: z.string().trim().min(1).max(255).optional(),
    verdict: z.enum(['allow', 'block', 'review']).optional(),
  })
  .strict()
  .optional();
const safetyOverviewInput = z
  .object({
    category: categorySchema.optional(),
    cursor: z.string().regex(safetyCursorPattern).optional(),
    endAt: z.date().optional(),
    limit: z.number().int().min(1).max(50).optional(),
    severity: severitySchema.optional(),
    startAt: z.date().optional(),
    status: dispositionSchema.optional(),
    targetUserId: z.string().trim().min(1).max(255),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.startAt && input.endAt && input.startAt > input.endAt) {
      context.addIssue({ code: 'custom', message: 'startAt must not be after endAt' });
    }
  });

const encodeSafetyCursor = (detectedAt: Date, id: string) =>
  Buffer.from(JSON.stringify([detectedAt.toISOString(), id])).toString('base64url');

const decodeSafetyCursor = (cursor: string) => {
  try {
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) throw new Error('non-canonical-cursor');
    const decoded: unknown = JSON.parse(bytes.toString('utf8'));
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      typeof decoded[0] !== 'string' ||
      typeof decoded[1] !== 'string' ||
      !z.string().uuid().safeParse(decoded[1]).success
    ) {
      throw new Error('invalid-cursor-payload');
    }
    const detectedAt = new Date(decoded[0]);
    if (!Number.isFinite(detectedAt.getTime()) || detectedAt.toISOString() !== decoded[0]) {
      throw new Error('invalid-cursor-time');
    }
    return { detectedAt, id: decoded[1] };
  } catch {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'cursor is invalid' });
  }
};

const toSafeCategories = (record: PlatformModerationAuditItem) =>
  record.categories.map(({ category, count, severity }) => ({ category, count, severity }));

const toSafeSummary = (record: PlatformModerationAuditItem) => ({
  categories: toSafeCategories(record),
  detectedAt: record.detectedAt,
  disposedAt: record.disposedAt,
  disposition: record.disposition,
  id: record.id,
  sourceType: record.sourceType,
  userId: record.userIdSnapshot,
  verdict: record.verdict,
});

const toSafeDetail = (record: PlatformModerationAuditItem) => ({
  ...toSafeSummary(record),
  redactedPreview: record.redactedPreview,
});

const setDisposition = (disposition: 'ban_recommended' | 'cleared' | 'reviewed') =>
  platformAdminProcedure.input(recordIdInput).mutation(async ({ ctx, input }) =>
    toSafeDetail(
      await new PlatformModerationAdminModel(ctx.serverDB, ctx.userId).setDisposition({
        disposition,
        id: input.id,
      }),
    ),
  );

/**
 * Platform-wide moderation audit administration.
 *
 * Deliberately exposes no scan or create procedure: content scanning belongs in
 * trusted generation paths, which persist only the detector's redacted result.
 */
export const platformModerationRouter = router({
  clear: setDisposition('cleared'),

  getRecord: platformAdminProcedure
    .input(recordIdInput)
    .query(async ({ ctx, input }) =>
      toSafeDetail(
        await new PlatformModerationAdminModel(ctx.serverDB, ctx.userId).getRecord(input.id),
      ),
    ),

  getUserSafetyOverview: platformAdminProcedure
    .input(safetyOverviewInput)
    .query(async ({ ctx, input }) => {
      let targetExists: boolean;
      try {
        targetExists = !!(await UserModel.findById(ctx.serverDB, input.targetUserId));
      } catch {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Unable to load moderation safety overview. Please try again.',
        });
      }
      if (!targetExists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Target user was not found' });
      }

      try {
        const result = await new PlatformModerationAdminModel(
          ctx.serverDB,
          ctx.userId,
        ).getUserSafetyOverview({
          category: input.category,
          cursor: input.cursor ? decodeSafetyCursor(input.cursor) : undefined,
          endAt: input.endAt,
          limit: input.limit,
          severity: input.severity,
          startAt: input.startAt,
          status: input.status,
          userId: input.targetUserId,
        });
        return {
          items: result.items.map((item) => ({
            categories: item.categories.map(({ category, count, severity }) => ({
              category,
              count,
              severity,
            })),
            detectedAt: item.detectedAt,
            disposedAt: item.disposedAt,
            disposition: item.disposition,
            id: item.id,
            sourceType: item.sourceType,
            verdict: item.verdict,
          })),
          nextCursor: result.nextCursor
            ? encodeSafetyCursor(result.nextCursor.detectedAt, result.nextCursor.id)
            : null,
          summary: result.summary,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Unable to load moderation safety overview. Please try again.',
        });
      }
    }),

  listRecords: platformAdminProcedure.input(listInput).query(async ({ ctx, input }) => {
    const result = await new PlatformModerationAdminModel(ctx.serverDB, ctx.userId).listRecords(
      input,
    );
    return {
      items: result.items.map(toSafeSummary),
      limit: result.limit,
      offset: result.offset,
      total: result.total,
    };
  }),

  markReviewed: setDisposition('reviewed'),
  recommendBan: setDisposition('ban_recommended'),
});
