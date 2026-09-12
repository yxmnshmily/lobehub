import { ActionIcon } from '@lobehub/ui/base-ui';
import { BotMessageSquare } from 'lucide-react';

import { useQueryRoute } from '@/hooks/useQueryRoute';

export default function GroupProfileButton({
  groupId,
  profileHref,
}: {
  groupId: string;
  profileHref?: string;
}) {
  const router = useQueryRoute();
  return (
    <ActionIcon
      aria-label="群组档案"
      icon={BotMessageSquare}
      title="群组档案"
      tooltipProps={{ placement: 'bottom' }}
      onClick={() => router.push(profileHref || `/group/${groupId}/profile`)}
    />
  );
}
