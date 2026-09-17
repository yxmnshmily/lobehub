'use client';

import { GROUP_RECENT_MESSAGE_LIMIT } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { Alert, Avatar, Button, Text } from '@lobehub/ui/base-ui';
import { useEffect, useMemo } from 'react';

import SkeletonBar from '@/components/Skeleton/Bar';
import { RuntimeModelContext } from '@/features/ChatInput/RuntimeModelContext';
import { ConversationProvider } from '@/features/Conversation';
import { useMessageDeepLink } from '@/features/Conversation/ChatList/hooks/useMessageDeepLink';
import { resolveMessageDeepLink } from '@/features/Conversation/ChatList/utils/messageDeepLink';
import { GroupAgentMetaContext } from '@/features/Conversation/hooks/useAgentMeta';
import { DEFAULT_OPERATION_STATE } from '@/features/Conversation/types/operation';
import ConversationFrame from '@/features/SuperGroup/ConversationFrame';
import ConversationHeader from '@/features/SuperGroup/ConversationHeader';
import GroupHeaderActions from '@/features/SuperGroup/GroupHeaderActions';
import GroupHistoryNotice, { GroupHistoryAction } from '@/features/SuperGroup/GroupHistoryNotice';
import GroupWelcome from '@/features/SuperGroup/GroupWelcome';
import JoinedConversationShareButton from '@/features/SuperGroup/JoinedConversationShareButton';
import JoinedGroupSidebar, {
  SuperGroupSidebarBody,
} from '@/features/SuperGroup/JoinedGroupSidebar';
import { toConversationMessages } from '@/features/SuperGroup/memberMessages';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useServerConfigStore } from '@/store/serverConfig';

import MobileSidebar from '../../_layout/MobileSidebar';
import type { MemberGroupSummary } from '../../_layout/useGroupRouteAccess';
import { GroupConversationBody } from '../Conversation/ConversationArea';
import { useMemberConversation } from './useMemberConversation';

interface MemberConversationProps {
  group: MemberGroupSummary;
  onUnavailable: () => void;
  showDesktopSidebar?: boolean;
}

