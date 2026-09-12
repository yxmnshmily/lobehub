import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Text } from '@lobehub/ui/base-ui';
import { ArrowLeft } from 'lucide-react';

import SkeletonBar from '@/components/Skeleton/Bar';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useFileStore } from '@/store/file';
import { oneLineEllipsis } from '@/styles';

const Title = () => {
  const [closeFilePreview, previewFileId] = useChatStore((s) => [
    s.closeFilePreview,
    chatPortalSelectors.previewFileId(s),
  ]);

  const useFetchFileItem = useFileStore((s) => s.useFetchKnowledgeItem);

  const { data, isLoading } = useFetchFileItem(previewFileId);

  return (
    <Flexbox horizontal align={'center'} gap={4}>
      <ActionIcon icon={ArrowLeft} size={'small'} onClick={() => closeFilePreview()} />

      {isLoading ? (
        <SkeletonBar height={28} />
      ) : (
        <Text className={oneLineEllipsis} style={{ fontSize: 16 }} type={'secondary'}>
          {data?.name}
        </Text>
      )}
    </Flexbox>
  );
};

export default Title;
