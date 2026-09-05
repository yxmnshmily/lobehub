import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { TravelGenerationIdempotencyConflictError } from '@/server/services/travelGeneration';
import { deriveTravelOrderIdempotency } from '@/server/services/travelGeneration/idempotency';
import {
  createTravelGenerationOrchestrator,
  createTravelGenerationSettlementService,
} from '@/server/services/travelGeneration/production';
import { toPublicTravelGenerationTask } from '@/server/services/travelGeneration/public';

const groupId = z.string().min(1).max(255);
const maxCredits = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const copyInput = z.object({ prompt: z.string().min(1).max(12_000) }).strict();
const documentInput = z
  .object({
    content: z.string().min(1).max(100_000).optional(),
    prompt: z.string().min(1).max(12_000).optional(),
    title: z.string().min(1).max(120),
  })
  .strict()
  .refine((value) => Boolean(value.content || value.prompt), 'content or prompt is required');
const imageInput = z
  .object({
    imageNum: z.literal(1).optional(),
    prompt: z.string().min(1).max(4000),
  })
  .strict();
const videoInput = z.object({ prompt: z.string().min(1).max(4000) }).strict();
const createInput = z.discriminatedUnion('type', [
  z
    .object({
      groupId,
      input: copyInput,
      maxCredits,
      orderId: z.string().uuid(),
      type: z.literal('copy'),
    })
    .strict(),
  z
    .object({
      groupId,
      input: documentInput,
      maxCredits,
      orderId: z.string().uuid(),
      type: z.literal('document'),
    })
    .strict(),
  z
    .object({
      groupId,
      input: imageInput,
      maxCredits,
      orderId: z.string().uuid(),
      type: z.literal('image'),
    })
    .strict(),
  z
    .object({ groupId, input: videoInput, orderId: z.string().uuid(), type: z.literal('video') })
    .strict(),
]);

export const travelGenerationRouter = router({
  create: wsCompatProcedure
    .use(serverDatabase)
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      if (input.type === 'image') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            '[CAPABILITY_UNAVAILABLE] 当前图片生成尚未提供服务端可强制的成本上限，暂不提交生成任务。',
        });
      }
      const owner = {
        groupId: input.groupId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      };
      const orchestrator = createTravelGenerationOrchestrator({
        db: ctx.serverDB,
        groupId: input.groupId,
        idempotency: deriveTravelOrderIdempotency({
          input: input.input,
          maxCredits: input.type === 'video' ? undefined : input.maxCredits,
          orderId: input.orderId,
          owner,
          type: input.type,
        }),
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
      let task;
      try {
        task = await orchestrator.run({
          input: input.input,
          ...(input.type === 'video' ? {} : { maxCredits: input.maxCredits }),
          orderId: input.orderId,
          owner,
          type: input.type,
        });
      } catch (error) {
        if (error instanceof TravelGenerationIdempotencyConflictError) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: '同一服务订单已用于不同的生成内容，请使用新的订单重试。',
          });
        }
        throw error;
      }
      return toPublicTravelGenerationTask(task);
    }),
  get: wsCompatProcedure
    .use(serverDatabase)
    .input(z.object({ taskId: z.string().min(1).max(255) }).strict())
    .query(async ({ ctx, input }) => {
      const settlement = createTravelGenerationSettlementService({
        db: ctx.serverDB,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
      const task = await settlement.reconcile(input.taskId);
      if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Generation task not found' });
      return toPublicTravelGenerationTask(task);
    }),
});
