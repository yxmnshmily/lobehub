import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useClientPollingSWR } from '@/libs/swr';
import { inboxKeys } from '@/libs/swr/keys';
import { notificationService } from '@/services/notification';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

export const INBOX_UNREAD_COUNT_DEDUPING_INTERVAL = 30_000;
export const INBOX_UNREAD_COUNT_REFRESH_INTERVAL = 60_000;

export const useInboxUnreadCount = () => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const workspaceId = useActiveWorkspaceId();
  const enabled = isLogin === true;

  const { data: unreadCount = 0 } = useClientPollingSWR<number>(
    enabled ? inboxKeys.unreadCount(workspaceId) : null,
    () => notificationService.getUnreadCount(),
    {
      dedupingInterval: INBOX_UNREAD_COUNT_DEDUPING_INTERVAL,
      refreshInterval: INBOX_UNREAD_COUNT_REFRESH_INTERVAL,
    },
  );

  return { enabled, unreadCount };
};
