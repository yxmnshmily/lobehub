import SkeletonText from '@/components/Skeleton/Text';
import SkeletonBar from '@/components/Skeleton/Bar';
'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { cssVar, useResponsive } from 'antd-style';
import { memo } from 'react';

import {
  ArticleSkeleton,
  CommunityListSkeleton,
  type CommunityListSkeletonProps,
} from '@/components/Skeleton';

const ListLoading = memo<CommunityListSkeletonProps>((props) => (
  <CommunityListSkeleton chrome={'body'} {...props} />
));

export const DetailsLoading = memo(() => {
  const { mobile } = useResponsive();
  return (
    <Flexbox gap={24}>
      <Flexbox gap={12}>
        {!mobile && <ArticleSkeleton rows={1} style={{ width: 200 }} title={false} />}
        <Flexbox horizontal align={'center'} gap={16} width={'100%'}>
          <Skeleton.Avatar size={mobile ? 48 : 64} />
          <SkeletonBar height={36} width={200} />
        </Flexbox>
        <SkeletonBar height={28} width={200} />
      </Flexbox>
      <Flexbox
        horizontal
        gap={12}
        height={54}
        style={{
          borderBottom: `0.5px solid ${cssVar.colorBorder}`,
        }}
      >
        <SkeletonBar height={36} />
        <SkeletonBar height={36} />
      </Flexbox>
      <Flexbox
        gap={48}
        horizontal={!mobile}
        style={mobile ? { flexDirection: 'column-reverse' } : undefined}
      >
        <Flexbox
          flex={1}
          gap={16}
          width={'100%'}
          style={{
            overflow: 'hidden',
          }}
        >
          <SkeletonText rows={3} />
          <SkeletonText rows={8} />
          <SkeletonText rows={8} />
        </Flexbox>
        <Flexbox gap={16} width={360}>
          <SkeletonText rows={3} />
          <SkeletonText rows={4} />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});
export default ListLoading;
