'use client';

import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@lobechat/types';
import { memo, Suspense } from 'react';

import { AgentMigrationBadge } from '@/features/AgentTransferMigration';
import ConversationHeader from '@/features/SuperGroup/ConversationHeader';
import GroupHeaderActions from '@/features/SuperGroup/GroupHeaderActions';
import { GroupHistoryAction } from '@/features/SuperGroup/GroupHistoryNotice';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useServerConfigStore } from '@/store/serverConfig';

import { useGroupContext } from '../useGroupContext';
import ShareButton from './ShareButton';

const Header = memo(() => {
  const shareContext = useGroupContext();
  const router = useQueryRoute();
  const narrowViewport = useIsMobile();
  const isMobile = useServerConfigStore((state) => state.isMobile) || narrowViewport;
  // Same source as `useGroupContext` — the resolved group, not the route-synced
  // chat-store global, which is transiently empty on navigation.
  const groupId = useAgentGroupStore((s) => s.activeGroupId);
  const isPersonalSupergroup = useAgentGroupStore((state) => {
    const group = state.activeGroupId ? state.groupMap[state.activeGroupId] : undefined;
    return group?.clientId === DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID && !group.workspaceId;
  });
  const groupTitle = useAgentGroupStore((state) =>
    state.activeGroupId ? state.groupMap[state.activeGroupId]?.title : undefined,
  );

  if (isMobile) {
    return (
      <ConversationHeader
        mobile
        title={groupTitle || '群聊'}
        right={
          <GroupHeaderActions
            mobile
            groupId={groupId}
            manageDefaultGroup={isPersonalSupergroup}
            profileHref={groupId ? `/group/${groupId}/profile` : undefined}
            shareOptions={{ context: shareContext }}
            showMembers={isPersonalSupergroup}
            share={
              <Suspense>
                <ShareButton mobile />
              </Suspense>
            }
          >
            {groupId && <GroupHistoryAction groupId={groupId} />}
          </GroupHeaderActions>
        }
        onBack={() => router.push('/group/default', { replace: true })}
      />
    );
  }

  return (
    <ConversationHeader
      title={groupTitle || '群聊'}
      right={
        <GroupHeaderActions
          groupId={groupId}
          manageDefaultGroup={isPersonalSupergroup}
          profileHref={groupId ? `/group/${groupId}/profile` : undefined}
          shareOptions={{ context: shareContext }}
          showMembers={isPersonalSupergroup}
          share={
            <Suspense>
              <ShareButton />
            </Suspense>
          }
        >
          {groupId && <GroupHistoryAction groupId={groupId} />}
          {/* Progress chip for a heavy group transfer/copy still filling in its
              conversations; renders nothing once the backfill finishes. */}
          {groupId && <AgentMigrationBadge groupId={groupId} />}
        </GroupHeaderActions>
      }
    />
  );
});

export default Header;
