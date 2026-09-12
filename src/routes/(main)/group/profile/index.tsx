'use client';

import { resolveAgentGroupManagementPolicy } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { Fragment, memo, Suspense, useEffect } from 'react';
import { useParams } from 'react-router';

import ProfileSkeleton from '@/components/Skeleton/Profile';
import PlatformAdminRouteGuard from '@/features/PlatformAdminRouteGuard';
import ResourceConfigAccessGate from '@/features/ResourcePermission/ResourceConfigAccessGate';
import ReadOnlyMemberProfile from '@/features/SuperGroup/MemberProfile';
import { ProfileSurface } from '@/features/SuperGroup/ProfileSurface';
import { parseAsString, useQueryState } from '@/hooks/useQueryParam';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { lambdaQuery } from '@/libs/trpc/client';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useGroupProfileStore } from '@/store/groupProfile';

import AgentBuilder from './features/AgentBuilder';
import GroupProfileSettings from './features/GroupProfile';
import Header from './features/Header';
import MemberProfile from './features/MemberProfile';
import { resolveMemberProfileRedirect } from './resolveActiveTab';
import StoreSync from './StoreSync';

const ProfileArea = memo(() => {
  const editor = useGroupProfileStore((s) => s.editor);
  const activeTabId = useGroupProfileStore((s) => s.activeTabId);
  const isGroupsLoading = useAgentGroupStore(agentGroupSelectors.isGroupsInit);

  const isGroupTab = activeTabId === 'group';

  return (
    <Flexbox flex={1} height={'100%'} style={{ minWidth: 0, overflow: 'hidden' }}>
      {isGroupsLoading ? (
        <ProfileSkeleton variant={'group'} />
      ) : (
        <ProfileSurface header={<Header />} onFocus={() => editor?.focus()}>
          {isGroupTab ? <GroupProfileSettings /> : <MemberProfile />}
        </ProfileSurface>
      )}
    </Flexbox>
  );
});

const GroupProfile: FC = () => {
  const platformAccess = lambdaQuery.platformAccess.isPlatformAdmin.useQuery(undefined, {
    retry: false,
  });
  const { gid } = useParams<{ gid: string }>();
  const group = useAgentGroupStore(agentGroupSelectors.getGroupById(gid ?? ''));
  const isGroupLoading = useAgentGroupStore(agentGroupSelectors.isGroupsInit);
  const members = useAgentGroupStore(agentGroupSelectors.getGroupAgents(gid ?? ''));
  const [activeTabId] = useQueryState('tab', parseAsString.withDefault('group'));
  const router = useQueryRoute();
  const memberProfilePath =
    !isGroupLoading &&
    group &&
    (resolveAgentGroupManagementPolicy(group.clientId) !== 'platform' ||
      platformAccess.data === true)
      ? resolveMemberProfileRedirect(
          activeTabId,
          members.map((member) => member.id),
        )
      : undefined;

  useEffect(() => {
    if (memberProfilePath) router.replace(memberProfilePath, { replace: true });
  }, [memberProfilePath, router]);

  if (isGroupLoading || !group || memberProfilePath) return <ProfileSkeleton variant={'group'} />;

  if (resolveAgentGroupManagementPolicy(group.clientId) === 'platform') {
    if (platformAccess.isLoading) return <ProfileSkeleton variant={'group'} />;
    if (platformAccess.data !== true)
      return (
        <ReadOnlyMemberProfile
          group={{ groupId: group.id, title: group.title ?? null, avatar: group.avatar ?? null }}
        />
      );
  }

  const ManagementGuard =
    resolveAgentGroupManagementPolicy(group.clientId) === 'platform'
      ? PlatformAdminRouteGuard
      : Fragment;

  return (
    <Suspense fallback={<ProfileSkeleton variant={'group'} />}>
      <ManagementGuard>
        <ResourceConfigAccessGate
          loading={<ProfileSkeleton variant={'group'} />}
          redirectPath={`/group/${gid ?? ''}`}
          resourceId={gid}
          resourceType="agentGroup"
        >
          <StoreSync />
          <Flexbox horizontal height={'100%'} width={'100%'}>
            <ProfileArea />
            <AgentBuilder />
          </Flexbox>
        </ResourceConfigAccessGate>
      </ManagementGuard>
    </Suspense>
  );
};

export default GroupProfile;
