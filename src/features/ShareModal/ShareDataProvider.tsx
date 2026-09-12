'use client';

import { type ConversationContext, type UIChatMessage } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { createContext, memo, type PropsWithChildren, use, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import {
  dbMessageSelectors,
  displayMessageSelectors,
  topicSelectors,
} from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { type ChatTopic } from '@/types/topic';

interface ShareDataProviderProps {
  context?: Partial<ConversationContext>;
  snapshot?: ShareSnapshot;
}

export interface ShareSnapshot {
  context: ConversationContext;
  messages: UIChatMessage[];
  title: string;
}

interface ShareDataContextValue {
  context: ConversationContext;
  dbMessages: UIChatMessage[];
  displayMessages: UIChatMessage[];
  isLoading: boolean;
  isSnapshot?: boolean;
  systemRole?: string;
  title: string;
  topic?: ChatTopic;
}

const EMPTY_MESSAGES: UIChatMessage[] = [];
const selectEmptyMessages = () => EMPTY_MESSAGES;
const selectUndefinedTopic = () => undefined;

const ShareDataContext = createContext<ShareDataContextValue | null>(null);

const StoredShareDataProvider = memo<PropsWithChildren<ShareDataProviderProps>>(
  ({ children, context }) => {
    const { t } = useTranslation('chat');
    const [activeAgentId, activeGroupId, activeThreadId, activeTopicId, useFetchMessages] =
      useChatStore((s) => [
        s.activeAgentId,
        s.activeGroupId,
        s.activeThreadId,
        s.activeTopicId,
        s.useFetchMessages,
      ]);
    const systemRole = useAgentStore(
      agentByIdSelectors.getAgentSystemRoleById(context?.agentId ?? activeAgentId ?? ''),
    );

    const resolvedContext = useMemo<ConversationContext>(() => {
      const hasTopicId = context && 'topicId' in context;
      const hasThreadId = context && 'threadId' in context;
      const hasGroupId = context && 'groupId' in context;

      return {
        agentId: context?.agentId ?? activeAgentId ?? '',
        groupId: hasGroupId ? context?.groupId : activeGroupId,
        isolatedTopic: context?.isolatedTopic,
        scope: context?.scope,
        threadId: hasThreadId ? context?.threadId : activeThreadId,
        topicId: hasTopicId ? context?.topicId : activeTopicId,
      };
    }, [activeAgentId, activeGroupId, activeThreadId, activeTopicId, context]);

    const shouldSkipFetch = !resolvedContext.agentId || !resolvedContext.topicId;
    const { isLoading } = useFetchMessages(resolvedContext, { skipFetch: shouldSkipFetch });

    const messageKey = useMemo(() => {
      if (!resolvedContext.agentId) return undefined;

      return messageMapKey({
        agentId: resolvedContext.agentId,
        groupId: resolvedContext.groupId,
        isolatedTopic: resolvedContext.isolatedTopic,
        scope: resolvedContext.scope,
        threadId: resolvedContext.threadId,
        topicId: resolvedContext.topicId,
      });
    }, [resolvedContext]);

    const displayMessages = useChatStore(
      messageKey
        ? displayMessageSelectors.getDisplayMessagesByKey(messageKey)
        : selectEmptyMessages,
      isEqual,
    );
    const dbMessages = useChatStore(
      messageKey ? dbMessageSelectors.getDbMessagesByKey(messageKey) : selectEmptyMessages,
      isEqual,
    );
    const topic = useChatStore(
      resolvedContext.topicId
        ? topicSelectors.getTopicById(resolvedContext.topicId)
        : selectUndefinedTopic,
      isEqual,
    );

    const value = useMemo<ShareDataContextValue>(
      () => ({
        context: resolvedContext,
        dbMessages,
        displayMessages,
        isLoading,
        systemRole,
        title: topic?.title || t('shareModal.exportTitle'),
        topic,
      }),
      [dbMessages, displayMessages, isLoading, resolvedContext, systemRole, t, topic],
    );

    return <ShareDataContext value={value}>{children}</ShareDataContext>;
  },
);

StoredShareDataProvider.displayName = 'StoredShareDataProvider';

function ShareDataProvider({ snapshot, ...props }: PropsWithChildren<ShareDataProviderProps>) {
  if (!snapshot) return <StoredShareDataProvider {...props} />;
  return (
    <ShareDataContext
      value={{
        context: snapshot.context,
        dbMessages: snapshot.messages,
        displayMessages: snapshot.messages,
        title: snapshot.title,
        isLoading: false,
        isSnapshot: true,
      }}
    >
      {props.children}
    </ShareDataContext>
  );
}

export const useShareData = () => {
  const context = use(ShareDataContext);

  if (!context) {
    throw new Error('useShareData must be used within ShareDataProvider');
  }

  return context;
};

export default ShareDataProvider;
