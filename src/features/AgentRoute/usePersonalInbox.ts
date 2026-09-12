import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { isPersonalInbox } from './personalInbox';

export const usePersonalInbox = (agentId?: string) => {
  const workspaceId = useActiveWorkspaceId();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const isLogin = useUserStore(authSelectors.isLogin);
  return isPersonalInbox({ agentId, inboxAgentId, isLogin: Boolean(isLogin), workspaceId });
};