/** Membership supplies authorized data and commands, never a second conversation template. */
const MemberConversation = ({
  group,
  onUnavailable,
  showDesktopSidebar = true,
}: MemberConversationProps) => {
  const mobileClient = useServerConfigStore((state) => state.isMobile);
  const narrowViewport = useIsMobile();
  const mobile = mobileClient || narrowViewport;
  const router = useQueryRoute();
  const runtime = useMemberConversation(group, onUnavailable);
  const {
    activeTopicId,
    messages,
    participantsQuery,
    messagesQuery,
    topicsQuery,
    publishedMessagesQuery,
    hasQueryError,
    aiTaskStatus,
    feedback,
  } = runtime;
  const conversationMessages = useMemo(() => {
    const items = toConversationMessages(
      group.groupId,
      activeTopicId,
      messages,
      participantsQuery.data?.assistants,
    );
    return runtime.historyTopicId ? items : items.slice(-GROUP_RECENT_MESSAGE_LIMIT);
  }, [
    group.groupId,
    activeTopicId,
    messages,
    participantsQuery.data?.assistants,
    runtime.historyTopicId,
  ]);
  const groupAgentMeta = useMemo(
    () =>
      Object.fromEntries(
        (participantsQuery.data?.assistants ?? []).map((agent) => [
          agent.id,
          {
            title: agent.isSupervisor ? '旅游群' : agent.title || 'AI 助理',
            avatar: agent.avatar || undefined,
          },
        ]),
      ),
    [participantsQuery.data?.assistants],
  );
  const mentionItems = useMemo(
    () =>
      runtime.assistants.map((agent) => ({
        key: agent.id,
        label: agent.title || '成员',
        metadata: { id: agent.id, type: 'agent' },
      })),
    [runtime.assistants],
  );
  const messageDeepLink = useMessageDeepLink();
  useEffect(() => {
    if (
      runtime.historyTopicId &&
      (!messageDeepLink || !resolveMessageDeepLink(conversationMessages, messageDeepLink)) &&
      messagesQuery.hasNextPage &&
      !messagesQuery.isError &&
      !messagesQuery.isFetchingNextPage
    )
      void messagesQuery.fetchNextPage();
  }, [messageDeepLink, conversationMessages, messagesQuery, runtime.historyTopicId]);

  const busy = ['submitting', 'queued', 'running', 'waiting'].includes(aiTaskStatus);
  const statusText = {
    completed: '旅游群主AI任务已完成',
    failed: '旅游群主AI任务执行失败',
    idle: undefined,
    interrupted: '旅游群主AI任务已停止',
    queued: '旅游群主AI任务已排队',
    running: '旅游群主AI正在执行任务',
    submitting: '正在交给旅游群主AI…',
    waiting: '等待群主确认，请联系群主查看。',
  }[aiTaskStatus];
  const scopeKey = `member:${group.groupId}:${group.membershipVersion}`;
  const supervisor = participantsQuery.data?.assistants.find((agent) => agent.isSupervisor);
  if (runtime.accessUnavailable) return null;

  return (
    <RuntimeModelContext
      value={{
        model: supervisor?.model || '',
        provider: supervisor?.provider || '',
        status: participantsQuery.isError
          ? 'error'
          : participantsQuery.isLoading
            ? 'loading'
            : 'ready',
        retry: () => void participantsQuery.refetch(),
      }}
    >
      <GroupAgentMetaContext value={groupAgentMeta}>
        <ConversationProvider
          skipFetch
          context={{ agentId: '', groupId: group.groupId, scope: 'group', topicId: null }}
          hooks={runtime.conversationHooks}
          key={scopeKey}
          messages={conversationMessages}
          operationState={{
            ...DEFAULT_OPERATION_STATE,
            isAIGenerating: busy,
            isInputLoading: busy,
            isInputVisiblyLoading: busy,
          }}
        >
          {!mobile && showDesktopSidebar && (
            <JoinedGroupSidebar groupId={group.groupId} onSelectTopic={runtime.setActiveTopicId} />
          )}
          <MobileSidebar
            disabled={!mobile}
            sidebar={
              <SuperGroupSidebarBody
                groupId={group.groupId}
                onSelectTopic={runtime.setActiveTopicId}
              />
            }
          >
            <Flexbox horizontal flex={1} height="100%" style={{ minHeight: 0, minWidth: 0 }}>
              <ConversationFrame
                header={
                  <ConversationHeader
                    mobile={mobile}
                    title={group.title || '超级工作群'}
                    right={
                      <GroupHeaderActions
                        groupId={group.groupId}
                        mobile={mobile}
                        share={
                          <JoinedConversationShareButton
                            groupId={group.groupId}
                            messages={conversationMessages}
                            mobile={mobile}
                            title={group.title || '群聊'}
                            topicId={activeTopicId}
                          />
                        }
                        shareOptions={{
                          snapshot: {
                            context: {
                              agentId: '',
                              groupId: group.groupId,
                              topicId: activeTopicId ?? null,
                              scope: 'group',
                              threadId: null,
                            },
                            messages: conversationMessages,
                            title: group.title || '群聊',
                          },
                        }}
                      >
                        <GroupHistoryAction groupId={group.groupId} />
                      </GroupHeaderActions>
                    }
                    onBack={() => router.push('/group/default', { replace: true })}
                  />
                }
              >
                <GroupConversationBody
                  groupId={group.groupId}
                  mobile={mobile}
                  showRecentNotice={!runtime.historyTopicId}
                  beforeInput={
                    <Flexbox gap={12} paddingBlock={12}>
                      {runtime.historyTopicId && (
                        <GroupHistoryNotice
                          sendToRecent
                          groupId={group.groupId}
                          history={!!runtime.historyTopicId}
                        />
                      )}
                      {feedback && <Alert showIcon title={feedback} type="error" />}
                      {statusText && (
                        <Alert
                          showIcon
                          title={statusText}
                          action={
                            runtime.canInterruptAiTask ? (
                              <Button
                                loading={runtime.isInterruptingAiTask}
                                onClick={() => void runtime.interruptTravelHostAi()}
                              >
                                停止任务
                              </Button>
                            ) : undefined
                          }
                          type={
                            aiTaskStatus === 'failed'
                              ? 'error'
                              : aiTaskStatus === 'completed'
                                ? 'success'
                                : 'info'
                          }
                        />
                      )}
                    </Flexbox>
                  }
                  listContent={
                    hasQueryError ? (
                      <Alert
                        title="群聊暂时无法读取"
                        type="error"
                        action={
                          <Button
                            onClick={() =>
                              void Promise.all([
                                topicsQuery.refetch(),
                                messagesQuery.refetch(),
                                publishedMessagesQuery.refetch(),
                              ])
                            }
                          >
                            重试
                          </Button>
                        }
                      />
                    ) : topicsQuery.isLoading ||
                      (runtime.historyTopicId && !messageDeepLink && messagesQuery.hasNextPage) ||
                      ((messagesQuery.isLoading || publishedMessagesQuery.isLoading) &&
                        activeTopicId) ? (
                      <SkeletonBar height={120} />
                    ) : undefined
                  }
                  listProps={{
                    initialPosition: runtime.historyTopicId ? 'start' : 'restore',
                    loadContextResources: false,
                    messageDeepLink,
                    headerSlot:
                      runtime.historyTopicId && messagesQuery.hasNextPage ? (
                        <Button
                          disabled={messagesQuery.isFetchingNextPage}
                          loading={messagesQuery.isFetchingNextPage}
                          onClick={() => void messagesQuery.fetchNextPage()}
                        >
                          加载该话题更早消息
                        </Button>
                      ) : undefined,
                    welcome: (
                      <GroupWelcome
                        avatar={<Avatar avatar={group.avatar || '🤖'} size={78} />}
                        description={<Text type="secondary">与群内成员一起讨论和协作。</Text>}
                        title={group.title}
                      />
                    ),
                  }}
                  runtimeProps={{
                    disableQueue: true,
                    disableSend: !!hasQueryError || runtime.isSending || busy,
                    showControlBar: false,
                    mentionItems,
                    sendButtonProps: {
                      generating: busy && runtime.canInterruptAiTask,
                      onStop: () => void runtime.interruptTravelHostAi(),
                    },
                  }}
                />
              </ConversationFrame>
            </Flexbox>
          </MobileSidebar>
        </ConversationProvider>
      </GroupAgentMetaContext>
    </RuntimeModelContext>
  );
};

export default MemberConversation;
