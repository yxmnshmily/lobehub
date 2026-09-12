import { GROUP_CHAT_URL } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';

import { useQueryRoute } from '@/hooks/useQueryRoute';

import { useGroupWorkRequest } from './useGroupWorkRequest';

export default function GroupPageBreadcrumb({
  groupId,
  title,
  detailTitle,
}: {
  groupId: string;
  title: string;
  detailTitle?: string;
}) {
  const router = useQueryRoute();
  return (
    <Flexbox horizontal align="center" gap={8}>
      <Button
        type="text"
        onClick={() => {
          if (useGroupWorkRequest.getState().request?.groupId === groupId)
            useGroupWorkRequest.setState({ request: null });
          router.push(GROUP_CHAT_URL(groupId));
        }}
      >
        群主页
      </Button>
      <Text type="secondary">›</Text>
      {detailTitle ? (
        <>
          <Button
            type="text"
            onClick={() =>
              router.push(`${GROUP_CHAT_URL(groupId)}/${title === '目标' ? 'goals' : 'tasks'}`)
            }
          >
            {title}
          </Button>
          <Text type="secondary">›</Text>
          <Text ellipsis style={{ maxWidth: 260 }} weight={500}>
            {detailTitle}
          </Text>
        </>
      ) : (
        <Text weight={500}>{title}</Text>
      )}
    </Flexbox>
  );
}
