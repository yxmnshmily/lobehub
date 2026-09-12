import SkeletonText from '@/components/Skeleton/Text';
import { Flexbox } from '@lobehub/ui';

const Loading = () => {
  return (
    <Flexbox padding={16}>
      <SkeletonText rows={8} />
    </Flexbox>
  );
};

export default Loading;
