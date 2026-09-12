import { TRPCError } from '@trpc/server';

import { AgentModel } from '@/database/models/agent';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { authEnv } from '@/envs/auth';
import type { AiAgentService } from '@/server/services/aiAgent';
import {
  resolveHostedTravelGroupTarget,
  runHostedGroupChatWithBudget,
} from '@/server/services/platformUsageBilling/groupChat';
import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@/server/services/user/travelServiceGroup';

export async function executeMessengerGroup(input: {
  db: LobeChatDatabase;
  groupId: string;
  params: Parameters<AiAgentService['execAgent']>[0];
  requestKey: string;
  service: AiAgentService;
  userId: string;
  workspaceId?: string;
}) {
  const { db, userId, workspaceId, groupId, service, params } = input;
  const model = new ChatGroupModel(db, userId, workspaceId);
  const group = await model.findById(groupId);
  if (!group)
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: '工作群已不存在或无权访问，请重新选择工作群。',
    });
  const supervisorId = await model.getSupervisorAgentId(groupId);
  if (!supervisorId || supervisorId !== params.agentId)
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '工作群主管已变更，请重试。' });
  if (params.appContext?.topicId) {
    const topic = await new TopicModel(db, userId, workspaceId).findById(params.appContext.topicId);
    if (!topic || topic.groupId !== groupId || topic.agentId !== supervisorId)
      throw new TRPCError({ code: 'FORBIDDEN', message: '该对话不属于当前工作群。' });
  }
  const next = {
    ...params,
    appContext: { ...params.appContext, groupId, orchestrationRole: 'supervisor' as const },
  };
  if (group.clientId !== DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID) return service.execAgent(next);
  const target = await resolveHostedTravelGroupTarget({
    db,
    userId,
    groupId,
    agentId: supervisorId,
    workspaceId,
  });
  if (!target || !authEnv.AUTH_SECRET)
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '工作群执行配置暂不可用。' });
  const config = await new AgentModel(db, userId, workspaceId).getAgentConfigById(supervisorId);
  if (!config?.model || !config.provider)
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '请先配置工作群主管的模型。' });
  return runHostedGroupChatWithBudget({
    db,
    principal: target.principal,
    billing: { idempotencyKey: input.requestKey },
    fingerprint: {
      groupId,
      agentId: supervisorId,
      prompt: params.prompt,
      topicId: params.appContext?.topicId,
      files: params.files,
    },
    secret: authEnv.AUTH_SECRET,
    topicId: params.appContext?.topicId ?? undefined,
    start: (context) =>
      service.execPlatformManagedAgent(next, {
        ...context,
        actorUserId: userId,
        resourceOwnerUserId: userId,
      }),
  });
}
