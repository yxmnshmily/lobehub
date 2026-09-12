import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import {
  buildMappedBusinessModelFields,
  resolveBusinessModelMapping,
} from '@lobechat/business-model-runtime';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';

import { getProviderContentPolicyErrorMessage } from '@/business/server/getProviderContentPolicyErrorMessage';
import { trackProviderContentPolicyViolation } from '@/business/server/trackProviderContentPolicyViolation';
import { chargeAfterGenerate } from '@/business/server/video-generation/chargeAfterGenerate';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { GenerationModel } from '@/database/models/generation';
import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { VideoGenerationService } from '@/server/services/generation/video';
import { buildVideoGenerationFilePayload } from '@/server/services/generation/videoFile';
import { notifyGenerationFailed } from '@/server/services/notification/generation';
import { PlatformAiRuntime } from '@/server/services/platformAiRuntime';
import { AsyncTaskError, AsyncTaskErrorType, AsyncTaskStatus } from '@/types/asyncTask';
import { FileSource } from '@/types/files';
import type { VideoGenerationAsset } from '@/types/generation';

const log = debug('lobe-video:background-polling');

interface BackgroundPollingParams {
  asyncTaskCreatedAt: Date;
  asyncTaskId: string;
  generationBatchId: string;
  generationId: string;
  generationTopicId: string;
  inferenceId: string;
  model: string;
  modelRuntimeMode?: 'platform-managed';
  prechargeResult?: any;
  provider: string;
  userId: string;
  workspaceId?: string;
}

