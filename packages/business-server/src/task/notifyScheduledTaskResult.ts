import { notifyUser } from '@/server/services/notification';

export interface NotifyScheduledTaskCompletedParams {
  /** Agent executing the task — lets inbox surfaces render its avatar. */
  agentId?: string;
  /** Final assistant reply text of the tick — may be used to build a preview. */
  lastAssistantContent?: string;
  operationId: string;
  taskId: string;
  /** Workspace-level task identifier (e.g. 'T-1'), used as the name fallback. */
  taskIdentifier: string;
  taskName?: string;
  topicId?: string;
  userId: string;
  workspaceId?: string;
}

export interface NotifyScheduledTaskFailedParams {
  /** Agent executing the task — lets inbox surfaces render its avatar. */
  agentId?: string;
  /** Consecutive automation-tick failures including this one (schedule fuse). */
  consecutiveFailures?: number;
  /** Structured terminal error type (e.g. `InsufficientBudgetForModel`). Never
   *  the raw error text — that stays in briefs/logs. */
  errorCode?: string;
  operationId: string;
  /** True when this failure blew the fuse and auto-paused the task. */
  paused?: boolean;
  runTrigger: 'heartbeat' | 'schedule';
  taskId: string;
  taskIdentifier: string;
  taskName?: string;
  topicId?: string;
  userId: string;
  workspaceId?: string;
}

export async function notifyScheduledTaskCompleted(
  params: NotifyScheduledTaskCompletedParams,
): Promise<void> {
  await notifyUser({
    userId: params.userId,
    workspaceId: params.workspaceId,
    type: 'agent_cron_job_completed',
    eventId: params.operationId,
    content: `计划任务「${params.taskName || params.taskIdentifier}」已完成。`,
    actionUrl: '/task/' + encodeURIComponent(params.taskId),
  });
}

export async function notifyScheduledTaskFailed(
  params: NotifyScheduledTaskFailedParams,
): Promise<void> {
  await notifyUser({
    userId: params.userId,
    workspaceId: params.workspaceId,
    type: 'agent_cron_job_failed',
    eventId: params.operationId,
    content: `计划任务「${params.taskName || params.taskIdentifier}」执行失败。${params.paused ? '连续失败后已自动暂停，请查看任务详情。' : '请查看任务详情。'}`,
    actionUrl: '/task/' + encodeURIComponent(params.taskId),
  });
}
