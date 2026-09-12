'use client';

import type { ReactNode } from 'react';

export interface GenerationLayoutCommonProps {
  breadcrumb: { href: string; title: string | ReactNode }[];
  generationTopicsSelector: (s: any) => any;
  namespace: 'image' | 'video';
  navKey: string;
  useStore: (selector: (s: any) => any) => any;
  viewModeStatusKey: 'imageTopicViewMode' | 'videoTopicViewMode';
}
