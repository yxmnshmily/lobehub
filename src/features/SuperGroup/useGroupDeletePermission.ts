import { use, useCallback, useEffect, useRef } from 'react';

import { GroupProjectScopeContext } from '@/features/Projects/Layout/GroupProjectScope';
import { lambdaQuery } from '@/libs/trpc/client';

import { GroupWorkScopeContext } from './GroupWorkScope';

/** UI gate only; the server independently authorizes every deletion. */
export function useGroupDeletePermission(nonGroupAllowed: boolean, explicitGroupId?: string) {
  const workScope = use(GroupWorkScopeContext);
  const projectScope = use(GroupProjectScopeContext);
  const groupId = explicitGroupId ?? workScope?.groupId ?? projectScope?.groupId;
  const groups = lambdaQuery.groupConversation.listGroups.useQuery(undefined, {
    enabled: !!groupId,
    retry: false,
  });
  const canDelete = groupId
    ? nonGroupAllowed &&
      !groups.isError &&
      !!groups.data?.some((group) => group.groupId === groupId && group.kind === 'owner')
    : nonGroupAllowed;
  const current = useRef({ canDelete, groupId, mounted: true });
  current.current = { canDelete, groupId, mounted: current.current.mounted };
  useEffect(() => {
    current.current.mounted = true;
    return () => {
      current.current.mounted = false;
    };
  }, []);
  // A confirmation opened in an earlier group may remain mounted after navigation.
  const checkDeletePermission = useCallback(
    () =>
      current.current.mounted && current.current.canDelete && current.current.groupId === groupId,
    [groupId],
  );
  return { canDelete, checkDeletePermission };
}
