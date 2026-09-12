'use client';

import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@lobechat/types';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { History } from 'lucide-react';
import { memo, Suspense } from 'react';

import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { AgentMigrationBadge } from '@/features/AgentTransferMigration';
import ConversationHeader from '@/features/SuperGroup/ConversationHeader';
import GroupHeaderActions from '@/features/SuperGroup/GroupHeaderActions';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useGlobalStore } from '@/store/global';
import { useServerConfigStore } from '@/store/serverConfig';

import { useGroupContext } from '../useGroupContext';
import ShareButton from './ShareButton';

const Header = memo(() => {
  const shareContext = useGroupContext();
  const router = useQueryRoute();
  const narrowViewport = useIsMobile();
  const isMobile = useServerConfigStore((state) => state.isMobile) || narrowViewport;
  const toggleMobileTopic = useGlobalStore((state) => state.toggleMobileTopic);
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
            <ActionIcon
              aria-label="历史会话"
              icon={History}
              size={MOBILE_HEADER_ICON_SIZE}
              title="历史会话"
              tooltipProps={{ placement: 'bottom' }}
              onClick={() => toggleMobileTopic(true)}
            />
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
          {/* Progress chip for a heavy group transfer/copy still filling in its
              conversations; renders nothing once the backfill finishes. */}
          {groupId && <AgentMigrationBadge groupId={groupId} />}
        </GroupHeaderActions>
      }
    />
  );
});

export default Header;
