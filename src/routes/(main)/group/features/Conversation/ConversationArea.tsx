'use client';

import { GROUP_RECENT_MESSAGE_LIMIT } from '@lobechat/const';
import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID, type UIChatMessage } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Alert, Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  memo,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import {
  TopicMigrationPlaceholder,
  useTopicMigrationPending,
} from '@/features/AgentTransferMigration';
import ChatMiniMap from '@/features/ChatMiniMap';
import {
  type ChatInputProps,
  ChatList,
  type ChatListProps,
  ConversationProvider,
} from '@/features/Conversation';
import { useMessageDeepLink } from '@/features/Conversation/ChatList/hooks/useMessageDeepLink';
import { resolveMessageDeepLink } from '@/features/Conversation/ChatList/utils/messageDeepLink';
import {
  ForwardMessageDispatcher,
  MessageForwardFooter,
} from '@/features/Conversation/MessageForward';
import GroupHistoryNotice, { GroupRecentNotice } from '@/features/SuperGroup/GroupHistoryNotice';
import GroupWorkPage from '@/features/SuperGroup/GroupWorkPage';
import GroupWorkPanel from '@/features/SuperGroup/GroupWorkPanel';
import { useGroupWorkRequest } from '@/features/SuperGroup/useGroupWorkRequest';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useOperationState } from '@/hooks/useOperationState';
import { lambdaQuery } from '@/libs/trpc/client';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

import WelcomeChatItem from './AgentWelcome';
import ChatHydration from './ChatHydration';
import MainChatInput from './MainChatInput';
import MessageFromUrl from './MainChatInput/MessageFromUrl';
import ThreadHydration from './ThreadHydration';
import { useActionsBarConfig } from './useActionsBarConfig';
import { useGroupContext } from './useGroupContext';
import { useGroupConversationMessages } from './useGroupConversationMessages';

interface ConversationAreaProps {
  mobile?: boolean;
}

/** The single group conversation template. Hosts supply data/permissions, not UI forks. */
export function GroupConversationBody({
  groupId,
  mobile = false,
  listProps,
  listContent,
  composer,
  beforeInput,
  showRecentNotice = false,
  runtimeProps,
  children,
}: {
  groupId?: string | null;
  mobile?: boolean;
  listProps?: ChatListProps;
  listContent?: ReactNode;
  composer?: ReactNode;
  beforeInput?: ReactNode;
  showRecentNotice?: boolean;
  runtimeProps?: ChatInputProps;
  children?: ReactNode;
}) {
  const request = useGroupWorkRequest((s) => s.request);
  const workKind = request?.groupId === groupId ? request?.kind : undefined;
  const navigate = useWorkspaceAwareNavigate();
  const detailOpen = !!workKind && !!request?.detail;
  const listOpen = !!workKind && !detailOpen;
  useEffect(
    () => () => {
      if (useGroupWorkRequest.getState().request?.groupId === groupId)
        useGroupWorkRequest.setState({ request: null });
    },
    [groupId],
  );
  return (
    <Flexbox
      data-group-work-body
      flex={1}
      style={{ minHeight: 0, minWidth: 0, position: 'relative' }}
    >
      <Flexbox
        aria-hidden={listOpen}
        flex={1}
        inert={listOpen}
        style={{
          minHeight: 0,
          minWidth: 0,
          position: 'relative',
          visibility: listOpen ? 'hidden' : undefined,
        }}
      >
        <Flexbox
          className={styles.messageScroller}
          flex={1}
          style={{ minHeight: 0, overflowX: 'hidden', overflowY: 'auto', position: 'relative' }}
          width="100%"
        >
          {listContent ?? <ChatList {...listProps} />}
        </Flexbox>
        {showRecentNotice && !listOpen && <GroupRecentNotice />}
        {beforeInput}
        {groupId && <GroupWorkPanel groupId={groupId} key={groupId} />}
        {composer ?? (
          <MessageForwardFooter>
            <MainChatInput runtimeProps={runtimeProps} />
          </MessageForwardFooter>
        )}
        {!mobile && !workKind && <ChatMiniMap />}
      </Flexbox>
      {workKind && (
        <Flexbox
          data-group-work-page={workKind}
          style={{
            position: 'absolute',
            inset: 0,
            insetInlineStart: detailOpen ? 'auto' : 0,
            width: detailOpen ? 'min(100%, 1000px)' : undefined,
            zIndex: detailOpen ? 5 : undefined,
            boxShadow: detailOpen ? cssVar.boxShadowSecondary : undefined,
            minHeight: 0,
            overflow: 'hidden',
            background: cssVar.colorBgContainer,
          }}
        >
          {detailOpen && (
            <Flexbox horizontal gap={8} justify="flex-end" padding={8}>
              <Button
                onClick={() => {
                  navigate(
                    `/group/${encodeURIComponent(groupId!)}/${workKind === 'goals' ? 'goal' : 'task'}/${encodeURIComponent(request!.detail!.id)}`,
                  );
                  useGroupWorkRequest.setState({ request: null });
                }}
              >
                展开完整页面
              </Button>
              <Button onClick={() => useGroupWorkRequest.setState({ request: null })}>
                关闭详情
              </Button>
            </Flexbox>
          )}
          <GroupWorkPage
            detail={request?.detail}
            groupId={groupId ?? undefined}
            key={`${groupId}:${workKind}:${request?.detail?.id ?? ''}`}
            kind={workKind}
          />
        </Flexbox>
      )}
      {children}
    </Flexbox>
  );
}

