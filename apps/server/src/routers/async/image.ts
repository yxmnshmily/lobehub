import { ASYNC_TASK_TIMEOUT } from '@lobechat/business-config/server';
import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import {
  buildMappedBusinessModelFields,
  resolveBusinessModelMapping,
} from '@lobechat/business-model-runtime';
import { type CreateImageMethodOptions } from '@lobechat/model-runtime';
import { AsyncTaskError, AsyncTaskStatus, RequestTrigger } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { type RuntimeImageGenParams } from 'model-bank';
import { z } from 'zod';

import { getProviderContentPolicyErrorMessage } from '@/business/server/getProviderContentPolicyErrorMessage';
import { chargeAfterGenerate } from '@/business/server/image-generation/chargeAfterGenerate';
import { notifyImageCompleted } from '@/business/server/image-generation/notifyImageCompleted';
import { createImageBusinessMiddleware } from '@/business/server/trpc-middlewares/async';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { FileModel } from '@/database/models/file';
import { GenerationModel } from '@/database/models/generation';
import { GenerationBatchModel } from '@/database/models/generationBatch';
import { asyncAuthedProcedure, asyncRouter as router } from '@/libs/trpc/async';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { GenerationService } from '@/server/services/generation';
import { PlatformAiRuntime } from '@/server/services/platformAiRuntime';
import { PlatformUsageReservationService } from '@/server/services/platformUsageBilling/reservation';
import { buildPlatformImageSettlementIdentity } from '@/server/services/travelGeneration/platformImageSettlementIdentity';
import { recoverPlatformImageReservation } from '@/server/services/travelGeneration/settlement';
import { sanitizeFileName } from '@/utils/sanitizeFileName';

import { categorizeImageGenerationError } from './imageError';

const log = debug('lobe-image:async');

const imageProcedure = asyncAuthedProcedure.use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      asyncTaskModel: new AsyncTaskModel(ctx.serverDB, ctx.userId),
      fileModel: new FileModel(ctx.serverDB, ctx.userId),
      generationBatchModel: new GenerationBatchModel(ctx.serverDB, ctx.userId),
      generationModel: new GenerationModel(ctx.serverDB, ctx.userId),
      generationService: new GenerationService(ctx.serverDB, ctx.userId),
    },
  });
});

const createImageInputSchema = z.object({
  generationBatchId: z.string(),
  generationId: z.string(),
  generationTopicId: z.string(),
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
  taskId: z.string(),
  workspaceId: z.string().optional(),
});

/**
 * Checks if the abort signal has been triggered and throws an error if so
 */
const checkAbortSignal = (signal: AbortSignal) => {
  if (signal.aborted) {
    throw new Error('Operation was aborted');
  }
};

type PlatformImageUsageReservationHandle = {
  budgetId: string;
  leaseVersion: number;
  reservationId: string;
};

const readPlatformImageUsageReservationHandle = (
  value: unknown,
): PlatformImageUsageReservationHandle => {
  if (!value || typeof value !== 'object') {
    throw new Error('Platform image usage reservation is unavailable.');
  }
  const handle = value as Record<string, unknown>;
  if (
    typeof handle.budgetId !== 'string' ||
    !handle.budgetId ||
    !Number.isSafeInteger(handle.leaseVersion) ||
    (handle.leaseVersion as number) <= 0 ||
    typeof handle.reservationId !== 'string' ||
    !handle.reservationId
  ) {
    throw new Error('Platform image usage reservation is invalid.');
  }
  return handle as PlatformImageUsageReservationHandle;
};

