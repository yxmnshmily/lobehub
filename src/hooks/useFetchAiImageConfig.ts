import { useEffect, useMemo } from 'react';

import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useImageStore } from '@/store/image';
import {
  DEFAULT_AI_IMAGE_MODEL,
  DEFAULT_AI_IMAGE_PROVIDER,
} from '@/store/image/slices/generationConfig/initialState';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { keyVaultsConfigSelectors } from '@/store/user/slices/settings/selectors/keyVaults';

const checkModelEnabled = (
  enabledImageModelList: ReturnType<typeof aiProviderSelectors.enabledImageModelList>,
  provider: string,
  model: string,
) => {
  return enabledImageModelList.some(
    (p) => p.id === provider && p.children.some((m) => m.id === model),
  );
};

export const useFetchAiImageConfig = () => {
  const isStatusInit = useGlobalStore(systemStatusSelectors.isStatusInit);
  const isInitAiProviderRuntimeState = useAiInfraStore(
    aiProviderSelectors.isInitAiProviderRuntimeState,
  );

  const isAuthLoaded = useUserStore(authSelectors.isLoaded);
  const isLogin = useUserStore(authSelectors.isLogin);
  const isActualLogout = isAuthLoaded && isLogin === false;

  const isUserStateInit = useUserStore((s) => s.isUserStateInit);
  const isUserStateReady = isUserStateInit || isActualLogout;

  const isReadyForInit = isStatusInit && isInitAiProviderRuntimeState && isUserStateReady;

  const { lastSelectedImageModel, lastSelectedImageProvider } = useGlobalStore((s) => ({
    lastSelectedImageModel: s.status.lastSelectedImageModel,
    lastSelectedImageProvider: s.status.lastSelectedImageProvider,
  }));
  const isInitializedImageConfig = useImageStore((s) => s.isInit);
  const initializeImageConfig = useImageStore((s) => s.initializeImageConfig);

  const enabledImageModelList = useAiInfraStore(aiProviderSelectors.enabledImageModelList);
  const keyVaults = useUserStore(keyVaultsConfigSelectors.keyVaultsSettings);

  /* 供应商是否已配置凭据：keyVaults 里该供应商任一非空字符串字段即视为已配
     （apiKey / AWS / Azure 等字段形态各异，逐值判断最稳）。
     没配 Key 的供应商不再被选为默认——否则生成必然报 InvalidProviderAPIKey，
     页面只剩"前往配置 OpenAI"卡片，即使用户已配好豆包等其它供应商。 */
  const isProviderReady = (providerId: string) => {
    const vault = (keyVaults as Record<string, Record<string, unknown>> | undefined)?.[providerId];
    return Boolean(
      vault && Object.values(vault).some((v) => typeof v === 'string' && v.trim() !== ''),
    );
  };

  const isModelUsable = (provider: string, model: string) =>
    checkModelEnabled(enabledImageModelList, provider, model) && isProviderReady(provider);

  // Determine which model/provider to use for initialization
  const initParams = useMemo(() => {
    // 1. Try lastSelected if enabled AND its provider has credentials
    if (
      lastSelectedImageModel &&
      lastSelectedImageProvider &&
      isModelUsable(lastSelectedImageProvider, lastSelectedImageModel)
    ) {
      return { model: lastSelectedImageModel, provider: lastSelectedImageProvider };
    }

    // 2. Try default provider/model if enabled AND has credentials
    if (
      checkModelEnabled(enabledImageModelList, DEFAULT_AI_IMAGE_PROVIDER, DEFAULT_AI_IMAGE_MODEL) &&
      isProviderReady(DEFAULT_AI_IMAGE_PROVIDER)
    ) {
      return { model: undefined, provider: undefined }; // Use initialState defaults
    }

    // 2.5 Default model on any provider that has credentials (e.g. Doubao)
    const readyProviderWithDefaultModel = enabledImageModelList.find(
      (p) => isProviderReady(p.id) && p.children.some((m) => m.id === DEFAULT_AI_IMAGE_MODEL),
    );
    if (readyProviderWithDefaultModel) {
      return { model: DEFAULT_AI_IMAGE_MODEL, provider: readyProviderWithDefaultModel.id };
    }

    // 3. First enabled provider WITH credentials (e.g. Doubao), any of its models
    const readyProvider = enabledImageModelList.find((p) => isProviderReady(p.id));
    const readyModel = readyProvider?.children[0];
    if (readyProvider && readyModel) {
      return { model: readyModel.id, provider: readyProvider.id };
    }

    // 4. Fallback to first enabled model (no credentials anywhere — the
    //    InvalidProviderAPIKey card will guide the user to configure one)
    const firstProvider = enabledImageModelList[0];
    const firstModel = firstProvider?.children[0];
    if (firstProvider && firstModel) {
      return { model: firstModel.id, provider: firstProvider.id };
    }

    // No enabled models
    return { model: undefined, provider: undefined };
  }, [
    lastSelectedImageModel,
    lastSelectedImageProvider,
    enabledImageModelList,
    keyVaults,
    isModelUsable,
  ]);

  useEffect(() => {
    if (!isInitializedImageConfig && isReadyForInit) {
      initializeImageConfig(isLogin, initParams.model, initParams.provider);
    }
  }, [isReadyForInit, isInitializedImageConfig, isLogin, initParams, initializeImageConfig]);
};
