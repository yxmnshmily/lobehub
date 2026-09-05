import { BRANDING_PROVIDER, ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { isLobeHubModelAvailable } from '@lobechat/business-model-bank/model-config';
import { resolveBusinessModelMapping } from '@lobechat/business-model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { chargeAfterGenerate } from '@/business/server/image-generation/chargeAfterGenerate';
import { chargeBeforeGenerate } from '@/business/server/image-generation/chargeBeforeGenerate';
import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { GenerationTopicModel } from '@/database/models/generationTopic';
import { UserModel } from '@/database/models/user';
import { type NewGeneration, type NewGenerationBatch } from '@/database/schemas';
import { asyncTasks, generationBatches, generations } from '@/database/schemas';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { createAsyncCaller } from '@/server/routers/async/caller';
import { FileService } from '@/server/services/file';
import {
  getPlatformAiRuntimeCapability,
  getPlatformAiRuntimeMarker,
  PLATFORM_MANAGED_AI_RUNTIME,
} from '@/server/services/platformAiRuntime';
import { PlatformUsageReservationService } from '@/server/services/platformUsageBilling/reservation';
import { buildPlatformImageSettlementIdentity } from '@/server/services/travelGeneration/platformImageSettlementIdentity';
import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  AsyncTaskType,
} from '@/types/asyncTask';
import { generateUniqueSeeds } from '@/utils/number';

import { validateNoUrlsInConfig } from './utils';

const log = debug('lobe-image:lambda');
const PLATFORM_IMAGE_RESERVATION_LEASE_MS = 15 * 60 * 1000;

type PlatformImageReservationHandle = {
  budgetId: string;
  leaseVersion: number;
  reservationId: string;
};

const imageProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      asyncTaskModel: new AsyncTaskModel(ctx.serverDB, ctx.userId, wsId),
      fileService: new FileService(ctx.serverDB, ctx.userId, wsId),
      generationTopicModel: new GenerationTopicModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

const imageCreateProcedure = imageProcedure.use(withScopedPermission('file:upload'));

const createImageInputSchema = z.object({
  generationTopicId: z.string(),
  imageNum: z.number(),
  model: z.string(),
  params: z
    .object({
      cfg: z.number().optional(),
      height: z.number().optional(),
      imageUrls: z.array(z.string()).optional(),
      prompt: z.string(),
      seed: z.number().nullish(),
      steps: z.number().optional(),
      width: z.number().optional(),
    })
    .passthrough(),
  provider: z.string(),
});
export type CreateImageServicePayload = z.infer<typeof createImageInputSchema>;

const isErrorBatchResult = (
  result: unknown,
): result is {
  data: {
    batch: NewGenerationBatch;
    generations: NewGeneration[];
  };
  success: true;
} =>
  typeof result === 'object' &&
  result !== null &&
  'data' in result &&
  'success' in result &&
  result.success === true;

