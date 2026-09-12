import { getServerDB } from '@/database/core/db-adaptor';
import { TopicModel } from '@/database/models/topic';

/** Only resolves topics inside the authorized caller's account/workspace scope. */
export async function topicNotificationUrl(topicId: string, userId: string, workspaceId: string) {
  const topic = await new TopicModel(await getServerDB(), userId, workspaceId).findById(topicId);
  if (topic?.groupId)
    return '/group/' + encodeURIComponent(topic.groupId) + '#topic:' + encodeURIComponent(topicId);
  if (topic?.agentId)
    return '/agent/' + encodeURIComponent(topic.agentId) + '?topic=' + encodeURIComponent(topicId);
  return undefined;
}
