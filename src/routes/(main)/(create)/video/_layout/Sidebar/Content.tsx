'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Video } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import Body from '@/routes/(main)/(create)/features/GenerationLayout/Body';
import Header from '@/routes/(main)/(create)/features/GenerationLayout/Header';
import type { GenerationLayoutCommonProps } from '@/routes/(main)/(create)/features/GenerationLayout/types';
import { useVideoStore } from '@/store/video';
import { generationTopicSelectors } from '@/store/video/slices/generationTopic/selectors';

const useVideoSidebarProps = (): GenerationLayoutCommonProps => {
  const { t } = useTranslation('common');
  return {
    breadcrumb: [
      {
        href: '/video',
        title: (
          <Flexbox
            horizontal
            align="center"
            gap={6}
            style={{ color: 'inherit', fontSize: 14, whiteSpace: 'nowrap' }}
          >
            <Icon icon={Video} />
            <span>{t('tab.video')}</span>
          </Flexbox>
        ),
      },
    ],
    generationTopicsSelector: generationTopicSelectors.generationTopics,
    namespace: 'video',
    navKey: 'video',
    useStore: useVideoStore,
    viewModeStatusKey: 'videoTopicViewMode',
  };
};

const VideoSidebarContent = memo(() => {
  const props = useVideoSidebarProps();
  return <SideBarLayout body={<Body {...props} />} header={<Header {...props} />} />;
});

VideoSidebarContent.displayName = 'VideoSidebarContent';

export default VideoSidebarContent;
