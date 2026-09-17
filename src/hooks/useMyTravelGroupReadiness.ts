import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useClientDataSWR } from '@/libs/swr';
import { homeService, type MyTravelGroupReadiness } from '@/services/home';
import { getHomeStoreState } from '@/store/home';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

type TaggedReadiness = { readiness: MyTravelGroupReadiness; userId: string };

export const useMyTravelGroupReadiness = ({
  manageLifecycle = true,
  refreshAgentList = manageLifecycle,
}: { manageLifecycle?: boolean; refreshAgentList?: boolean } = {}) => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const userId = useUserStore(userProfileSelectors.userId);
  const activeWorkspaceId = useActiveWorkspaceId();
  const enabled = Boolean(isLogin && userId && !activeWorkspaceId);
  const activeUserIdRef = useRef<string | undefined>(enabled ? userId : undefined);
  activeUserIdRef.current = enabled ? userId : undefined;

  const [localResult, setLocalResult] = useState<TaggedReadiness | undefined>();
  const [pendingUserId, setPendingUserId] = useState<string | undefined>();
  const attemptedUserIdRef = useRef<string | undefined>(undefined);
  const inFlightRef = useRef<
    { promise: Promise<MyTravelGroupReadiness | undefined>; userId: string } | undefined
  >(undefined);
  const refreshedReadyRef = useRef<string | undefined>(undefined);

  const { data, error, mutate } = useClientDataSWR<MyTravelGroupReadiness>(
    enabled ? ['home:my-travel-group-readiness', userId] : null,
    () => homeService.getMyTravelGroupReadiness(),
  );

  const retry = useCallback((): Promise<MyTravelGroupReadiness | undefined> => {
    if (!enabled || !userId) return Promise.resolve(undefined);
    if (inFlightRef.current?.userId === userId) return inFlightRef.current.promise;

    setPendingUserId(userId);
    setLocalResult(undefined);
    const promise = homeService
      .ensureMyTravelServiceReady()
      .then(async (readiness) => {
        await mutate(readiness, { revalidate: false });
        if (activeUserIdRef.current === userId) setLocalResult({ readiness, userId });
        return readiness;
      })
      .catch(() => {
        const readiness = { status: 'retryable_error' } as const;
        if (activeUserIdRef.current === userId) setLocalResult({ readiness, userId });
        return readiness;
      })
      .finally(() => {
        if (inFlightRef.current?.promise === promise) inFlightRef.current = undefined;
        if (activeUserIdRef.current === userId) setPendingUserId(undefined);
      });

    inFlightRef.current = { promise, userId };
    return promise;
  }, [enabled, mutate, userId]);

  const readiness = useMemo<MyTravelGroupReadiness | undefined>(() => {
    if (!enabled || !userId) return undefined;
    if (localResult?.userId === userId) return localResult.readiness;
    if (pendingUserId === userId) return { status: 'preparing' };
    if (error) return { status: 'retryable_error' };
    return data ?? { status: 'preparing' };
  }, [data, enabled, error, localResult, pendingUserId, userId]);

  useEffect(() => {
    if (enabled) return;
    attemptedUserIdRef.current = undefined;
    refreshedReadyRef.current = undefined;
    inFlightRef.current = undefined;
    setLocalResult(undefined);
    setPendingUserId(undefined);
  }, [enabled]);

  useEffect(() => {
    if (!manageLifecycle || data?.status !== 'preparing' || !enabled || !userId) return;
    if (attemptedUserIdRef.current === userId) return;
    attemptedUserIdRef.current = userId;
    void retry();
  }, [data?.status, enabled, manageLifecycle, retry, userId]);

  useEffect(() => {
    if (!refreshAgentList || readiness?.status !== 'ready' || !userId) return;
    const readyKey = `${userId}:${readiness.groupId}`;
    if (refreshedReadyRef.current === readyKey) return;
    refreshedReadyRef.current = readyKey;
    void getHomeStoreState().refreshAgentList();
  }, [readiness, refreshAgentList, userId]);

  return {
    groupId: readiness?.status === 'ready' ? readiness.groupId : undefined,
    isEnabled: enabled,
    isRetrying: pendingUserId === userId,
    retry,
    status: readiness?.status,
  };
};
