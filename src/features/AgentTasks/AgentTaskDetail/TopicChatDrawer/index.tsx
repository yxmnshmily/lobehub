'use client';

import { AGENT_CHAT_TOPIC_URL, GROUP_CHAT_TOPIC_URL } from '@lobechat/const';
import type { ConversationContext } from '@lobechat/types';
import type { DropdownItem } from '@lobehub/ui';
import { copyToClipboard, DropdownMenu, Flexbox, Freeze } from '@lobehub/ui';
import { ActionIcon, confirmModal, FloatingPanel, Tag, Text, toast } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import {
  Copy,
  ExternalLink,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Share2,
  Trash,
} from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NotFound from '@/components/404';
import AsyncError from '@/components/AsyncError';
import ChatList from '@/features/Conversation/ChatList';
import { ConversationProvider } from '@/features/Conversation/ConversationProvider';
import { TaskCardScopeProvider } from '@/features/Conversation/Markdown/plugins/Task';
import MessageItem from '@/features/Conversation/Messages';
import { useShareModal } from '@/features/ShareModal';
import { LazySharePopover as SharePopover } from '@/features/SharePopover/lazy';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useGatewayReconnect } from '@/hooks/useGatewayReconnect';
import { useOperationState } from '@/hooks/useOperationState';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useTaskStore } from '@/store/task';
import { taskActivitySelectors, taskDetailSelectors } from '@/store/task/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import type { ChatTopic } from '@/types/topic';
import { isForbiddenError } from '@/utils/forbiddenError';

import AssigneeAvatar from '../../features/AssigneeAvatar';
import FeedbackInput from './FeedbackInput';

const SHARE_ICON_SIZE = { blockSize: 32, size: 16 } as const;
const DEFAULT_PANEL_HEIGHT = 'min(640px, calc(100dvh - 16px))';
const DEFAULT_PANEL_WIDTH = 640;
const EXPANDED_PANEL_HEIGHT = 'calc(100dvh - 16px)';
const EXPANDED_PANEL_WIDTH = 'min(960px, calc(100vw - 16px))';
// StoreUpdater ignores undefined values; explicitly replace a previous writer.
const ignoreMessageChanges = () => {};

export interface TopicChatDrawerBodyProps {
  agentId: string;
  defaultInputExpanded?: boolean;
  disableInputCollapse?: boolean;
  topicId: string;
}

const ResolvedTopicChatDrawerBody = memo<
  TopicChatDrawerBodyProps & {
    groupId?: string;
    topicRunningOperation?: NonNullable<ChatTopic['metadata']>['runningOperation'];
  }
