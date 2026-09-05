'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ImperativeModal from '@/components/ImperativeModal';
import { OverlayContainerContext } from '@/features/NavPanel/OverlayContainer';
import { useWorkspaceModal } from '@/hooks/useWorkspaceModal';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import Actions from './Sidebar/Topic/Actions';
import Filter from './Sidebar/Topic/Filter';
import TopicList from './Sidebar/Topic/List';

const MobileTopics = memo(() => {
  const { t } = useTranslation('topic');
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
        footer={null}
        open={open}
        styles={{ body: { padding: 0 } }}
        title={
          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} width={'100%'}>
            <span>{`${t('title')} ${topicCount > 0 ? topicCount : ''}`.trim()}</span>
            <Flexbox horizontal align={'center'} gap={4}>
              <Filter mobile />
              <Actions mobile />
            </Flexbox>
          </Flexbox>
        }
        onCancel={() => setOpen(false)}
      >
        <div ref={setOverlayContainer} style={{ height: '100%', overflow: 'hidden' }}>
          <Flexbox
            height={'100%'}
            padding={'8px 8px 0'}
            style={{ overflowX: 'hidden', overflowY: 'auto' }}
          >
            <TopicList />
          </Flexbox>
        </div>
      </ImperativeModal>
    </OverlayContainerContext>
  );
});

MobileTopics.displayName = 'MobileTopics';

export default MobileTopics;
