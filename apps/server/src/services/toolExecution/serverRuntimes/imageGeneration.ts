import type { ImageGenerationModelSummary } from '@lobechat/builtin-tool-image-generation';
import { ImageGenerationIdentifier } from '@lobechat/builtin-tool-image-generation';
import { ImageGenerationExecutionRuntime } from '@lobechat/builtin-tool-image-generation/executionRuntime';
import type { AiProviderModelListItem } from 'model-bank';

import { aiModelRouter } from '@/server/routers/lambda/aiModel';
import { aiProviderRouter } from '@/server/routers/lambda/aiProvider';
import { generationRouter } from '@/server/routers/lambda/generation';
import { generationTopicRouter } from '@/server/routers/lambda/generationTopic';
import { imageRouter } from '@/server/routers/lambda/image';
import { getPlatformManagedExecutionContext } from '@/server/services/aiAgent/platformManagedExecution';
import { markPlatformAiRuntime, PlatformAiRuntime } from '@/server/services/platformAiRuntime';
import { filterHiddenProviderModels } from '@/utils/aiProvider';

import { type ServerRuntimeRegistration } from './types';

const normalizeModel = (model: AiProviderModelListItem): ImageGenerationModelSummary => ({
  description: model.description,
  displayName: model.displayName,
  id: model.id,
  parameters: model.parameters,
  pricing: model.pricing,
  releasedAt: model.releasedAt,
});

export const imageGenerationRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId) {
      throw new Error('userId is required for Image Generation tool execution');
    }

    const callerContextBase = {
      clientIp: context.clientIp,
      userId: context.userId,
      workspaceId: context.workspaceId,
    };
    const callerContext =
      context.modelRuntimeMode === 'platform-managed'
        ? markPlatformAiRuntime(
            callerContextBase,
            getPlatformManagedExecutionContext(context) ?? {},
          )
        : callerContextBase;
    const aiModelCaller = aiModelRouter.createCaller(callerContext);
    const aiProviderCaller = aiProviderRouter.createCaller(callerContext);
    const generationCaller = generationRouter.createCaller(callerContext);
    const generationTopicCaller = generationTopicRouter.createCaller(callerContext);
    const imageCaller = imageRouter.createCaller(callerContext);

    return new ImageGenerationExecutionRuntime({
      createGenerationTopic: (type, title) =>
        generationTopicCaller.createTopic({
          title,
          type,
          ...(context.agentVisibility === 'private' || context.agentVisibility === 'public'
            ? { visibility: context.agentVisibility }
            : {}),
        }),
      createImage: (payload) => imageCaller.createImage(payload),
      getGenerationStatus: async ({ asyncTaskId, generationId }) => {
        const result = await generationCaller.getGenerationStatus({ asyncTaskId, generationId });
        return {
          ...result,
          asyncTaskId,
          generationId,
        };
      },
      listImageModels: async ({ provider, limit }) => {
        if (context.modelRuntimeMode === 'platform-managed') {
          if (!context.serverDB) {
            throw new Error('serverDB is required for platform-managed image model discovery');
          }
          const platformCatalog = await new PlatformAiRuntime(context.serverDB).listEnabledModels(
            'image',
          );
          const providers = platformCatalog.providers
            .filter((item) => !provider || item.id === provider)
            .map((item) => ({
              id: item.id,
              models: typeof limit === 'number' ? item.models.slice(0, limit) : item.models,
              name: item.id,
            }));

          return {
            providers,
            totalModels: providers.reduce((sum, item) => sum + item.models.length, 0),
          };
        }

        const runtimeState = await aiProviderCaller.getAiProviderRuntimeState({});
        const enabledProviders = provider
          ? runtimeState.enabledImageAiProviders.filter((item) => item.id === provider)
          : runtimeState.enabledImageAiProviders;
        const providers = await Promise.all(
          enabledProviders.map(async (item) => {
            /**
             * Hidden models must be removed before applying the caller's limit, otherwise they
             * consume result slots and can make a provider appear empty despite later visible models.
             */
            const hasHiddenModels = runtimeState.hiddenBuiltinModels?.some(
              (model) => model.providerId === item.id,
            );
            const models = await aiModelCaller.getAiProviderModelList({
              enabled: true,
              id: item.id,
              limit: hasHiddenModels ? undefined : limit,
              type: 'image',
            });
            const visibleModels = filterHiddenProviderModels(
              models,
              item.id,
              runtimeState.hiddenBuiltinModels,
            );
            const limitedModels =
              typeof limit === 'number' ? visibleModels.slice(0, limit) : visibleModels;

            return {
              id: item.id,
              models: limitedModels.map(normalizeModel),
              name: item.name || item.id,
            };
          }),
        );
        const nonEmptyProviders = providers.filter((item) => item.models.length > 0);

        return {
          providers: nonEmptyProviders,
          totalModels: nonEmptyProviders.reduce((sum, item) => sum + item.models.length, 0),
        };
      },
    });
  },
  identifier: ImageGenerationIdentifier,
};
