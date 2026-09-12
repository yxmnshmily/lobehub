import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';

interface PersonalInboxContext {
  agentId?: string;
  inboxAgentId?: string;
  isLogin: boolean;
  workspaceId?: string | null;
}

export const isPersonalInbox = ({
  agentId,
  inboxAgentId,
  isLogin,
  workspaceId,
}: PersonalInboxContext) =>
  Boolean(
    isLogin &&
    !workspaceId &&
    agentId &&
    (agentId === BUILTIN_AGENT_SLUGS.inbox || agentId === inboxAgentId),
  );

/** New conversations have one destination; old topic URLs keep their original data scope. */
export const resolvePersonalInboxRedirect = (context: {
  agentId?: string;
  personalInbox: boolean;
  pathname: string;
  search: string;
}) => {
  if (!context.personalInbox) return;
  if (new URLSearchParams(context.search).get('topic')) return;
  if (context.pathname.replace(/\/$/, '') !== `/agent/${context.agentId}`) return;
  return '/group/default';
};