>(
  ({
    agentId,
    defaultInputExpanded,
    disableInputCollapse,
    groupId,
    topicId,
    topicRunningOperation,
  }) => {
    const isLogin = useUserStore(authSelectors.isLogin);
    const useHydrateAgentConfig = useAgentStore((s) => s.useHydrateAgentConfig);

    useHydrateAgentConfig(isLogin, agentId);

    const context = useMemo<ConversationContext>(
      () => ({
        agentId,
        groupId,
        isolatedTopic: true,
        scope: groupId ? 'group' : 'main',
        topicId,
      }),
      [agentId, groupId, topicId],
    );

    const taskRunningOperation = useTaskStore((s) => {
      const activity = taskActivitySelectors.activeDrawerTopicActivity(s);
      return activity?.id === topicId ? activity.runningOperation : undefined;
    });
    const runningOperation = topicRunningOperation ?? taskRunningOperation;
    const existingRun = useChatStore((s) =>
      groupId
        ? Object.values(s.operations).find(
            (operation) =>
              !!operation.metadata.serverOperationId &&
              (runningOperation
                ? operation.metadata.serverOperationId === runningOperation.operationId
                : operation.status === 'running' || operation.status === 'pending') &&
              operation.context.groupId === groupId &&
              operation.context.topicId === topicId &&
              messageMapKey({
                ...context,
                ...operation.context,
                isolatedTopic: operation.context.isolatedTopic,
              }) !== messageMapKey(context),
          )
        : undefined,
    );
    const displayContext = useMemo<ConversationContext>(
      () =>
        existingRun
          ? {
              ...context,
              ...existingRun.context,
              agentId: existingRun.context.agentId ?? agentId,
              isolatedTopic: existingRun.context.isolatedTopic,
            }
          : context,
      [agentId, context, existingRun],
    );
    const chatKey = messageMapKey(displayContext);
    const storedMessages = useChatStore((s) => s.dbMessagesMap[chatKey]);
    // Keep the existing connection and its controls. This is a filtered view,
    // never a writer of a partial transcript back into the live group's bucket.
    const messages = useMemo(
      () =>
        existingRun
          ? storedMessages?.filter((message) => message.topicId === topicId)
          : storedMessages,
      [existingRun, storedMessages, topicId],
    );
    const replaceMessages = useChatStore((s) => s.replaceMessages);
    const operationState = useOperationState(displayContext);
    // Pass this drawer's agent explicitly — the run drawer also mounts on the
    // home surface, where the chat store's `activeAgentId` is unset.
    useGatewayReconnect(topicId, runningOperation, agentId, undefined, displayContext);

    const itemContent = useCallback(
      (index: number, id: string) => <MessageItem disableEditing id={id} index={index} key={id} />,
      [],
    );

    return (
      <ConversationProvider
        context={displayContext}
        hasInitMessages={!!messages}
        messages={messages}
        operationState={operationState}
        skipFetch={!!existingRun}
        onMessagesChange={
          existingRun
            ? ignoreMessageChanges
            : (msgs, ctx, meta) => {
                replaceMessages(msgs, { context: ctx, source: meta?.source });
              }
        }
      >
        <TaskCardScopeProvider value={true}>
          <Flexbox height={'100%'} style={{ overflow: 'hidden' }}>
            <Flexbox flex={1} style={{ minHeight: 0, overflow: 'hidden' }}>
              <ChatList disableActionsBar itemContent={itemContent} />
            </Flexbox>
            <Flexbox paddingBlock={'0 12px'} paddingInline={12} style={{ flexShrink: 0 }}>
              <FeedbackInput
                defaultExpanded={defaultInputExpanded}
                disableCollapse={disableInputCollapse}
              />
            </Flexbox>
          </Flexbox>
        </TaskCardScopeProvider>
      </ConversationProvider>
    );
  },
);

ResolvedTopicChatDrawerBody.displayName = 'ResolvedTopicChatDrawerBody';

export const TopicChatDrawerBody = memo<TopicChatDrawerBodyProps>((props) => {
  const { t } = useTranslation('common');
  const useFetchTopicDetail = useChatStore((s) => s.useFetchTopicDetail);
  const { data: topic, error, mutate } = useFetchTopicDetail(props.topicId);
  if (error) return <AsyncError error={error} onRetry={() => void mutate()} />;
  if (topic === null) return <NotFound />;
  if (!topic || topic.id !== props.topicId)
    return (
      <Flexbox padding={16} role="status">
        {t('loading')}
      </Flexbox>
    );
  return (
    <ResolvedTopicChatDrawerBody
      {...props}
      groupId={topic.groupId ?? undefined}
      topicRunningOperation={topic.metadata?.runningOperation}
    />
  );
});

TopicChatDrawerBody.displayName = 'TopicChatDrawerBody';

