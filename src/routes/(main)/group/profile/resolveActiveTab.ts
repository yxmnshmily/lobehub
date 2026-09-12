import { type AgentGroupDetail, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@lobechat/types';

export const resolveActiveTab = (activeTabId: string, currentGroupAgentIds: string[]) => {
  if (activeTabId === 'group' || currentGroupAgentIds.includes(activeTabId)) return activeTabId;

  return 'group';
};

export const resolveMemberProfileRedirect = (
  activeTabId: string,
  currentGroupAgentIds: string[],
) =>
  resolveActiveTab(activeTabId, currentGroupAgentIds) !== 'group'
    ? `/agent/${encodeURIComponent(activeTabId)}/profile`
    : undefined;

export const resolveGroupProfileRedirect = (
  group: Pick<AgentGroupDetail, 'clientId' | 'workspaceId'> | undefined,
  groupId: string,
) =>
  group?.clientId === DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID && !group.workspaceId
    ? `/group/${groupId}`
    : undefined;
