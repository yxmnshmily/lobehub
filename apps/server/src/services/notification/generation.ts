import { notifyUser } from './index';

export async function notifyGenerationFailed(params: {
  kind: 'image' | 'video';
  asyncTaskId: string;
  topicId?: string | null;
  userId: string;
  workspaceId?: string;
}) {
  await notifyUser({
    userId: params.userId,
    workspaceId: params.workspaceId,
    type: `${params.kind}_generation_failed`,
    eventId: params.asyncTaskId,
    content:
      params.kind === 'image'
        ? '图片生成未完成，请查看生成记录后重试。'
        : '视频生成未完成，请查看生成记录后重试。',
    actionUrl:
      `/${params.kind}` + (params.topicId ? '?topic=' + encodeURIComponent(params.topicId) : ''),
  });
}
