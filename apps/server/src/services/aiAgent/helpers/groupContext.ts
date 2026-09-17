import type { AgentGroupConfig } from '@lobechat/context-engine';

/**
 * Reduce runtime failures to a non-sensitive persistence marker. Provider and
 * database errors can contain prompts, credentials, infrastructure details,
 * or user identifiers and must not be copied into thread metadata.
 */
export function formatErrorForMetadata(error: unknown): Record<string, any> | undefined {
  if (!error) return undefined;
  return { kind: 'runtime' };
}

/**
 * Build the multi-agent group context from a group's member roster, mirroring
 * the client `contextEngineering.ts` `agentGroup` build. Carries every member's
 * real `agt_*` ID so the supervisor dispatches members by ID instead of role
 * name (role names don't resolve → "Agent member(s) failed to start."). Resolves
 * the responding agent's own role/name so GroupContextInjector marks it with
 * `you="true"` and the orchestration filter activates for participants.
 */
export const buildGroupAgentContext = (
  currentAgentId: string,
  group:
    | {
        config?: { maxDiscussionRounds?: number } | null;
        content?: string | null;
        title?: string | null;
      }
    | undefined,
  roster: Array<{
    agentId: string;
    description?: string | null;
    role: string | null;
    title: string | null;
  }>,
): AgentGroupConfig | undefined => {
  if (roster.length === 0) return undefined;

  const agentMap: AgentGroupConfig['agentMap'] = {};
  const members: NonNullable<AgentGroupConfig['members']> = [];
  let currentAgentName: string | undefined;
  let currentAgentRole: 'supervisor' | 'participant' | undefined;

  for (const member of roster) {
    const role = member.role === 'supervisor' ? 'supervisor' : 'participant';
    const name = member.title?.trim() || 'Untitled Agent';
    agentMap[member.agentId] = { name, role };
    members.push({ id: member.agentId, name, role, description: member.description });

    if (member.agentId === currentAgentId) {
      currentAgentName = name;
      currentAgentRole = role;
    }
  }

  return {
    agentMap,
    currentAgentId,
    currentAgentName,
    currentAgentRole,
    groupTitle: group?.title || undefined,
    maxDiscussionRounds: group?.config?.maxDiscussionRounds,
    members,
    systemPrompt: group?.content || undefined,
  };
};

/**
 * Bot-conversation fallback: a single bot agent has no real group, so build a
 * degenerate one-member context purely to give it its `<group_context>`
 * identity block. Only used when there is no `groupId`.
 */
export const buildBotConversationGroupContext = (
  currentAgentId: string,
  agentConfig: { description?: unknown; title?: unknown } | undefined,
): AgentGroupConfig => {
  const title = agentConfig?.title;
  const description = agentConfig?.description;
  const name = typeof title === 'string' && title.trim() ? title.trim() : 'Current Agent';

  return {
    agentMap: { [currentAgentId]: { name, role: 'participant' } },
    currentAgentId,
    currentAgentName: name,
    currentAgentRole: 'participant',
    members: [{ id: currentAgentId, name, role: 'participant' }],
    systemPrompt: typeof description === 'string' ? description : undefined,
  };
};
