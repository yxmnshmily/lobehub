import { notifyUser } from '@/server/services/notification';

export type TaskCommentActivityKind = 'commented' | 'mentioned';

export interface TaskCommentActivityRecipient {
  kind: TaskCommentActivityKind;
  userId: string;
}

export interface NotifyTaskCommentActivityParams {
  /** The member who wrote / edited the comment — never notified. */
  actorUserId: string;
  commentId: string;
  /** Deduplicated by userId; `mentioned` wins over `commented` for the same member. */
  recipients: TaskCommentActivityRecipient[];
  taskId: string;
  workspaceId: string;
}

export async function notifyTaskCommentActivity(
  params: NotifyTaskCommentActivityParams,
): Promise<void> {
  const recipients = new Map<string, TaskCommentActivityKind>();
  for (const recipient of params.recipients) {
    if (recipient.userId !== params.actorUserId && recipients.get(recipient.userId) !== 'mentioned')
      recipients.set(recipient.userId, recipient.kind);
  }
  await Promise.all(
    [...recipients].map(([userId, kind]) =>
      notifyUser({
        userId,
        workspaceId: params.workspaceId,
        eventId: params.commentId,
        type: kind === 'mentioned' ? 'task_mentioned' : 'task_commented',
        content:
          kind === 'mentioned'
            ? '有人在任务评论中提及你，请查看详情。'
            : '你参与的任务有新评论，请查看详情。',
        actionUrl: '/task/' + encodeURIComponent(params.taskId),
      }),
    ),
  );
}
