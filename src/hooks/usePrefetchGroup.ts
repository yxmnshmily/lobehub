import { useSWRConfig } from 'swr';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useSingleton } from '@/hooks/useSingleton';
import { augmentKey } from '@/libs/swr/augmentKey';
import { groupKeys } from '@/libs/swr/keys';
import { lambdaQuery } from '@/libs/trpc/client';
import { chatGroupService } from '@/services/chatGroup';

/** Warm only the intended group's data; never activate agents or navigate on hover. */
export const usePrefetchGroup = () => {
  const { mutate } = useSWRConfig();
  const utils = lambdaQuery.useUtils();
  const warmed = useSingleton(() => new Map<string, number>());

  return async (groupId: string, kind: 'owner' | 'member') => {
    const workspaceId = getActiveWorkspaceId();
    const intentKey = JSON.stringify([workspaceId, groupId, kind]);
    const now = Date.now();
    if (!groupId || now - (warmed.get(intentKey) ?? 0) < 10_000) return;
    if (warmed.size >= 20) warmed.clear();
    warmed.set(intentKey, now);
    try {
      if (kind === 'owner') {
        await mutate(
          augmentKey(groupKeys.detail(groupId), workspaceId) as readonly unknown[],
          chatGroupService.getGroupDetail(groupId),
          { revalidate: false },
        );
      } else {
        // Short-lived speculative cache; mounted consumers still revalidate access normally.
        const options = { gcTime: 30_000, retry: false as const, staleTime: 10_000 };
        await Promise.all([
          utils.groupConversation.listTopics.prefetch(
            { groupId, limit: 20, recent: true },
            options,
          ),
          utils.groupMembership.listParticipants.prefetch(
            { groupId, limit: 50, offset: 0 },
            options,
          ),
        ]);
      }
    } catch {
      // Navigation owns the visible error/retry state, not speculative loading.
      warmed.delete(intentKey);
    }
  };
};