export const imageRouter = router({
  createImage: imageCreateProcedure
    .input(createImageInputSchema)
    .mutation(async ({ input, ctx }) => {
      const { userId, serverDB, asyncTaskModel, fileService, generationTopicModel } = ctx;
      const wsId = ctx.workspaceId ?? undefined;
      const isPlatformManaged = getPlatformAiRuntimeMarker(ctx) === PLATFORM_MANAGED_AI_RUNTIME;
      const platformCapability = getPlatformAiRuntimeCapability(ctx);
      const { generationTopicId, provider, model, imageNum, params } = input;

      if (isPlatformManaged) {
        if (
          !Number.isSafeInteger(platformCapability?.maxCredits) ||
          Number(platformCapability?.maxCredits) <= 0
        ) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message:
              'A trusted positive Credits maximum is required for platform image generation.',
          });
        }
        if (imageNum !== 1) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Platform image generation currently requires exactly one image.',
          });
        }
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '[IMAGE_BILLING_UNAVAILABLE] 平台图片权威计价与费用上限尚不可用。',
        });
      }

      log('Image creation requested: %O', {
        height: params.height,
        imageCount: imageNum,
        referenceImageCount:
          (Array.isArray(params.imageUrls) ? params.imageUrls.length : 0) +
          (typeof params.imageUrl === 'string' && params.imageUrl ? 1 : 0),
        width: params.width,
      });

      const { resolvedModelId } = await resolveBusinessModelMapping(provider, model);

      // Reject lobehub model ids that are no longer in the model bank so callers get a
      // clear error instead of an opaque downstream failure when the underlying channel
      // can't serve the requested id.
      if (
        provider === BRANDING_PROVIDER &&
        !(await isLobeHubModelAvailable(resolvedModelId, 'image', {
          getUserEmail: async () => (await UserModel.findById(serverDB, userId))?.email,
        }))
      ) {
        throw new TRPCError({
          cause: { data: { modelType: 'image', requestedModel: model } },
          code: 'BAD_REQUEST',
          message: ChatErrorType.LobeHubModelDeprecated,
        });
      }

      // Normalize reference image addresses, store S3 keys uniformly (avoid storing expiring presigned URLs in database)
      let configForDatabase = { ...params };
      // 1) Process multiple images in imageUrls
      if (Array.isArray(params.imageUrls) && params.imageUrls.length > 0) {
        log('Normalizing %d reference images for storage', params.imageUrls.length);
        try {
          const imageKeysWithNull = await Promise.all(
            params.imageUrls.map((url) => fileService.getKeyFromFullUrl(url)),
          );
          const imageKeys = imageKeysWithNull.filter((key): key is string => key !== null);

          configForDatabase = {
            ...configForDatabase,
            imageUrls: imageKeys,
          };
          log('Reference image normalization completed: %O', {
            inputCount: params.imageUrls.length,
            normalizedCount: imageKeys.length,
          });
        } catch {
          console.error('Reference image normalization failed');
        }
      }
      // 2) Process single image in imageUrl
      if (typeof params.imageUrl === 'string' && params.imageUrl) {
        try {
          const key = await fileService.getKeyFromFullUrl(params.imageUrl);
          if (key) {
            configForDatabase = { ...configForDatabase, imageUrl: key };
          }
          log('Reference image normalization completed');
        } catch {
          console.error('Reference image normalization failed');
          // Keep original value if conversion fails
        }
      }

      // In development, convert localhost proxy URLs to S3 URLs for async task access
      let generationParams = params;
      if (process.env.NODE_ENV === 'development') {
        const updates: Record<string, unknown> = {};

        // Handle single imageUrl: localhost/f/{id} -> S3 URL
        if (typeof params.imageUrl === 'string' && params.imageUrl) {
          const s3Url = await fileService.getFullFileUrl(configForDatabase.imageUrl as string);
          if (s3Url) {
            updates.imageUrl = s3Url;
          }
        }

        // Handle multiple imageUrls
        if (Array.isArray(params.imageUrls) && params.imageUrls.length > 0) {
          const s3Urls = await Promise.all(
            (configForDatabase.imageUrls as string[]).map((key) => fileService.getFullFileUrl(key)),
          );
          updates.imageUrls = s3Urls;
        }

        if (Object.keys(updates).length > 0) {
          generationParams = { ...params, ...updates };
          log('Development reference image preparation completed');
        }
      }

      // Defensive check: ensure no full URLs enter the database
      validateNoUrlsInConfig(configForDatabase, 'configForDatabase');

      const generationTopic = await generationTopicModel.findById(generationTopicId);
      if (!generationTopic) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Invalid generation topic' });
      }

      // Platform-managed image usage is settled from the provider's actual
      // ModelUsage in the async worker. The legacy business precharge is a
      // separate billing authority and must not run for this path.
      const chargeResult = isPlatformManaged
        ? undefined
        : await chargeBeforeGenerate({
            clientIp: ctx.clientIp,
            configForDatabase,
            generationParams,
            generationTopicId,
            imageNum,
            model,
            provider,
            spendOrigin: ctx.spendOrigin,
            userId,
            workspaceId: wsId,
          });
      // An error batch (insufficient budget / cooldown / frozen workspace) is
      // returned to the client as-is.
      if (isErrorBatchResult(chargeResult)) {
        return chargeResult;
      }
      // Otherwise, opaque per-generation billing handles to thread through each
      // asyncTask so the completion charge can reconcile against them.
      const prechargeItems =
        chargeResult && 'prechargeItems' in chargeResult ? chargeResult.prechargeItems : undefined;

      // Step 1: Atomically create all database records in a transaction
      const { batch: createdBatch, generationsWithTasks } = await serverDB.transaction(
        async (tx) => {
          log('Starting database transaction for image generation');

          // 1. Create generationBatch
          const newBatch: NewGenerationBatch = {
            config: configForDatabase,
            generationTopicId,
            height: params.height,
            model,
            prompt: params.prompt,
            provider,
            userId,
            workspaceId: wsId,
            width: params.width, // Use converted config for database storage
          };
          log('Creating generation batch');
          const [batch] = await tx.insert(generationBatches).values(newBatch).returning();
          log('Generation batch created');

          // 2. Create generations
          const seeds =
            'seed' in params
              ? generateUniqueSeeds(imageNum)
              : Array.from({ length: imageNum }, () => null);
          const newGenerations: NewGeneration[] = Array.from({ length: imageNum }, (_, index) => {
            return {
              generationBatchId: batch.id,
              seed: seeds[index],
              userId,
              workspaceId: wsId,
            };
          });

          log('Creating %d image generations', newGenerations.length);
          const createdGenerations = await tx
            .insert(generations)
            .values(newGenerations)
            .returning();
          log('Image generations created: %d', createdGenerations.length);

          // 3. Concurrently create asyncTask for each generation (within transaction)
          log('Creating async tasks for generations');
          const generationsWithTasks = await Promise.all(
            createdGenerations.map(async (generation, index) => {
              // Create asyncTask directly in transaction, carrying this
              // generation's billing handle (if any) for the completion charge.
              // Presence check (not truthiness): handles are opaque, so falsy
              // values like 0 or '' must still be stored verbatim.
              const prechargeItem = prechargeItems?.[index];
              const taskMetadata = {
                ...(isPlatformManaged ? { platformAiRuntime: true } : {}),
                ...(prechargeItem === undefined ? {} : { precharge: prechargeItem }),
                // The completion charge runs in the async router, which no longer
                // sees this request; carry the origin attribution on the task so
                // it can still be stamped on the spend log. Stored independently
                // of `precharge` because paths without a billing handle (free /
                // unpriced models) still charge at completion.
                ...(ctx.spendOrigin ? { spendOrigin: ctx.spendOrigin } : {}),
              };
              const [createdAsyncTask] = await tx
                .insert(asyncTasks)
                .values({
                  metadata: Object.keys(taskMetadata).length > 0 ? taskMetadata : undefined,
                  status: AsyncTaskStatus.Pending,
                  type: AsyncTaskType.ImageGeneration,
                  userId,
                  workspaceId: wsId,
                })
                .returning();

              const asyncTaskId = createdAsyncTask.id;

              // Update generation's asyncTaskId
              await tx
                .update(generations)
                .set({ asyncTaskId })
                .where(and(eq(generations.id, generation.id), eq(generations.userId, userId)));

              return { asyncTaskId, generation };
            }),
          );

          if (isPlatformManaged) {
            const reservations = new PlatformUsageReservationService(tx as typeof serverDB, userId);
            const limit = {
              maxCredits: platformCapability!.maxCredits as number,
              source: 'user-explicit' as const,
            };
            const expiresAt = new Date(Date.now() + PLATFORM_IMAGE_RESERVATION_LEASE_MS);
            const budget = await reservations.reserveRequest({
              expiresAt,
              idempotencyKey: `platform-image:${batch.id}:request`,
              limit,
              sourceId: batch.id,
              sourceType: 'platform-image-generation',
              workspaceId: wsId,
            });

            for (const item of generationsWithTasks) {
              const settlementIdentity = buildPlatformImageSettlementIdentity(item.generation.id);
              const reservation = await reservations.reserveCall({
                budgetId: budget.id,
                callKind: 'image',
                expiresAt,
                ...settlementIdentity,
                idempotencyKey: `platform-image:${item.generation.id}:call`,
                limit,
                model: resolvedModelId,
                provider,
                workspaceId: wsId,
              });
              const platformUsageReservation: PlatformImageReservationHandle = {
                budgetId: budget.id,
                leaseVersion: reservation.leaseVersion,
                reservationId: reservation.id,
              };
              await tx
                .update(asyncTasks)
                .set({
                  metadata: { platformAiRuntime: true, platformUsageReservation },
                })
                .where(and(eq(asyncTasks.id, item.asyncTaskId), eq(asyncTasks.userId, userId)));
              Object.assign(item, { platformUsageReservation });
            }
          }
          log('All async tasks created in transaction');

          return {
            batch,
            generationsWithTasks,
          };
        },
      );

      log('Database transaction completed successfully. Starting async task triggers directly.');

      // Step 2: Trigger background image generation tasks.
      log('Starting async image generation tasks');

      try {
        log('Creating async image caller');

        // Async router will read keyVaults from DB, no need to pass jwtPayload
        const asyncCaller = await createAsyncCaller({
          ...(isPlatformManaged ? { modelRuntimeMode: PLATFORM_MANAGED_AI_RUNTIME } : {}),
          userId: ctx.userId,
        });

        log('Async image caller created');
        log('Processing %d async image generation tasks', generationsWithTasks.length);

        // Fire-and-forget: trigger async tasks without awaiting
        // These calls go to the async router which handles them independently
        // Do not schedule here; the async router handles these tasks independently.
        generationsWithTasks.forEach((item, index) => {
          const { generation, asyncTaskId } = item;
          void Promise.resolve(
            asyncCaller.image.createImage({
              generationBatchId: createdBatch.id,
              generationId: generation.id,
              generationTopicId,
              model,
              params: generationParams,
              provider,
              taskId: asyncTaskId,
              workspaceId: wsId,
            }),
          ).catch(async () => {
            console.error('Async image dispatch failed');
            try {
              await asyncTaskModel.update(asyncTaskId, {
                error: new AsyncTaskError(
                  AsyncTaskErrorType.TaskTriggerError,
                  AsyncTaskErrorType.TaskTriggerError,
                ),
                status: AsyncTaskStatus.Error,
              });
            } catch {
              console.error('Rejected async image task update failed');
            }

            const platformUsageReservation = (
              item as typeof item & {
                platformUsageReservation?: PlatformImageReservationHandle;
              }
            ).platformUsageReservation;
            if (isPlatformManaged && platformUsageReservation) {
              try {
                await new PlatformUsageReservationService(serverDB, userId).releaseUnclaimed({
                  completeRequest: true,
                  leaseVersion: platformUsageReservation.leaseVersion,
                  reservationId: platformUsageReservation.reservationId,
                });
              } catch {
                console.error('Rejected platform image reservation release failed');
              }
              return;
            }

            const prechargeItem = prechargeItems?.[index];
            if (!ENABLE_BUSINESS_FEATURES || prechargeItem === undefined) return;
            try {
              await chargeAfterGenerate({
                isError: true,
                metadata: {
                  asyncTaskId,
                  generationBatchId: createdBatch.id,
                  modelId: model,
                  topicId: generationTopicId,
                },
                prechargeResult: prechargeItem,
                provider,
                userId,
                workspaceId: wsId,
              });
            } catch {
              console.error('Rejected image task billing reconciliation failed');
            }
          });
        });

        log('All %d background async image generation tasks started', generationsWithTasks.length);
      } catch {
        console.error('Async image task startup failed');

        // If overall failure occurs, update all task statuses to failed
        try {
          await Promise.allSettled(
            generationsWithTasks.map(({ asyncTaskId }) =>
              asyncTaskModel.update(asyncTaskId, {
                error: new AsyncTaskError(
                  AsyncTaskErrorType.TaskTriggerError,
                  AsyncTaskErrorType.TaskTriggerError,
                ),
                status: AsyncTaskStatus.Error,
              }),
            ),
          );
        } catch {
          console.error('Async image task status update failed');
        }

        if (isPlatformManaged) {
          await Promise.allSettled(
            generationsWithTasks.map(async (item) => {
              const platformUsageReservation = (
                item as typeof item & {
                  platformUsageReservation?: PlatformImageReservationHandle;
                }
              ).platformUsageReservation;
              if (!platformUsageReservation) return;
              try {
                await new PlatformUsageReservationService(serverDB, userId).releaseUnclaimed({
                  completeRequest: true,
                  leaseVersion: platformUsageReservation.leaseVersion,
                  reservationId: platformUsageReservation.reservationId,
                });
              } catch {
                console.error('Failed platform image reservation release failed');
              }
            }),
          );
        }

        // The async router never ran for these tasks, so its failure billing
        // reconciliation cannot fire — reconcile each generation's billing
        // handle here instead of leaving it dangling.
        if (ENABLE_BUSINESS_FEATURES && prechargeItems?.length) {
          await Promise.allSettled(
            generationsWithTasks.map(async ({ asyncTaskId }, index) => {
              const prechargeItem = prechargeItems[index];
              if (prechargeItem === undefined) return;
              try {
                await chargeAfterGenerate({
                  isError: true,
                  metadata: {
                    ...ctx.spendOrigin,
                    asyncTaskId,
                    generationBatchId: createdBatch.id,
                    modelId: model,
                    topicId: generationTopicId,
                  },
                  prechargeResult: prechargeItem,
                  provider,
                  userId,
                  workspaceId: wsId,
                });
              } catch {
                console.error('Failed image task billing reconciliation failed');
              }
            }),
          );
        }
      }

      const createdGenerations = generationsWithTasks.map((item) => ({
        ...item.generation,
        asyncTaskId: item.asyncTaskId,
      }));
      log('Image creation process completed successfully: %O', {
        generationCount: createdGenerations.length,
      });

      return {
        data: {
          batch: createdBatch,
          generations: createdGenerations,
        },
        success: true,
      };
    }),
});

export type ImageRouter = typeof imageRouter;
