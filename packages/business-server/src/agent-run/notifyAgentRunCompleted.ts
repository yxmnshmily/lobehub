import { notifyUser } from '@/server/services/notification';

export interface NotifyAgentRunCompletedParams {
  agentId?: string;
  duration?: number;
  groupId?: string;
  lastAssistantContent?: string;
  operationId: string;
  topicId?: string;
  userId: string;
  workspaceId?: string;
}

async function notifyAgentRunResult(
  params: NotifyAgentRunCompletedParams,
  failed: boolean,
): Promise<void> {
  await notifyUser({
    userId: params.userId,
    workspaceId: params.workspaceId,
    type: failed ? 'agent_run_failed' : 'agent_run_completed',
    eventId: params.operationId,
    content: failed
      ? '助理未能完成本次任务，请打开会话查看并重试。'
      : '助理已完成本次任务，请打开会话查看结果。',
    actionUrl: params.groupId
      ? '/group/' +
        encodeURIComponent(params.groupId) +
        (params.topicId ? '#topic:' + encodeURIComponent(params.topicId) : '')
      : params.agentId
        ? '/agent/' +
          encodeURIComponent(params.agentId) +
          (params.topicId ? '?topic=' + encodeURIComponent(params.topicId) : '')
        : '/',
  });
}

export const notifyAgentRunCompleted = (params: NotifyAgentRunCompletedParams) =>
  notifyAgentRunResult(params, false);
export const notifyAgentRunFailed = (params: NotifyAgentRunCompletedParams) =>
  notifyAgentRunResult(params, true);