/* 消息列滚动容器：真正滚动的是里层 VirtualizedList 的 VList
   （[data-conversation-viewport]，overflow-y: auto 且 contain: strict），
   外层 Flexbox 只是布局壳（overflow hidden），不能在这里预留槽——那只会
   把内容往里挤而里层滚动条原样不动（2026-09-18 实测）。
   样式直接作用于 VList：8px 滚动条贴其右缘（=容器右缘=窗口右缘），
   both-edges 在左侧对称预留，内容左右对齐。 */
const styles = createStaticStyles(({ css, cssVar: v }) => ({
  messageScroller: css`
    [data-conversation-viewport] {
      scrollbar-gutter: stable both-edges;

      &::-webkit-scrollbar {
        width: 8px;
      }

      &::-webkit-scrollbar-thumb {
        border-radius: 4px;
        background: ${v.colorFillSecondary};
      }

      &::-webkit-scrollbar-track {
        background: transparent;
      }
    }
  `,
}));

/**
 * ConversationArea
 *
 * Main conversation area component using the new ConversationStore architecture.
 * Uses ChatList from @/features/Conversation and MainChatInput for custom features.
 */
const Conversation = memo<ConversationAreaProps>(({ mobile = false }) => {
  const { t } = useTranslation('chat');
  const baseContext = useGroupContext();
  const params = useParams<{ topicId?: string }>();
  const historyTopicId = !baseContext.threadId ? params.topicId : undefined;
  const context = historyTopicId ? { ...baseContext, topicId: historyTopicId } : baseContext;
  const { agentId, groupId } = context;
  const operationState = useOperationState(context);
  const managed = useAgentGroupStore(
    (s) =>
      !!context.groupId &&
      s.groupMap[context.groupId]?.clientId === DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
  );
  const messageDeepLink = useMessageDeepLink();

  // Get raw dbMessages from ChatStore for this context.
  // ConversationStore will parse them internally to generate displayMessages.
  const replaceMessages = useChatStore((s) => s.replaceMessages);
  const liveMessages = useGroupConversationMessages(context);
  const history = lambdaQuery.message.getMessages.useInfiniteQuery(
    {
      groupId: context.groupId,
      topicId: historyTopicId,
      topicOnly: true,
      pageSize: GROUP_RECENT_MESSAGE_LIMIT,
      includeFileWorks: true,
    },
    {
      enabled: !!context.groupId && !!historyTopicId && !operationState.isInputLoading,
      gcTime: 0,
      retry: false,
      getNextPageParam: (lastPage, pages) =>
        lastPage.length >= GROUP_RECENT_MESSAGE_LIMIT ? pages.length : undefined,
    },
  );
  const loadingHistory = useRef(false);
  const loadOlderHistory = useCallback(async () => {
    if (loadingHistory.current || operationState.isInputLoading) return;
    loadingHistory.current = true;
    try {
      // Mutations update the normal message store. Refresh every loaded page
      // before extending the offset window so edits/deletions cannot reappear,
      // and deleted rows cannot shift a boundary past an unread message.
      const refreshed = await history.refetch();
      if (
        !refreshed.isError &&
        (refreshed.data?.pages.at(-1)?.length ?? 0) >= GROUP_RECENT_MESSAGE_LIMIT
      )
        await history.fetchNextPage();
    } finally {
      loadingHistory.current = false;
    }
  }, [history, operationState.isInputLoading]);
  const messages = useMemo(() => {
    if (!historyTopicId)
      return managed && !context.threadId
        ? liveMessages?.slice(-GROUP_RECENT_MESSAGE_LIMIT)
        : liveMessages;
    if (history.hasNextPage && !messageDeepLink) return undefined;
    return history.data && !history.isError ? liveMessages : undefined;
  }, [
    historyTopicId,
    history.data,
    history.isError,
    history.hasNextPage,
    messageDeepLink,
    liveMessages,
    managed,
    context.threadId,
  ]);
  // Use the existing message store after hydration so edits, sends and streaming
  // keep their normal update path instead of being overwritten by a query snapshot.
  useLayoutEffect(() => {
    if (!historyTopicId || !history.data || history.isError) return;
    const historyContext = { agentId, groupId, scope: 'group' as const, topicId: historyTopicId };
    if (operationSelectors.isInputLoadingByContext(historyContext)(useChatStore.getState())) return;
    const items = [
      ...new Map(
        history.data.pages
          .flatMap((page) => page as UIChatMessage[])
          .map((message) => [message.id, message]),
      ).values(),
    ].sort((a, b) => Number(a.createdAt) - Number(b.createdAt) || a.id.localeCompare(b.id));
    replaceMessages(items, { context: historyContext, source: 'fetch' });
  }, [
    historyTopicId,
    groupId,
    agentId,
    history.data,
    history.dataUpdatedAt,
    history.isError,
    replaceMessages,
  ]);
  useEffect(() => {
    if (
      historyTopicId &&
      history.data &&
      (!messageDeepLink || !messages || !resolveMessageDeepLink(messages, messageDeepLink)) &&
      history.hasNextPage &&
      !history.isFetching &&
      !history.isError &&
      !operationState.isInputLoading
    )
      void history.fetchNextPage();
  }, [
    historyTopicId,
    messageDeepLink,
    messages,
    history,
    operationState.isInputLoading,
    loadOlderHistory,
  ]);

  const actionsBarConfig = useActionsBarConfig();

  // A topic still awaiting its transfer/copy backfill shows a placeholder
  // instead of an empty (not-yet-migrated) history, and blocks sending — the
  // supervisor could not assemble the missing context anyway. Opening it jumps
  // it to the front of the queue, so the wait is typically a few seconds.
  const { job: migrationJob, topicPending } = useTopicMigrationPending(
    { groupId: context.groupId },
    context.topicId,
  );

  return (
    <ConversationProvider
      actionsBar={actionsBarConfig}
      context={context}
      hasInitMessages={!!messages}
      messages={messages}
      operationState={operationState}
      skipFetch={!!historyTopicId}
      onMessagesChange={(messages, ctx, meta) => {
        replaceMessages(messages, { context: ctx, source: meta?.source });
      }}
    >
      <GroupConversationBody
        groupId={context.groupId}
        mobile={mobile}
        showRecentNotice={managed && !context.threadId && !historyTopicId}
        beforeInput={
          context.groupId && !context.threadId && historyTopicId ? (
            <GroupHistoryNotice groupId={context.groupId} history={!!historyTopicId} />
          ) : undefined
        }
        composer={
          topicPending ? (
            <Flexbox
              horizontal
              align={'center'}
              justify={'center'}
              paddingBlock={6}
              paddingInline={16}
            >
              <span
                style={{ color: cssVar.colorTextDescription, fontSize: 12, textAlign: 'center' }}
              >
                {t(
                  migrationJob?.type === 'copy'
                    ? 'transferMigration.inputDisabledHintCopy'
                    : 'transferMigration.inputDisabledHint',
                )}
              </span>
            </Flexbox>
          ) : undefined
        }
        listContent={
          historyTopicId && history.isError ? (
            <Alert
              action={<Button onClick={() => void history.refetch()}>重试</Button>}
              title="话题加载失败"
              type="error"
            />
          ) : topicPending ? (
            <TopicMigrationPlaceholder groupId={context.groupId} topicId={context.topicId} />
          ) : undefined
        }
        listProps={{
          initialPosition: historyTopicId ? 'start' : 'restore',
          messageDeepLink,
          welcome: <WelcomeChatItem />,
          headerSlot:
            historyTopicId && history.hasNextPage ? (
              <Button
                disabled={history.isFetching || operationState.isInputLoading}
                loading={history.isFetching}
                onClick={() => void loadOlderHistory()}
              >
                加载该话题更早消息
              </Button>
            ) : undefined,
        }}
      >
        <ChatHydration />
        <ThreadHydration />
        <ForwardMessageDispatcher />
        {!mobile && (
          <>
            {/* Held back while the topic is still migrating: the composer above is
              already disabled, and letting `?message=` through would send into
              the not-yet-migrated history this screen is waiting for. The param
              stays in the URL, so the send fires once the backfill lands. */}
            {!topicPending && (
              <Suspense>
                <MessageFromUrl />
              </Suspense>
            )}
          </>
        )}
      </GroupConversationBody>
    </ConversationProvider>
  );
});

Conversation.displayName = 'ConversationArea';

export default Conversation;
