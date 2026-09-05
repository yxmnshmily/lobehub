'use client';

import { type ConversationContext } from '@lobechat/types';

import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

/**
 * Select the message bucket that belongs to the complete group context.
 *
 * The group id and scope are both part of the bucket identity. Deriving the
 * key on every render prevents a group switch from reusing messages selected
 * for another private group when their supervisor and topic ids are shared.
 */
export const useGroupConversationMessages = (context: ConversationContext) => {
  const chatKey = messageMapKey(context);

  return useChatStore((state) => state.dbMessagesMap[chatKey]);
};
