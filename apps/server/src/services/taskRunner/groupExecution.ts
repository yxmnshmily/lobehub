import { TRPCError } from '@trpc/server';

import { ChatGroupModel } from '@/database/models/chatGroup';
import type { LobeChatDatabase } from '@/database/type';

/** Resolve durable group ownership without falling back to a personal inbox. */
export const resolveGroupExecution = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | undefined,
  config: unknown,
  assigneeAgentId?: string | null,
) => {
  if (!config || typeof config !== 'object' || !('groupId' in config)) return undefined;
  const groupId = config.groupId;
  if (typeof groupId !== 'string' || !groupId.trim()) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid group ownership' });
  }
  const record = await new ChatGroupModel(db, userId, workspaceId).findGroupWithAgents(groupId);
  if (!record) throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' });
  const supervisorAgentId = record.agents.find((member) => member.role === 'supervisor')?.agentId;
  const agentId = assigneeAgentId ?? supervisorAgentId;
  if (!agentId || !record.agents.some((member) => member.agentId === agentId)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Task assignee must be a current group member',
    });
  }
  return { agentId, groupId, members: record.agents, supervisorAgentId };
};
