'use client';

import { GROUP_CHAT_URL } from '@lobechat/const';
import { type ConversationContext } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Alert, Button } from '@lobehub/ui/base-ui';
import { UsersRound } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import BrandTextLoading from '@/components/Loading/BrandTextLoading';
import { withLobeHubMountPath } from '@/features/Auth/utils/mountedPath';
import { DesktopChatInput } from '@/features/ChatInput';
import { ConversationProvider, useConversationStore } from '@/features/Conversation';
import { messageStateSelectors } from '@/features/Conversation/store';
import Home from '@/features/Home';
import { HOME_INPUT_BODY_HEIGHT } from '@/features/Home/InputArea/constants';
import TravelGroupReadiness from '@/features/HomeSidebar/Body/Agent/TravelGroupReadiness';
import TravelPromptShortcuts from '@/features/TravelPromptShortcuts';
import { COPY_CATEGORY_QUERY_PARAM } from '@/features/TravelPromptShortcuts/prompts';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';
import { useMyTravelGroupReadiness } from '@/hooks/useMyTravelGroupReadiness';
import { useOperationState } from '@/hooks/useOperationState';
import { lambdaQuery } from '@/libs/trpc/client';
import MainChatInput from '@/routes/(main)/group/features/Conversation/MainChatInput';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';

/** The Home editor's appearance, inside the real group's send/permission provider. */
function GroupEditor() {
  const [searchParams] = useSearchParams();
  const error = useConversationStore(messageStateSelectors.sendMessageError);
  const context = useConversationStore((s) => s.context);
  const fetchMessages = useConversationStore((s) => s.useFetchMessages);
  fetchMessages(context);
  return (
    <Flexbox gap={8}>
      {error && <Alert title={error} type="error" />}
      <DesktopChatInput
        actionBarStyle={{ paddingBlockEnd: 8, paddingInline: 8 }}
        dropdownPlacement="bottomLeft"
        placeholder="向工作群提问、创建内容或安排任务"
        showControlBar={false}
        inputBanner={
          <TravelPromptShortcuts
            copyCategory={searchParams.get(COPY_CATEGORY_QUERY_PARAM) ?? undefined}
          />
        }
        inputContainerProps={{
          minHeight: HOME_INPUT_BODY_HEIGHT,
          resize: false,
          style: { borderRadius: 20 },
        }}
      />
    </Flexbox>
  );
}

function GroupComposer({
  groupId,
  agentId,
  topicId,
}: {
  groupId: string;
  agentId: string;
  topicId: string | null;
}) {
  const context: ConversationContext = {
    agentId,
    groupId,
    isSupervisor: true,
    scope: 'group',
    threadId: null,
    topicId,
  };
  const operationState = useOperationState(context);
  const config = useInitAgentConfig(agentId);
  const opened = useRef(false);
  const openGroup = () => {
    if (opened.current) return;
    opened.current = true;
    // No prompt in URLs/history; only navigate after the group has accepted it.
    window.parent.location.assign(withLobeHubMountPath(GROUP_CHAT_URL(groupId)));
  };
  useLayoutEffect(() => {
    useAgentGroupStore.setState({ activeGroupId: groupId });
    useChatStore.setState({
      activeGroupId: groupId,
      activeAgentId: agentId,
      activeTopicId: topicId ?? undefined,
      activeThreadId: undefined,
    });
    return () => {
      if (useAgentGroupStore.getState().activeGroupId === groupId)
        useAgentGroupStore.setState({ activeGroupId: undefined });
      if (useChatStore.getState().activeGroupId === groupId)
        useChatStore.setState({ activeGroupId: undefined, activeTopicId: undefined });
    };
  }, [agentId, groupId, topicId]);
  if (config.error) return <AsyncError error={config.error} onRetry={() => void config.mutate()} />;
  if (config.isLoading || !config.data) return <BrandTextLoading debugId="embed-group-config" />;
  return (
    <ConversationProvider
      context={context}
      hooks={{ onAfterMessageCreate: async () => openGroup() }}
      operationState={operationState}
    >
      <MainChatInput onBilledSendAccepted={openGroup}>
        <GroupEditor />
      </MainChatInput>
    </ConversationProvider>
  );
}

/** Keep the Home shell mounted while account-scoped group data becomes ready. */
export default function WorkGroupHome() {
  const readiness = useMyTravelGroupReadiness({ refreshAgentList: false });
  const groupId = readiness.groupId;
  const fetchGroup = useAgentGroupStore((s) => s.useFetchGroupDetail);
  const group = fetchGroup(Boolean(groupId), groupId ?? '');
  const topics = lambdaQuery.groupConversation.listTopics.useQuery(
    { groupId: groupId ?? '', limit: 1, recent: true },
    { enabled: Boolean(groupId), refetchOnWindowFocus: false },
  );
  const identity = groupId ? (
    <Button
      href={withLobeHubMountPath(GROUP_CHAT_URL(groupId))}
      icon={<UsersRound size={20} />}
      target="_top"
      type="text"
    >
      {group.data?.title || '我的工作群'}
    </Button>
  ) : (
    <span>我的工作群</span>
  );
  const error = group.error || topics.error;
  let composer: ReactNode;
  if (!groupId) {
    composer = readiness.isEnabled ? (
      <TravelGroupReadiness
        isRetrying={readiness.isRetrying}
        status={readiness.status ?? 'preparing'}
        onRetry={() => void readiness.retry()}
      />
    ) : (
      <Button href={withLobeHubMountPath('/group/default')} target="_top">
        进入工作群
      </Button>
    );
  } else if (error) {
    composer = (
      <AsyncError
        error={error}
        onRetry={() => {
          void group.mutate();
          void topics.refetch();
        }}
      />
    );
  } else if (group.data?.supervisorAgentId && topics.data) {
    composer = (
      <GroupComposer
        agentId={group.data.supervisorAgentId}
        groupId={groupId}
        key={groupId}
        topicId={topics.data.items[0]?.id ?? null}
      />
    );
  } else if (group.data === null) {
    composer = <Alert title="工作群不存在或暂时无法访问" type="error" />;
  } else {
    composer = <BrandTextLoading debugId="embed-work-group" />;
  }
  return <Home hideRecentActivity hideRecommendations composer={composer} identity={identity} />;
}
