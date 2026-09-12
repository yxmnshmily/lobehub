'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';

import SkeletonBar from '../Bar';
import ConversationSkeletonContainer from './Container';

const ConversationListSkeleton = () => (
  <ConversationSkeletonContainer
    flex={1}
    gap={28}
    height={'100%'}
    paddingBlock={24}
    style={{ minHeight: 0, overflow: 'hidden' }}
  >
    <Flexbox align={'flex-end'} width={'100%'}>
      <Flexbox
        gap={8}
        padding={16}
        style={{ background: cssVar.colorFillQuaternary, borderRadius: 12 }}
        width={'min(440px, 76%)'}
      >
        <SkeletonBar height={14} width={'90%'} />
        <SkeletonBar height={14} width={'64%'} />
      </Flexbox>
    </Flexbox>
    {Array.from({ length: 2 }).map((_, index) => (
      <Flexbox gap={14} key={index} width={'100%'}>
        <Flexbox horizontal align={'center'} gap={10}>
          <SkeletonBar height={28} radius={8} width={28} />
          <SkeletonBar height={16} width={104} />
          <SkeletonBar height={20} width={48} />
        </Flexbox>
        <Flexbox gap={10}>
          <SkeletonBar height={14} width={'86%'} />
          <SkeletonBar height={14} width={'72%'} />
          <SkeletonBar height={14} width={index ? '48%' : '62%'} />
        </Flexbox>
        <Flexbox horizontal gap={8}>
          <SkeletonBar height={20} width={20} />
          <SkeletonBar height={20} width={20} />
          <SkeletonBar height={12} width={112} />
        </Flexbox>
      </Flexbox>
    ))}
  </ConversationSkeletonContainer>
);

export default ConversationListSkeleton;
