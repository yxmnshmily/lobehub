'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { memo } from 'react';

import SkeletonBar from '@/components/Skeleton/Bar';
import AuthCard from '@/features/AuthCard';

const InteractionDetailsSkeleton = memo(() => (
  <Flexbox gap={16} width={'min(100%,400px)'}>
    <Flexbox horizontal align={'center'} justify={'center'} width={'100%'}>
      <Skeleton.Avatar shape={'square'} size={72} />
    </Flexbox>
    <AuthCard
      title={<SkeletonBar height={40} />}
      footer={
        <Flexbox gap={12} width={'100%'}>
          <SkeletonBar height={36} />
          <SkeletonBar height={36} />
        </Flexbox>
      }
      subtitle={
        <Flexbox gap={8} width={'100%'}>
          <SkeletonBar height={22} />
          <SkeletonBar height={22} width={'72%'} />
        </Flexbox>
      }
    >
      <Flexbox gap={12} width={'100%'}>
        <SkeletonBar height={22} width={'54%'} />
        <Flexbox gap={8} width={'100%'}>
          <Block padding={16} variant={'filled'}>
            <SkeletonBar height={36} />
          </Block>
          <Block padding={16} variant={'filled'}>
            <SkeletonBar width={'68%'} />
          </Block>
        </Flexbox>
      </Flexbox>
    </AuthCard>
  </Flexbox>
));

InteractionDetailsSkeleton.displayName = 'OAuthInteractionDetailsSkeleton';

export default InteractionDetailsSkeleton;