export async function processBackgroundVideoPolling(
  db: LobeChatDatabase,
  params: BackgroundPollingParams,
): Promise<void> {
  const {
    asyncTaskCreatedAt,
    asyncTaskId,
    generationBatchId,
    generationId,
    generationTopicId,
    inferenceId,
    model,
    modelRuntimeMode,
    prechargeResult,
    provider,
    userId,
    workspaceId,
  } = params;

  log(
    'Starting background video polling for task: %s (provider: %s, inferenceId: %s)',
    asyncTaskId,
    provider,
    inferenceId,
  );

  let resolvedModelId = model;
  try {
    const asyncTaskModel = new AsyncTaskModel(db, userId, workspaceId);
    const videoService = new VideoGenerationService(db, userId, workspaceId);
    const generationModel = new GenerationModel(db, userId, workspaceId);

    ({ resolvedModelId } = await resolveBusinessModelMapping(provider, model));

    const modelRuntime =
      modelRuntimeMode === 'platform-managed'
        ? await new PlatformAiRuntime(db).init({
            actorUserId: userId,
            provider,
            workspaceId,
          })
        : await initModelRuntimeFromDB(db, userId, provider, workspaceId);
    const pollResult = await pollUntilCompletion(modelRuntime, inferenceId);

    if (!pollResult) {
      throw new Error('Polling completed but no video URL returned');
    }

    log('Video polling succeeded for task: %s, processing video...', asyncTaskId);

    const processResult = await videoService.processVideoForGeneration(pollResult.videoUrl, {
      headers: pollResult.headers,
    });

    const asset: VideoGenerationAsset = {
      coverUrl: processResult.coverKey,
      duration: processResult.duration,
      height: processResult.height,
      originalUrl: pollResult.videoUrl,
      thumbnailUrl: processResult.thumbnailKey,
      type: 'video',
      url: processResult.videoKey,
      width: processResult.width,
    };

    const batch = await db.query.generationBatches.findFirst({
      where: (batches, { eq }) => eq(batches.id, generationBatchId),
    });

    await generationModel.createAssetAndFile(
      generationId,
      asset,
      buildVideoGenerationFilePayload({
        generationId,
        processResult,
        prompt: batch?.prompt,
      }),
      FileSource.VideoGeneration,
    );

    const duration = Date.now() - asyncTaskCreatedAt.getTime();

    await asyncTaskModel.update(asyncTaskId, {
      duration,
      status: AsyncTaskStatus.Success,
    });

    if (ENABLE_BUSINESS_FEATURES && prechargeResult !== undefined) {
      try {
        await chargeAfterGenerate({
          computePriceParams: {
            generateAudio: (batch?.config as any)?.generateAudio,
            resolution: (batch?.config as any)?.resolution,
          },
          latency: duration,
          metadata: {
            asyncTaskId,
            generationBatchId,
            topicId: generationTopicId,
            ...buildMappedBusinessModelFields({
              provider,
              requestedModelId: resolvedModelId === model ? undefined : model,
              resolvedModelId,
            }),
          },
          model: resolvedModelId,
          prechargeResult,
          provider,
          usage: undefined,
          userId,
          workspaceId,
        });
      } catch (chargeError) {
        console.error('[video-polling] Failed to charge after generation:', chargeError);
      }
    }

    log('Video processing completed successfully for task: %s', asyncTaskId);
  } catch (error) {
    log('Background video polling error for task: %s', asyncTaskId, error);

    const asyncTaskModel = new AsyncTaskModel(db, userId, workspaceId);
    const providerContentPolicyMessage = await getProviderContentPolicyErrorMessage({
      error,
      provider,
      trigger: RequestTrigger.Video,
      userId,
    });
    if (providerContentPolicyMessage) {
      try {
        await trackProviderContentPolicyViolation({
          error,
          model,
          provider,
          trigger: 'video-polling',
          userId,
        });
      } catch (trackError) {
        log('Failed to track provider content policy violation: %O', trackError);
      }
    }
    await asyncTaskModel.update(asyncTaskId, {
      error: new AsyncTaskError(
        providerContentPolicyMessage
          ? AsyncTaskErrorType.ProviderContentModeration
          : AsyncTaskErrorType.ServerError,
        providerContentPolicyMessage ??
          'Background polling failed: ' +
            (error instanceof Error ? error.message : 'Unknown error'),
      ),
      status: AsyncTaskStatus.Error,
    });

    await notifyGenerationFailed({
      kind: 'video',
      asyncTaskId,
      topicId: generationTopicId,
      userId,
      workspaceId,
    });

    if (ENABLE_BUSINESS_FEATURES && prechargeResult !== undefined) {
      try {
        await chargeAfterGenerate({
          isError: true,
          metadata: {
            asyncTaskId,
            generationBatchId,
            topicId: generationTopicId,
            ...buildMappedBusinessModelFields({
              provider,
              requestedModelId: resolvedModelId === model ? undefined : model,
              resolvedModelId,
            }),
          },
          model: resolvedModelId,
          prechargeResult,
          provider,
          userId,
          workspaceId,
        });
      } catch (refundError) {
        console.error('[video-polling] Failed to refund precharge:', refundError);
      }
    }
  }
}

async function pollUntilCompletion(
  modelRuntime: any,
  inferenceId: string,
): Promise<{ headers?: Record<string, string>; videoUrl: string } | null> {
  const maxRetries = 120;
  const pollingInterval = 5000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      log('Polling attempt %d/%d for task: %s', attempt + 1, maxRetries, inferenceId);

      const result = await modelRuntime.handlePollVideoStatus(inferenceId);

      if (result.status === 'success') {
        log('Video generation succeeded for task: %s', inferenceId);
        return { headers: result.headers, videoUrl: result.videoUrl };
      }

      if (result.status === 'failed') {
        throw new Error(`Video generation failed: ${result.error}`);
      }

      log('Task %s still in progress', inferenceId);
      await sleep(pollingInterval);
    } catch (error) {
      if (error instanceof Error && error.message.includes('failed')) {
        throw error;
      }
      log('Polling attempt %d failed for task: %s: %O', attempt + 1, inferenceId, error);
      await sleep(pollingInterval);
    }
  }

  throw new Error(
    `Video generation timeout after ${maxRetries} attempts (${(maxRetries * pollingInterval) / 1000}s)`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
