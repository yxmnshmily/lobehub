'use client';

import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@lobechat/types';
import { AccordionItem, ContextMenuTrigger, Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { MessageSquare } from 'lucide-react';
import React, { memo, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import RecentTopicLinks from '@/features/SuperGroup/RecentTopicLinks';
import { useFetchActiveTopicDetail } from '@/hooks/useFetchActiveTopicDetail';
import { useFetchChatTopics } from '@/hooks/useFetchChatTopics';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import Actions from './Actions';
import Filter from './Filter';
import List from './List';
import { useTopicActionsDropdownMenu } from './useDropdownMenu';

interface TopicProps {
  defaultExpanded?: boolean;
  itemKey: string;
  onOpen?: () => void;
}

const Topic = memo<TopicProps>(({ itemKey, onOpen, defaultExpanded = false }) => {
  const { t } = useTranslation(['topic', 'common']);
  const [topicCount] = useChatStore((s) => [topicSelectors.currentTopicCount(s)]);
  const dropdownMenu = useTopicActionsDropdownMenu();
  const { isRevalidating } = useFetchChatTopics();
  useFetchActiveTopicDetail();
  const managedGroupId = useAgentGroupStore((s) =>
    s.activeGroupId &&
    s.groupMap[s.activeGroupId]?.clientId === DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID
      ? s.activeGroupId
      : undefined,
  );
  if (managedGroupId)
    return (
      <RecentTopicLinks
        defaultExpanded={defaultExpanded}
        groupId={managedGroupId}
        onOpen={onOpen}
      />
    );
  return (
    <AccordionItem
      classNames={{ header: 'group-nav-section-header', indicator: 'group-nav-section-indicator' }}
      expand={onOpen ? false : undefined}
      itemKey={itemKey}
      paddingBlock={4}
      paddingInline={4}
      styles={{ header: { minHeight: 36 } }}
      action={
        !onOpen && (
          <Flexbox horizontal align="center" data-nav-expanded-only="" gap={2}>
            <Filter />
            <Actions />
          </Flexbox>
        )
      }
      headerWrapper={(header) => (
        <ContextMenuTrigger items={dropdownMenu}>{header}</ContextMenuTrigger>
      )}
      title={
        <Flexbox horizontal align="center" data-nav-section-title="" gap={8} title={t('title')}>
          <span
            className="group-nav-section-icon"
            style={{ display: 'inline-flex', justifyContent: 'center', width: 28, flexShrink: 0 }}
          >
            <MessageSquare aria-hidden size={18} />
          </span>
          <Text ellipsis data-nav-label="" fontSize={12} type={'secondary'} weight={500}>
            {`${t('title')} ${topicCount > 0 ? topicCount : ''}`}
          </Text>
          {isRevalidating && <NeuralNetworkLoading size={14} />}
        </Flexbox>
      }
      onExpandChange={onOpen}
    >
      <Suspense fallback={<SkeletonList />}>
        <Flexbox
          data-nav-scroll=""
          gap={1}
          paddingBlock={1}
          style={{
            overflowX: 'hidden',
            flexShrink: 0,
          }}
        >
          <List />
        </Flexbox>
      </Suspense>
    </AccordionItem>
  );
});

export default Topic;
