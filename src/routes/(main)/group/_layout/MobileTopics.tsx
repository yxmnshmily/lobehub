'use client';

import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ImperativeModal from '@/components/ImperativeModal';
import { OverlayContainerContext } from '@/features/NavPanel/OverlayContainer';
import RecentTopicLinks from '@/features/SuperGroup/RecentTopicLinks';
import { useWorkspaceModal } from '@/hooks/useWorkspaceModal';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import Actions from './Sidebar/Topic/Actions';
import Filter from './Sidebar/Topic/Filter';
import TopicList from './Sidebar/Topic/List';

const MobileTopics = memo(() => {
  const { t } = useTranslation('topic');
  const managedGroupId = useAgentGroupStore((s) =>
    s.activeGroupId &&
    s.groupMap[s.activeGroupId]?.clientId === DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID
      ? s.activeGroupId
      : undefined,
  );
  const topicCount = useChatStore((state) => topicSelectors.currentTopicCount(state));
  const [mobileShowTopic, toggleMobileTopic] = useGlobalStore((state) => [
    systemStatusSelectors.mobileShowTopic(state),
    state.toggleMobileTopic,
  ]);
  const [open, setOpen] = useWorkspaceModal(mobileShowTopic, toggleMobileTopic);
  const [overlayContainer, setOverlayContainer] = useState<HTMLDivElement | null>(null);

  return (
    <OverlayContainerContext value={overlayContainer}>
      <ImperativeModal
        centered
        footer={null}
        open={open}
        width="min(480px, calc(100vw - 32px))"
        styles={{
          body: { padding: 0, maxHeight: '75dvh', overflowY: 'auto', overflowX: 'hidden' },
        }}
        title={
          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} width={'100%'}>
            <span>{`${t('title')} ${topicCount > 0 ? topicCount : ''}`.trim()}</span>
            {!managedGroupId && (
              <Flexbox horizontal align={'center'} gap={4}>
                <Filter mobile />
                <Actions mobile />
              </Flexbox>
            )}
          </Flexbox>
        }
        onCancel={() => setOpen(false)}
      >
        <div ref={setOverlayContainer} style={{ minHeight: 0 }}>
          <Flexbox padding={'8px 8px 0'} style={{ minHeight: 0, overflowX: 'hidden' }}>
            {managedGroupId ? (
              <RecentTopicLinks
                defaultExpanded
                groupId={managedGroupId}
                scrollWithinSection={false}
              />
            ) : (
              <Flexbox style={{ overflowX: 'hidden' }}>
                <TopicList />
              </Flexbox>
            )}
          </Flexbox>
        </div>
      </ImperativeModal>
    </OverlayContainerContext>
  );
});

MobileTopics.displayName = 'MobileTopics';

export default MobileTopics;
