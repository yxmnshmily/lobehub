import { notifyUser } from '@/server/services/notification';

interface NotifyVideoCompletedParams {
  generationBatchId: string;
  model: string;
  prompt: string;
  topicId?: string;
  userId: string;
  /** Present when the generation ran in a workspace — the notification then follows that context. */
  workspaceId?: string;
}

export async function notifyVideoCompleted(params: NotifyVideoCompletedParams): Promise<void> {
  await notifyUser({
    userId: params.userId,
    workspaceId: params.workspaceId,
    type: 'video_generation_completed',
    eventId: params.generationBatchId,
    content: '您生成的视频已完成，可以查看结果。',
    actionUrl: '/video' + (params.topicId ? '?topic=' + encodeURIComponent(params.topicId) : ''),
  });
}
