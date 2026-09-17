'use client';

import type { ComponentProps } from 'react';

import type SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';

export interface GenerationLayoutCommonProps {
  breadcrumb: NonNullable<ComponentProps<typeof SideBarHeaderLayout>['breadcrumb']>;
  generationTopicsSelector: (s: any) => any;
  namespace: 'image' | 'video';
  navKey: string;
  useStore: (selector: (s: any) => any) => any;
  viewModeStatusKey: 'imageTopicViewMode' | 'videoTopicViewMode';
}
