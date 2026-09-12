'use client';

import { GROUP_CHAT_URL } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { Alert, Button, Text } from '@lobehub/ui/base-ui';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding';
import { isDesktop } from '@/const/version';
import TravelGroupReadiness from '@/features/HomeSidebar/Body/Agent/TravelGroupReadiness';
import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useMyTravelGroupReadiness } from '@/hooks/useMyTravelGroupReadiness';
import { lambdaQuery } from '@/libs/trpc/client';

import PendingGroupInvitationNotice from './PendingGroupInvitationNotice';
import RecentTopicLinks from './RecentTopicLinks';

/** Personal sessions expose groups, not private conversations with managed assistants. */
export default function WorkGroupSessions() {
  const { t } = useTranslation('chat');
  const readiness = useMyTravelGroupReadiness();
  const query = lambdaQuery.groupConversation.listGroups.useQuery(undefined, {
    enabled: readiness.isEnabled,
    gcTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const { refetch } = query;
  useEffect(() => {
    if (readiness.groupId) void refetch();
  }, [readiness.groupId, refetch]);
  const ownGroup = query.data?.find((group) => group.kind === 'owner' && group.isDefaultGroup);
  const others = query.data?.filter((group) => group.groupId !== ownGroup?.groupId) ?? [];
  const groupLink = (group: NonNullable<typeof query.data>[number]) => (
    <WorkspaceLink
      key={group.groupId}
      style={{ color: 'inherit', minWidth: 0, textDecoration: 'none' }}
      to={GROUP_CHAT_URL(group.groupId)}
    >
      <NavItem
        icon={<ProductLogo size={24} style={{ flexShrink: 0 }} type="flat" />}
        title={
          group.kind === 'member'
            ? t('superGroup.joinedGroup', { name: group.ownerDisplayName || t('superGroup.user') })
            : group.isDefaultGroup
              ? t('superGroup.ownGroup')
              : group.title || t('superGroup.ownGroup')
        }
      />
    </WorkspaceLink>
  );

  if (!readiness.isEnabled) return null;
  return (
    <Flexbox gap={12} paddingInline={4} style={{ minWidth: 0 }}>
      <PendingGroupInvitationNotice enabled={readiness.isEnabled} />
      <TravelGroupReadiness
        isRetrying={readiness.isRetrying}
        status={readiness.status}
        onRetry={readiness.retry}
      />
      {query.isLoading && <SkeletonList rows={3} />}
      {query.isError && (
        <Alert
          title={t('superGroup.groupsError')}
          type="error"
          action={
            <Button onClick={() => void query.refetch()}>{t('groupMembership.retry')}</Button>
          }
        />
      )}
      {ownGroup && (
        <Flexbox gap={12}>
          {groupLink(ownGroup)}
          <Flexbox gap={4}>
            <Text fontSize={12} type="secondary">
              {t('superGroup.recentTopics')}
            </Text>
            <RecentTopicLinks collapsible={isDesktop} groupId={ownGroup.groupId} />
          </Flexbox>
        </Flexbox>
      )}
      {others.length > 0 && (
        <Flexbox gap={4}>
          <Text fontSize={12} type="secondary">
            {t('superGroup.otherGroups')}
          </Text>
          {others.map(groupLink)}
        </Flexbox>
      )}
    </Flexbox>
  );
}
