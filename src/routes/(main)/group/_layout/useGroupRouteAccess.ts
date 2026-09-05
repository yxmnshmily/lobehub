'use client';

import { useCallback, useState } from 'react';
import { useParams } from 'react-router';

import { useInitGroupConfig } from '@/hooks/useInitGroupConfig';
import { lambdaQuery } from '@/libs/trpc/client';
import { useAgentGroupStore } from '@/store/agentGroup';

export interface MemberGroupSummary {
  avatar: string | null;
  groupId: string;
  joinedAt: Date | null;
  kind: 'member';
  membershipVersion: number;
  title: string | null;
}

type GroupRouteAccess =
  | { kind: 'error'; error: unknown; retry: () => void }
  | { kind: 'loading' }
  | { group: MemberGroupSummary; kind: 'member'; markUnavailable: () => void }
  | { kind: 'owner' }
  | { kind: 'unavailable' };

export const useGroupRouteAccess = (): GroupRouteAccess => {
  const { gid } = useParams<{ gid?: string }>();
  const activeGroupId = useAgentGroupStore((state) => state.activeGroupId);
  const ownerDetail = useInitGroupConfig();
  const accessibleGroups = lambdaQuery.groupConversation.listGroups.useQuery(undefined, {
    refetchOnWindowFocus: true,
    retry: false,
  });
  const [forcedUnavailableGroupId, setForcedUnavailableGroupId] = useState<string>();

  const retry = useCallback(() => {
    setForcedUnavailableGroupId(undefined);
    void Promise.all([ownerDetail.mutate(), accessibleGroups.refetch()]);
  }, [accessibleGroups, ownerDetail]);
  const markUnavailable = useCallback(() => {
    if (gid) setForcedUnavailableGroupId(gid);
  }, [gid]);

  if (!gid || activeGroupId !== gid) return { kind: 'loading' };
  if (forcedUnavailableGroupId === gid) return { kind: 'unavailable' };
  if (ownerDetail.data?.id === gid) {
    if (ownerDetail.error) return { error: ownerDetail.error, kind: 'error', retry };
    return { kind: 'owner' };
  }
  if (accessibleGroups.isError) {
    return { error: accessibleGroups.error, kind: 'error', retry };
  }

  const accessibleGroup = accessibleGroups.data?.find((group) => group.groupId === gid);
  if (accessibleGroup?.kind === 'member') {
    return {
      group: {
        avatar: accessibleGroup.avatar,
        groupId: accessibleGroup.groupId,
        joinedAt: accessibleGroup.joinedAt,
        kind: 'member',
        membershipVersion: accessibleGroup.membershipVersion,
        title: accessibleGroup.title,
      },
      kind: 'member',
      markUnavailable,
    };
  }

  if (ownerDetail.error) {
    return { error: ownerDetail.error, kind: 'error', retry };
  }
  if (
    ownerDetail.isLoading ||
    ownerDetail.data === undefined ||
    accessibleGroups.isLoading ||
    accessibleGroups.data === undefined
  ) {
    return { kind: 'loading' };
  }

  return { kind: 'unavailable' };
};
