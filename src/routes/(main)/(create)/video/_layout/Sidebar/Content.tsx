'use client';

import { memo } from 'react';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import GenerationMediaModeSegment from '@/routes/(main)/(create)/features/GenerationInput/GenerationMediaModeSegment';
import Body from '@/routes/(main)/(create)/features/GenerationLayout/Body';
import Header from '@/routes/(main)/(create)/features/GenerationLayout/Header';
import type { GenerationLayoutCommonProps } from '@/routes/(main)/(create)/features/GenerationLayout/types';
import { useVideoStore } from '@/store/video';
import { generationTopicSelectors } from '@/store/video/slices/generationTopic/selectors';

const getVideoSidebarProps = (): GenerationLayoutCommonProps => {
  return {
    breadcrumb: [
      {
        title: <GenerationMediaModeSegment layout="sidebar" mode="video" />,
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
  const props = getVideoSidebarProps();
  return <SideBarLayout body={<Body {...props} />} header={<Header {...props} />} />;
});

VideoSidebarContent.displayName = 'VideoSidebarContent';

export default VideoSidebarContent;