export const imageRouter = router({
  createImage: imageProcedure
    .use(createImageBusinessMiddleware)
    .input(createImageInputSchema)
    .mutation(async ({ input, ctx }) => {
      const {
        taskId,
        generationId,
        generationBatchId,
        generationTopicId,
        provider,
        model,
        params,
        workspaceId,
      } = input;
      const asyncTaskModel = new AsyncTaskModel(ctx.serverDB, ctx.userId, workspaceId);
      const generationBatchModel = new GenerationBatchModel(ctx.serverDB, ctx.userId, workspaceId);
      const generationModel = new GenerationModel(ctx.serverDB, ctx.userId, workspaceId);
      const generationService = new GenerationService(ctx.serverDB, ctx.userId, workspaceId);

      // Check if generationBatch exists before processing
      const generationBatch = await generationBatchModel.findById(generationBatchId);
      if (!generationBatch) {
        log('Image generation batch unavailable');
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Invalid Request!' });
      }

      // Billing context is loaded inside the guarded section below so that a
      // failure (e.g. a stale model mapping) still marks the task as Error and
      // reconciles the precharge handle; the error path falls back to identity
      // mapping when resolution itself is what failed.
      // requestedModelId is optional on the mapping result, so it must allow
      // undefined even though it defaults to the raw model id.
      let requestedModelId: string | undefined = model;
      let resolvedModelId = model;
      let platformManagedExecution = false;
      let prechargeResult: unknown;
      let platformReservationHandle: PlatformImageUsageReservationHandle | undefined;
      let platformReservationOwned = false;
      let platformProviderClaimAttempted = false;

      log('Claiming pending image task');
      const claimed = await asyncTaskModel.transitionStatus(
        taskId,
        [AsyncTaskStatus.Pending],
        AsyncTaskStatus.Processing,
      );
      if (!claimed) {
        const existingTask = await asyncTaskModel.findById(taskId);
        if (!existingTask) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Invalid Request!' });
        }
        const metadata = existingTask.metadata as
          { platformAiRuntime?: unknown; platformUsageReservation?: unknown } | undefined;
        if (ctx.modelRuntimeMode === 'platform-managed' && metadata?.platformAiRuntime === true) {
          const reservations = new PlatformUsageReservationService(ctx.serverDB, ctx.userId);
          const recovery = await recoverPlatformImageReservation({
            allowReleaseReserved: existingTask.status === AsyncTaskStatus.Error,
            identity: { generationId, provider, workspaceId },
            metadata,
            runtime: {
              findPlatformImageReservation: (id) => reservations.getReservation(id),
              releasePlatformImageReservation: async (reservation) =>
                (await reservations.releaseUnclaimed(reservation)).reservation,
              settlePlatformImageReservation: async (reservation) =>
                (
                  await reservations.completeAndSettle({
                    ...reservation,
                    completeRequest: true,
                  })
                ).reservation,
            },
          });
          if (recovery.state === 'settled') {
            const generation = await generationModel.findByIdAndTransform(generationId);
            if (generation?.asset?.type === 'image' && generation.asset.url) {
              await asyncTaskModel.update(taskId, { status: AsyncTaskStatus.Success });
            }
          }
        }
        log('Image task already claimed: %s', existingTask.status);
        return { success: true };
      }

      // Use AbortController to prevent resource leaks
      const abortController = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const isEditingImage =
        Boolean((params as any).imageUrl) ||
        Boolean(params.imageUrls && params.imageUrls.length > 0);

      try {
        // Opaque billing handle stored on the task at submission time; threaded
        // to the completion charge so it can reconcile the pre-submission
        // billing. Loaded before the model mapping so the handle is available
        // for reconciliation even when mapping resolution throws.
        const asyncTask = await asyncTaskModel.findById(taskId);
        const taskMetadata = asyncTask?.metadata as
          | {
              platformAiRuntime?: unknown;
              platformUsageReservation?: unknown;
              precharge?: unknown;
            }
          | undefined;
        prechargeResult = taskMetadata?.precharge;
        const requestedPlatformManagedExecution =
          ctx.modelRuntimeMode === 'platform-managed' && taskMetadata?.platformAiRuntime === true;
        platformManagedExecution = requestedPlatformManagedExecution;

        const platformUsageReservationService = platformManagedExecution
          ? new PlatformUsageReservationService(ctx.serverDB, ctx.userId)
          : undefined;
        if (platformUsageReservationService) {
          platformReservationHandle = readPlatformImageUsageReservationHandle(
            taskMetadata?.platformUsageReservation,
          );
          const reservation = await platformUsageReservationService.getReservation(
            platformReservationHandle.reservationId,
          );
          const settlementIdentity = buildPlatformImageSettlementIdentity(generationId);
          if (
            !reservation ||
            reservation.id !== platformReservationHandle.reservationId ||
            reservation.budgetId !== platformReservationHandle.budgetId ||
            reservation.leaseVersion !== platformReservationHandle.leaseVersion ||
            reservation.generationId !== settlementIdentity.generationId ||
            reservation.generationType !== settlementIdentity.generationType ||
            reservation.callKind !== 'image' ||
            reservation.provider !== provider ||
            (reservation.workspaceId ?? null) !== (workspaceId ?? null) ||
            reservation.status !== 'reserved'
          ) {
            throw new Error('Platform image usage reservation does not match this task.');
          }
          platformReservationOwned = true;
        }
        if (requestedPlatformManagedExecution && prechargeResult !== undefined) {
          // A business precharge plus the platform Credits ledger would create
          // two billing authorities for one image. The platform reservation is
          // validated first so the error path can safely release it without
          // ever invoking legacy completion billing.
          throw new Error('Platform-managed image billing cannot reuse a business precharge.');
        }

        log('Starting async image generation: %O', {
          imageParams: {
            height: params.height,
            steps: params.steps,
            width: params.width,
          },
        });

        // Resolve model mapping up front so both the success and error billing
        // paths can reference the resolved model id.
        ({ requestedModelId, resolvedModelId } = await resolveBusinessModelMapping(
          provider,
          model,
        ));

        if (platformUsageReservationService && platformReservationHandle) {
          const reservation = await platformUsageReservationService.getReservation(
            platformReservationHandle.reservationId,
          );
          if (!reservation || reservation.model !== resolvedModelId) {
            throw new Error('Platform image usage reservation does not match the resolved model.');
          }
        }

        const imageGenerationPromise = async (signal: AbortSignal) => {
          log('Initializing image model runtime');

          // Read user's provider config from database
          const modelRuntime = platformManagedExecution
            ? await new PlatformAiRuntime(ctx.serverDB).init({
                actorUserId: ctx.userId,
                provider,
                workspaceId,
              })
            : await initModelRuntimeFromDB(ctx.serverDB, ctx.userId, provider, workspaceId);

          // Check if operation has been cancelled
          checkAbortSignal(signal);
          let settlementLeaseVersion = platformReservationHandle?.leaseVersion;
          if (platformUsageReservationService && platformReservationHandle) {
            platformProviderClaimAttempted = true;
            const claim = await platformUsageReservationService.claim({
              leaseVersion: platformReservationHandle.leaseVersion,
              reservationId: platformReservationHandle.reservationId,
            });
            if (!claim.shouldCallProvider) {
              log('Platform image provider call already claimed');
              return { success: true };
            }
            settlementLeaseVersion = claim.reservation.leaseVersion;
          }
          log('Agent runtime initialized, calling createImage');
          const runtimeOptions: CreateImageMethodOptions = {
            metadata: {
              generationBatchId,
              generationId,
              taskId,
              trigger: RequestTrigger.Image,
            },
          };
          const response = await modelRuntime.createImage!(
            {
              model: resolvedModelId,
              params: params as unknown as RuntimeImageGenParams,
            },
            runtimeOptions,
          );

          if (!response) {
            log('Create image response is empty');
            throw new Error('Create image response is empty');
          }

          log('Create image response received: %O', {
            hasActualUsage: Boolean(response.modelUsage),
            height: response.height,
            width: response.width,
          });

          const { modelUsage } = response;

          if (
            platformUsageReservationService &&
            platformReservationHandle &&
            settlementLeaseVersion
          ) {
            const settlementInput = {
              completeRequest: true,
              leaseVersion: settlementLeaseVersion,
              reservationId: platformReservationHandle.reservationId,
              ...(modelUsage === undefined ? {} : { usage: modelUsage }),
            } as const;
            try {
              await platformUsageReservationService.completeAndSettle(settlementInput);
            } catch {
              // The settlement primitives are idempotent. One bounded replay
              // recovers an interrupted ledger write without calling the image
              // provider a second time.
              await platformUsageReservationService.completeAndSettle(settlementInput);
            }
          }

          // Check if operation has been cancelled
          checkAbortSignal(signal);

          log('Image generation successful: %O', {
            height: response.height,
            width: response.width,
          });

          log('Transforming image for generation');
          const { imageUrl, width, height } = response;

          // Extract ComfyUI authentication headers if provider is ComfyUI
          let authHeaders: Record<string, string> | undefined;
          if (provider === 'comfyui') {
            // Use the public interface method to get auth headers
            // This avoids accessing private members and exposing credentials
            authHeaders = modelRuntime.getAuthHeaders();
          }

          const { image, thumbnailImage } = await generationService.transformImageForGeneration(
            imageUrl,
            authHeaders,
          );

          // Check if operation has been cancelled
          checkAbortSignal(signal);

          log('Uploading image for generation');
          const { imageUrl: uploadedImageUrl, thumbnailImageUrl } =
            await generationService.uploadImageForGeneration(image, thumbnailImage);

          // Check if operation has been cancelled
          checkAbortSignal(signal);

          log('Updating generation asset and file');
          await generationModel.createAssetAndFile(
            generationId,
            {
              height: height ?? image.height,
              // Platform-managed provider URLs can contain short-lived signatures or credentials.
              // Persist only the controlled uploaded locator for those executions.
              originalUrl:
                platformManagedExecution || imageUrl.startsWith('data:')
                  ? uploadedImageUrl
                  : imageUrl,
              thumbnailUrl: thumbnailImageUrl,
              type: 'image',
              url: uploadedImageUrl,
              width: width ?? image.width,
            },
            {
              fileHash: image.hash,
              fileType: image.mime,
              metadata: {
                generationId,
                height: image.height,
                path: uploadedImageUrl,
                width: image.width,
              },
              name: `${sanitizeFileName(params.prompt, generationId)}.${image.extension}`,
              size: image.size,
              url: uploadedImageUrl,
            },
          );

          const duration = Date.now() - generationBatch.createdAt.getTime();

          log('Updating image task status to success');
          await asyncTaskModel.update(taskId, {
            duration,
            status: AsyncTaskStatus.Success,
          });

          try {
            await notifyImageCompleted({
              duration,
              generationBatchId,
              model,
              prompt: params.prompt,
              topicId: generationTopicId,
              userId: ctx.userId,
              workspaceId,
            });
          } catch {
            console.error('[image-async] notification failed');
          }

          if (ENABLE_BUSINESS_FEATURES && !platformManagedExecution) {
            // Contain success-billing errors: the image is already delivered and
            // the task marked Success, so a billing failure here must not fall
            // into the outer catch and be reconciled as a generation failure.
            try {
              await chargeAfterGenerate({
                metrics: { latency: duration },
                metadata: {
                  asyncTaskId: taskId,
                  generationBatchId,
                  topicId: generationTopicId,
                  ...buildMappedBusinessModelFields({
                    provider,
                    requestedModelId,
                    resolvedModelId,
                  }),
                },
                modelUsage,
                prechargeResult,
                pricingContext: runtimeOptions.pricingContext,
                provider,
                userId: ctx.userId,
                workspaceId,
              });
            } catch {
              console.error('[image-async] success billing failed');
            }
          }

          log('Async image generation completed successfully');
          return { success: true };
        };

        // Set timeout to cancel operation and prevent resource leaks
        timeoutId = setTimeout(() => {
          log('Image generation timeout, aborting operation');
          abortController.abort();
        }, ASYNC_TASK_TIMEOUT);

        const result = await imageGenerationPromise(abortController.signal);

        // Clean up timeout timer
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        return result;
      } catch (error: any) {
        // Clean up timeout timer
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        // Improved error categorization logic
        const providerContentPolicyMessage = await getProviderContentPolicyErrorMessage({
          error,
          provider,
          trigger: RequestTrigger.Image,
          userId: ctx.userId,
        });
        const { errorType, errorMessage } = categorizeImageGenerationError({
          error,
          isEditingImage,
          isAborted: abortController.signal.aborted,
          providerContentPolicyMessage,
        });

        log('Async image generation failed: %s', errorType);

        await asyncTaskModel.update(taskId, {
          error: new AsyncTaskError(errorType, errorMessage),
          status: AsyncTaskStatus.Error,
        });

        log('Image task status updated to error: %s', errorType);

        if (
          platformManagedExecution &&
          platformReservationOwned &&
          !platformProviderClaimAttempted &&
          platformReservationHandle
        ) {
          try {
            await new PlatformUsageReservationService(ctx.serverDB, ctx.userId).releaseUnclaimed({
              completeRequest: true,
              leaseVersion: platformReservationHandle.leaseVersion,
              reservationId: platformReservationHandle.reservationId,
            });
          } catch {
            console.error('[image-async] failed to release unclaimed platform reservation');
          }
        }

        // Reconcile the pre-submission billing on failure. Wrapped so a billing
        // error never masks the original failure report.
        if (ENABLE_BUSINESS_FEATURES && !platformManagedExecution) {
          try {
            await chargeAfterGenerate({
              isError: true,
              metadata: {
                asyncTaskId: taskId,
                generationBatchId,
                topicId: generationTopicId,
                ...buildMappedBusinessModelFields({
                  provider,
                  requestedModelId,
                  resolvedModelId,
                }),
              },
              prechargeResult,
              provider,
              userId: ctx.userId,
              workspaceId,
            });
          } catch {
            console.error('[image-async] failed to reconcile billing on error');
          }
        }

        return {
          message: `Image generation ${taskId} failed: ${errorMessage}`,
          success: false,
        };
      }
    }),
});
