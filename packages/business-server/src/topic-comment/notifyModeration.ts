import { notifyUser } from '@/server/services/notification';
import { topicNotificationUrl } from '@/server/services/notification/topicContext';

export interface NotifyTopicCommentModerationParams {
  authorUserId: string;
  commentId: string;
  event: 'removed' | 'restored';
  eventId: string;
  rootCommentId: string;
  topicId: string;
  workspaceId: string;
}

/** Optional integration hook for comment moderation activity. */
export async function notifyTopicCommentModeration(
  params: NotifyTopicCommentModerationParams,
): Promise<void> {
  await notifyUser({
    userId: params.authorUserId,
    workspaceId: params.workspaceId,
    eventId: params.eventId,
    type: `comment_${params.event}`,
    content:
      params.event === 'removed' ? '你的一条评论已被管理员移除。' : '你的一条评论已被管理员恢复。',
    actionUrl: await topicNotificationUrl(params.topicId, params.authorUserId, params.workspaceId),
  });
}