const TopicChatDrawer = memo(() => {
  const { t } = useTranslation(['chat', 'common']);
  const navigate = useWorkspaceAwareNavigate();
  const [expanded, setExpanded] = useState(false);
  const topicId = useTaskStore(taskDetailSelectors.activeTopicDrawerTopicId);
  const useFetchTopicDetail = useChatStore((s) => s.useFetchTopicDetail);
  const { data: topic, error: topicError } = useFetchTopicDetail(topicId);
  const topicReady = !!topic && topic.id === topicId && !topicError;
  const groupId = topicReady ? (topic.groupId ?? undefined) : undefined;
  const activeTaskId = useTaskStore((s) => s.activeTaskId);
  const agentId = useTaskStore(taskDetailSelectors.topicDrawerAgentId);
  const drawerTitle = useTaskStore(taskDetailSelectors.topicDrawerTitle);
  const activity = useTaskStore(taskActivitySelectors.activeDrawerTopicActivity);
  const closeTopicDrawer = useTaskStore((s) => s.closeTopicDrawer);
  const deleteTopic = useTaskStore((s) => s.deleteTopic);
  const useFetchTaskDetail = useTaskStore((s) => s.useFetchTaskDetail);
  const enableTopicLinkShare = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const { allowed: canShare, reason } = usePermission('edit_own_content');
  const { allowed: canEditTask } = usePermission('create_content');

  // Hydrate task detail when the drawer is opened outside of TaskDetailPage
  // (e.g. from a brief on home) so the header has agentId / status / seq.
  useFetchTaskDetail(topicId ? activeTaskId : undefined);

  const open = !!topicId && !!agentId;

  const shareContext = useMemo<Partial<ConversationContext>>(
    () => ({
      agentId: agentId ?? undefined,
      groupId,
      isolatedTopic: true,
      threadId: null,
      topicId: topicId ?? undefined,
    }),
    [agentId, groupId, topicId],
  );
  const { openShareModal } = useShareModal({ context: shareContext });

  const handleCopyTopicId = useCallback(() => {
    if (topicId) void copyToClipboard(topicId);
  }, [topicId]);

  const handleCopyOperationId = useCallback(() => {
    if (activity?.operationId) void copyToClipboard(activity.operationId);
  }, [activity?.operationId]);

  const handleOpenTopic = useCallback(() => {
    if (!agentId || !topicId || !topicReady) return;
    closeTopicDrawer();
    navigate(
      groupId ? GROUP_CHAT_TOPIC_URL(groupId, topicId) : AGENT_CHAT_TOPIC_URL(agentId, topicId),
    );
  }, [agentId, closeTopicDrawer, groupId, navigate, topicId, topicReady]);

  // The drawer stays open until `deleteTopic` actually succeeds: closing
  // first would drop the user back onto whatever was behind the panel with
  // no feedback if the mutation then fails (permission, network, or a topic
  // that's already gone). Only a confirmed delete tears the panel down.
  const handleDelete = useCallback(() => {
    if (!topicId) return;
    const targetTopicId = topicId;
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('taskDetail.topicMenu.deleteConfirm.content', {
        defaultValue:
          'This run and its messages will be permanently deleted. This action cannot be undone.',
      }),
      okButtonProps: { danger: true },
      okText: t('taskDetail.topicMenu.delete', { defaultValue: 'Delete Run' }),
      onOk: async () => {
        try {
          await deleteTopic(targetTopicId);
          closeTopicDrawer();
        } catch (error) {
          toast.error(
            isForbiddenError(error)
              ? t('manageOnlyCreator', { ns: 'common' })
              : t('operationFailed', { ns: 'common' }),
          );
        }
      },
      title: t('taskDetail.topicMenu.deleteConfirm.title', { defaultValue: 'Delete Run?' }),
    });
  }, [closeTopicDrawer, deleteTopic, t, topicId]);

  const menuItems = useMemo<DropdownItem[]>(
    () => [
      {
        disabled: !agentId || !topicId || !topicReady,
        icon: ExternalLink,
        key: 'openAgentTopic',
        label: t(
          groupId ? 'taskDetail.topicMenu.openGroupTopic' : 'taskDetail.topicMenu.openAgentTopic',
        ),
        onClick: handleOpenTopic,
      },
      { type: 'divider' },
      {
        disabled: !topicId,
        icon: Copy,
        key: 'copyTopicId',
        label: t('taskDetail.topicMenu.copyId', { defaultValue: 'Copy Topic ID' }),
        onClick: handleCopyTopicId,
      },
      {
        disabled: !activity?.operationId,
        icon: Copy,
        key: 'copyOperationId',
        label: t('taskDetail.topicMenu.copyOperationId', { defaultValue: 'Copy Operation ID' }),
        onClick: handleCopyOperationId,
      },
      { type: 'divider' },
      {
        danger: true,
        // Mirrors the run row's menu: a running topic already has an explicit
        // Stop affordance, so delete here stays scoped to finished runs, and
        // is also gated on edit permission like the server's `task.deleteTopic`.
        // `activity` can be briefly (or, for a topic without a parent task,
        // permanently) unresolved while the task detail hydrates — an unknown
        // status is treated as ineligible (same as running) rather than
        // defaulting to enabled.
        disabled: !topicId || !canEditTask || !activity?.status || activity.status === 'running',
        icon: Trash,
        key: 'delete',
        label: t('taskDetail.topicMenu.delete', { defaultValue: 'Delete Run' }),
        onClick: handleDelete,
      },
    ],
    [
      activity?.operationId,
      activity?.status,
      agentId,
      canEditTask,
      handleCopyOperationId,
      handleCopyTopicId,
      handleDelete,
      groupId,
      handleOpenTopic,
      t,
      topicId,
      topicReady,
    ],
  );

  const title = (
    <Flexbox
      horizontal
      align={'center'}
      flex={1}
      gap={8}
      style={{ maxWidth: '100%', minWidth: 0, overflow: 'hidden' }}
    >
      <AssigneeAvatar agentId={agentId} size={20} />
      {activity?.sourceTaskIdentifier && (
        <Tag
          size={'small'}
          style={{ flex: 'none' }}
          title={t('taskDetail.topicSource', {
            identifier: activity.sourceTaskIdentifier,
          })}
        >
          {activity.sourceTaskIdentifier}
        </Tag>
      )}
      <Text ellipsis style={{ flex: '0 1 auto', minWidth: 0 }} weight={500}>
        {activity?.title || drawerTitle || t('taskDetail.topicDrawer.untitled')}
      </Text>
      {activity?.seq != null && (
        <Text fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
          #{activity.seq}
        </Text>
      )}
      <DropdownMenu items={menuItems}>
        <ActionIcon icon={MoreHorizontal} size={'small'} />
      </DropdownMenu>
    </Flexbox>
  );

  const shareIcon = (
    <ActionIcon
      disabled={!canShare || !topicReady}
      icon={Share2}
      size={SHARE_ICON_SIZE}
      title={canShare ? t('share', { ns: 'common' }) : reason}
      onClick={enableTopicLinkShare || !canShare || !topicReady ? undefined : openShareModal}
    />
  );

  const actions = !topicId ? null : (
    <Flexbox horizontal align={'center'} gap={4}>
      <ActionIcon
        icon={expanded ? Minimize2 : Maximize2}
        size={SHARE_ICON_SIZE}
        title={t(expanded ? 'taskDetail.topicDrawer.collapse' : 'taskDetail.topicDrawer.expand')}
        onClick={() => setExpanded((value) => !value)}
      />
      {enableTopicLinkShare && canShare && topicReady ? (
        <SharePopover agentId={agentId ?? undefined} topicId={topicId} onOpenModal={openShareModal}>
          {shareIcon}
        </SharePopover>
      ) : (
        shareIcon
      )}
    </Flexbox>
  );

  // Freeze title/actions/body during the close animation so the panel keeps
  // its last rendered state instead of flashing to the empty/"untitled" view
  // while topicId/agentId clear.
  return (
    <FloatingPanel
      actions={<Freeze frozen={!open}>{actions}</Freeze>}
      getContainer={false}
      height={expanded ? EXPANDED_PANEL_HEIGHT : DEFAULT_PANEL_HEIGHT}
      mask={false}
      minHeight={320}
      minWidth={360}
      open={open}
      placement={'bottomRight'}
      title={<Freeze frozen={!open}>{title}</Freeze>}
      width={expanded ? EXPANDED_PANEL_WIDTH : DEFAULT_PANEL_WIDTH}
      styles={{
        body: { padding: 0 },
        panel: {
          background: cssVar.colorBgContainer,
          maxHeight: 'calc(100dvh - 16px)',
        },
        title: {
          boxSizing: 'border-box',
          maxWidth: '100%',
          minWidth: 0,
          overflow: 'hidden',
        },
      }}
      onClose={closeTopicDrawer}
    >
      {/* `open` already proves both ids. The body deliberately does NOT wait for a
          task: a run opened from the home inbox may have no parent task at all,
          and gating on one renders a titled but empty panel. */}
      <Freeze frozen={!open}>
        {open && <TopicChatDrawerBody agentId={agentId!} topicId={topicId!} />}
      </Freeze>
    </FloatingPanel>
  );
});

TopicChatDrawer.displayName = 'TopicChatDrawer';

export default TopicChatDrawer;
