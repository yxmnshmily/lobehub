import SkeletonText from '@/components/Skeleton/Text';
import { Flexbox } from '@lobehub/ui';

import { memo } from 'react';

const SkeletonLoading = memo(() => (
  <Flexbox padding={12}>
    <SkeletonText width={'70%'} />
    <SkeletonText width={'40%'} />
    <SkeletonText width={'80%'} />
    <SkeletonText width={'30%'} />
    <SkeletonText width={'50%'} />
    <SkeletonText width={'70%'} />
  </Flexbox>
));

export default SkeletonLoading;
