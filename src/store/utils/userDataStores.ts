import { unstable_batchedUpdates } from 'react-dom';

import { useAgentStore } from '@/store/agent';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useAiInfraStore } from '@/store/aiInfra';
import { useBriefStore } from '@/store/brief';
import { useChatStore } from '@/store/chat';
import { useDiscoverStore } from '@/store/discover';
import { useDocumentStore } from '@/store/document';
import { useEvalStore } from '@/store/eval';
import { useFileStore } from '@/store/file';
import { useFollowUpActionStore } from '@/store/followUpAction';
import { useGoalStore } from '@/store/goal';
import { useGroupProfileStore } from '@/store/groupProfile';
import { useHomeStore } from '@/store/home';
import { useImageStore } from '@/store/image';
import { useKnowledgeBaseStore } from '@/store/library';
import { useMentionStore } from '@/store/mention';
import { useNotebookStore } from '@/store/notebook';
import { usePageStore } from '@/store/page';
import { useProjectStore } from '@/store/project';
import { useSessionStore } from '@/store/session';
import { useTaskStore } from '@/store/task';
import { useToolStore } from '@/store/tool';
import { useTopicCommentStore } from '@/store/topicComment';
import { useTreeStore } from '@/store/tree';
import { useUserStore } from '@/store/user';
import { useUserMemoryStore } from '@/store/userMemory';
import type { ResetableStore } from '@/store/utils/resetableStore';
import { useVerifyStore } from '@/store/verify';
import { useVideoStore } from '@/store/video';

interface ResetableStoreApi {
  getState: () => ResetableStore;
}

const resetableStores: ResetableStoreApi[] = [
  useAgentGroupStore,
  useAgentStore,
  useAiInfraStore,
  useBriefStore,
  useChatStore,
  useDiscoverStore,
  useDocumentStore,
  useEvalStore,
  useFileStore,
  useFollowUpActionStore,
  useGoalStore,
  useGroupProfileStore,
  useHomeStore,
  useImageStore,
  useKnowledgeBaseStore,
  useMentionStore,
  useNotebookStore,
  usePageStore,
  useProjectStore,
  useSessionStore,
  useTaskStore,
  useToolStore,
  useTopicCommentStore,
  useTreeStore,
  useUserMemoryStore,
  useUserStore,
  useVideoStore,
  useVerifyStore,
];

export interface StoreActions extends ResetableStore {}

const createStoreActions = (stores: ResetableStoreApi[]): StoreActions => ({
  reset: () => {
    unstable_batchedUpdates(() => {
      for (const store of stores) {
        store.getState().reset();
      }
    });
  },
});

export const stores = createStoreActions(resetableStores);
