import SkeletonText from '@/components/Skeleton/Text';
import SkeletonBar from '@/components/Skeleton/Bar';
import { Flexbox } from '@lobehub/ui';

import { memo } from 'react';

const DetailLoading = memo(() => {
  return (
    <>
      <SkeletonBar height={28} radius={999} width={64} />
      <SkeletonText fontSize={20} lineHeight={1.4} />
      <Flexbox horizontal gap={8}>
        <SkeletonBar height={22} radius={4} width={48} />
        <SkeletonBar height={22} radius={4} width={48} />
      </Flexbox>
      <Flexbox horizontal align="center" gap={16} justify="space-between">
        <SkeletonBar height={22} radius={4} width={48} />
        <SkeletonBar height={22} radius={4} width={48} />
      </Flexbox>
      <SkeletonText fontSize={16} rows={6} />
    </>
  );
});

export default DetailLoading;
