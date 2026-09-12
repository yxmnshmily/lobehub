'use client';

import { Flexbox } from '@lobehub/ui';

import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

import SkeletonBar from './Bar';

const MemorySkeleton = ({ chrome = 'page' }: RouteSkeletonProps) => (
  <Flexbox aria-busy flex={1} height={'100%'}>
    {chrome !== 'body' && <NavHeader />}
    <Flexbox height={'100%'} style={{ overflow: 'hidden' }} width={'100%'}>
      <WideScreenContainer gap={32} paddingBlock={24} paddingInline={24}>
        <Flexbox horizontal gap={8} wrap={'wrap'}>
          {[72, 96, 80].map((width) => (
            <SkeletonBar height={24} key={width} radius={12} width={width} />
          ))}
        </Flexbox>
        <Flexbox gap={12}>
          <SkeletonBar height={28} width={'48%'} />
          <SkeletonBar height={14} width={160} />
        </Flexbox>
        {[0, 1, 2].map((key) => (
          <Flexbox gap={12} key={key}>
            <SkeletonBar height={18} width={120} />
            <SkeletonBar height={14} width={'94%'} />
            <SkeletonBar height={14} width={'82%'} />
            <SkeletonBar height={14} width={'66%'} />
          </Flexbox>
        ))}
      </WideScreenContainer>
    </Flexbox>
  </Flexbox>
);

export default MemorySkeleton;
