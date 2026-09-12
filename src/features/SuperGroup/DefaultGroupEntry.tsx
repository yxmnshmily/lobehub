'use client';

import { GROUP_CHAT_URL } from '@lobechat/const';
import { Navigate } from 'react-router';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import BrandTextLoading from '@/components/Loading/BrandTextLoading';
import TravelGroupReadiness from '@/features/HomeSidebar/Body/Agent/TravelGroupReadiness';
import { useMyTravelGroupReadiness } from '@/hooks/useMyTravelGroupReadiness';

/** Resolve the signed-in user's own group; never reuse another account's saved group id. */
export default function DefaultGroupEntry() {
  const activeWorkspaceId = useActiveWorkspaceId();
  const readiness = useMyTravelGroupReadiness();

  if (activeWorkspaceId) return <Navigate replace to="/group/default" />;

  if (readiness.status === 'review_required' || readiness.status === 'retryable_error') {
    return (
      <TravelGroupReadiness
        isRetrying={readiness.isRetrying}
        status={readiness.status === 'review_required' ? 'review_required' : 'retryable_error'}
        onRetry={() => {
          void readiness.retry();
        }}
      />
    );
  }

  if (!readiness.groupId) {
    return <BrandTextLoading debugId="default-work-group" />;
  }

  return <Navigate replace to={GROUP_CHAT_URL(readiness.groupId)} />;
}
