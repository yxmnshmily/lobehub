import { notifyUser } from '@/server/services/notification';
import { topicNotificationUrl } from '@/server/services/notification/topicContext';

export type TopicCommentActivityKind = 'commented' | 'commentedOnMessage' | 'mentioned' | 'replied';

export interface TopicCommentActivityRecipient {
  kind: TopicCommentActivityKind;
  userId: string;
}

export interface NotifyTopicCommentActivityParams {
  actorUserId: string;
  commentId: string;
  recipients: TopicCommentActivityRecipient[];
  rootCommentId: string;
  topicId: string;
  workspaceId: string;
}

/** Optional integration hook for delivering comment activity to recipients. */
export async function notifyTopicCommentActivity(
  params: NotifyTopicCommentActivityParams,
): Promise<void> {
  const recipients = new Map<string, TopicCommentActivityKind>();
  for (const recipient of params.recipients) {
    if (recipient.userId !== params.actorUserId && recipients.get(recipient.userId) !== 'mentioned')
      recipients.set(recipient.userId, recipient.kind);
  }
  if (!recipients.size) return;
  const actionUrl = await topicNotificationUrl(
    params.topicId,
    params.actorUserId,
    params.workspaceId,
  );
  await Promise.all(
    [...recipients].map(([userId, kind]) =>
      notifyUser({
        userId,
        workspaceId: params.workspaceId,
        eventId: params.commentId,
        type: kind === 'mentioned' ? 'topic_mentioned' : 'topic_commented',
        content:
          kind === 'mentioned'
            ? '有人在话题评论中提及你，请查看详情。'
            : '你参与的话题有新评论或回复，请查看详情。',
        actionUrl,
      }),
    ),
  );
}
