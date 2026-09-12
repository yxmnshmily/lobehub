'use client';

import { Flexbox } from '@lobehub/ui';
import SkeletonBar from '@/components/Skeleton/Bar';
import { memo } from 'react';

interface SkeletonProps {
  count?: number;
}

const Skeleton = memo<SkeletonProps>(({ count = 3 }) => {
  return (
    <Flexbox gap={8}>
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonBar height={68} key={index} />
      ))}
    </Flexbox>
  );
});

export default Skeleton;
