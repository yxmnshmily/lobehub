import { notifyUser } from '@/server/services/notification';

export interface NotifyTaskAssignedParams {
  /** The member who performed the assignment — never notified. */
  actorUserId: string;
  /** The member the task was assigned to — the notification recipient. */
  assigneeUserId: string;
  eventId?: string;
  taskId: string;
  /** Workspace-level task identifier (e.g. 'TASK-1'), used as the name fallback. */
  taskIdentifier: string;
  taskName?: string | null;
  workspaceId?: string;
}

export async function notifyTaskAssigned(params: NotifyTaskAssignedParams): Promise<void> {
  if (params.actorUserId === params.assigneeUserId) return;
  await notifyUser({
    userId: params.assigneeUserId,
    workspaceId: params.workspaceId,
    type: 'task_assigned',
    eventId: params.eventId ?? `${params.taskId}:${params.actorUserId}`,
    content: '有一项任务分配给你，请查看任务要求。',
    actionUrl: '/task/' + encodeURIComponent(params.taskId),
  });
}
