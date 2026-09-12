'use client';

import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@lobechat/types';

import GroupSidebarHeader from '@/features/SuperGroup/GroupSidebarHeader';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useAgentGroupStore } from '@/store/agentGroup';

const HeaderInfo = () => {
  const { gid } = useActiveRouteParams<{ gid: string }>();
  const switchToNewTopic = useAgentGroupStore((s) => s.switchToNewTopic);
  const managed = useAgentGroupStore(
    (s) => s.groupMap[gid ?? '']?.clientId === DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
  );
  return <GroupSidebarHeader groupId={gid ?? ''} managed={managed} onHome={switchToNewTopic} />;
};

export default HeaderInfo;
