import { mutate } from '@/libs/swr';
import { isMessageListKey, type MessageListQueryContext } from '@/libs/swr/keys';
import { invalidateMessageListClientState } from '@/services/message/cache';

/**
 * Evict persisted `message:list` cache entries whose conversation context
 * matches `predicate`.
 *
 * The IndexedDB cache tier never expires (see `localStorageProvider`), so once a
 * topic / agent is deleted its message cache would orphan in IndexedDB forever
 * unless we drop it explicitly. Clears the cached value without revalidating —
 * the conversation is gone, there is nothing left to refetch.
 *
 * Matches every `message:list` variant (any page-size / version / workspace-
 * augmented key) sharing the same `ConversationContext`, mirroring the matcher
 * used by `refreshMessages` / the write-through cache.
 *
 * @example
 * // a single deleted topic
 * void evictMessageCache((ctx) => ctx.topicId === topicId);
 * // every topic under a deleted agent
 * void evictMessageCache((ctx) => ctx.agentId === agentId);
 * // wipe everything (delete-all)
 * void evictMessageCache(() => true);
 */
export const evictMessageCache = (
  predicate: (ctx: MessageListQueryContext) => boolean,
): Promise<unknown> => {
  // Advance the generation before awaiting anything, so older requests cannot
  // restore the deleted messages after eviction.
  invalidateMessageListClientState(predicate);
  return import('@/store/chat').then(async ({ useChatStore }) => {
    useChatStore.setState((state) => {
      const removedKeys = new Set(
        Object.entries(state.dbMessagesMap)
          .filter(([, messages]) => messages.some((message) => predicate(message)))
          .map(([key]) => key),
      );
      return {
        dbMessagesMap: Object.fromEntries(
          Object.entries(state.dbMessagesMap).filter(([key]) => !removedKeys.has(key)),
        ),
        messagesMap: Object.fromEntries(
          Object.entries(state.messagesMap).filter(([key]) => !removedKeys.has(key)),
        ),
      };
    });
    return mutate((key) => isMessageListKey(key, predicate), undefined, { revalidate: false });
  });
};
