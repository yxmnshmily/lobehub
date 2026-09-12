import SkeletonText from '@/components/Skeleton/Text';
import SkeletonBar from '@/components/Skeleton/Bar';
import { Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

const DetailsLoading = memo(() => {
  return (
    <Flexbox gap={24}>
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={16} width={'100%'}>
          <Skeleton.Avatar shape={'square'} size={64} />
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
    </Flexbox>
  );
});

export default DetailsLoading;
