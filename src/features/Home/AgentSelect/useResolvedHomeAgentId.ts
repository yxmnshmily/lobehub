import { useEffect } from 'react';

import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import { type AgentRow, useHomeAgentRows } from './useHomeAgentRows';

interface ResolvedHomeAgent {
  agentId: string | undefined;
  agentRow?: AgentRow;
  isInbox: boolean;
}

/**
 * Resolve the persisted home-page Agent selection, resetting stale ids left by
 * another account to the current default. Personal mode uses the actual group
 * supervisor; workspace mode retains its Inbox.
 */
export const useResolvedHomeAgentId = (): ResolvedHomeAgent => {
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const selectedAgentId = useGlobalStore(systemStatusSelectors.homeSelectedAgentId);
  const isAgentListInit = useHomeStore(homeAgentListSelectors.isAgentListInit);
  const selectedAgent = useHomeStore(homeAgentListSelectors.getAgentById(selectedAgentId ?? ''));
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const { defaultAgentId, isPersonalTravelGroup, privateRows, workspaceRows } = useHomeAgentRows();

  const isStale =
    !!selectedAgentId &&
    !!defaultAgentId &&
    isAgentListInit &&
    selectedAgentId !== defaultAgentId &&
    !selectedAgent;
  const isLegacyDefault = isPersonalTravelGroup && selectedAgentId === inboxAgentId;

  useEffect(() => {
    if ((!isStale && !isLegacyDefault) || !defaultAgentId) return;

    updateSystemStatus({ homeSelectedAgentId: defaultAgentId });
  }, [defaultAgentId, isLegacyDefault, isStale, updateSystemStatus]);

  const agentId = isStale || isLegacyDefault ? defaultAgentId : (selectedAgentId ?? defaultAgentId);

  return {
    agentId,
    agentRow: [...privateRows, ...workspaceRows].find((row) => row.id === agentId),
    isInbox: !!agentId && agentId === inboxAgentId,
  };
};
