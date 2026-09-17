'use client';

import { memo } from 'react';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import GenerationMediaModeSegment from '@/routes/(main)/(create)/features/GenerationInput/GenerationMediaModeSegment';
import Body from '@/routes/(main)/(create)/features/GenerationLayout/Body';
import Header from '@/routes/(main)/(create)/features/GenerationLayout/Header';
import type { GenerationLayoutCommonProps } from '@/routes/(main)/(create)/features/GenerationLayout/types';
import { useImageStore } from '@/store/image';
import { generationTopicSelectors } from '@/store/image/slices/generationTopic/selectors';

const getImageSidebarProps = (): GenerationLayoutCommonProps => {
  return {
    breadcrumb: [
      {
        title: <GenerationMediaModeSegment layout="sidebar" mode="image" />,
      },
    ],
    generationTopicsSelector: generationTopicSelectors.generationTopics,
    namespace: 'image',
    navKey: 'image',
    useStore: useImageStore,
    viewModeStatusKey: 'imageTopicViewMode',
  };
};

const ImageSidebarContent = memo(() => {
  const props = getImageSidebarProps();
  return <SideBarLayout body={<Body {...props} />} header={<Header {...props} />} />;
});

ImageSidebarContent.displayName = 'ImageSidebarContent';

export default ImageSidebarContent;
