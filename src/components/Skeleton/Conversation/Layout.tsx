'use client';

import { Flexbox } from '@lobehub/ui';

import NavHeader from '@/features/NavHeader';

import SkeletonBar from '../Bar';
import ConversationSegmentSkeleton from './Segment';

const ConversationLayoutSkeleton = () => (
  <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
    <NavHeader
      left={<SkeletonBar height={24} width={144} />}
      right={<SkeletonBar height={28} width={72} />}
    />
    <ConversationSegmentSkeleton />
  </Flexbox>
);

export default ConversationLayoutSkeleton;
