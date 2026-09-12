import { LOADING_FLAT } from '@lobechat/const';

const isBareAssistantPlaceholder = (message: any) => {
  if (message.role !== 'assistant' || message.content?.trim() !== LOADING_FLAT) return false;
  if (Array.isArray(message.tools) || Array.isArray(message.tool_calls)) return false;
  if (
    message.reasoning?.content ||
    message.reasoning?.signature ||
    message.reasoning?.responseItems?.length > 0
  )
    return false;

  return !(
    message.imageList?.length > 0 ||
    message.videoList?.length > 0 ||
    message.audioList?.length > 0 ||
    message.fileList?.length > 0
  );
};

/**
 * Remove persisted failed group turns from model context without deleting the
 * stored conversation. The placeholder and its parent prompt form one
 * unanswered pair; replaying only the prompt turns it into a new instruction.
 */
export const pruneUnansweredGroupTurns = (messages: any[]) => {
  const unansweredUserIds = new Set(
    messages
      .filter(isBareAssistantPlaceholder)
      .map((message) => message.parentId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );

  if (unansweredUserIds.size === 0) return messages;

  for (const message of messages) {
    if (
      message.role === 'assistant' &&
      !isBareAssistantPlaceholder(message) &&
      typeof message.parentId === 'string'
    ) {
      unansweredUserIds.delete(message.parentId);
    }
  }

  return messages.filter(
    (message) => !isBareAssistantPlaceholder(message) && !unansweredUserIds.has(message.id),
  );
};
