import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { type StoreSetter } from '../types';
import { flattenActions } from '../utils/flattenActions';
import { type ResetableStore } from '../utils/resetableStore';
import { type AIProviderStoreState } from './initialState';
import { initialState } from './initialState';
import { type AiModelAction } from './slices/aiModel';
import { createAiModelSlice } from './slices/aiModel';
import { type AiProviderAction } from './slices/aiProvider';
import { createAiProviderSlice } from './slices/aiProvider';

//  ===============  Aggregate createStoreFn ============ //

export interface AiInfraStore
  extends AIProviderStoreState,
    AiProviderAction,
    AiModelAction,
    ResetableStore {
  /* empty */
}

type AiInfraStoreAction = AiProviderAction & AiModelAction & ResetableStore;

class AiInfraStoreResetAction implements ResetableStore {
  readonly #set: StoreSetter<AiInfraStore>;

  constructor(set: StoreSetter<AiInfraStore>, _get: () => AiInfraStore, _api?: unknown) {
    void _get;
    void _api;
    this.#set = set;
  }

  reset = () => {
    this.#set(
      {
        ...initialState,
        activeAiProvider: undefined,
        enabledAiModels: undefined,
        enabledAiProviders: undefined,
        enabledChatModelList: undefined,
        enabledEmbeddingModelList: undefined,
        enabledImageModelList: undefined,
        enabledVideoModelList: undefined,
        hiddenBuiltinModels: undefined,
        isAiModelListInit: undefined,
        modelRedirects: undefined,
      },
      false,
      'resetAiInfraStore',
    );
  };
}

const createStore: StateCreator<AiInfraStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<AiInfraStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<AiInfraStoreAction>([
    createAiModelSlice(...parameters),
    createAiProviderSlice(...parameters),
    new AiInfraStoreResetAction(...parameters),
  ]),
});

//  ===============  Implement useStore ============ //
const devtools = createDevtools('aiInfra');

export const useAiInfraStore = createWithEqualityFn<AiInfraStore>()(devtools(createStore), shallow);

expose('aiInfra', useAiInfraStore);

export const getAiInfraStoreState = () => useAiInfraStore.getState();
