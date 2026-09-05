/**
 * @vitest-environment happy-dom
 */
import { type ConversationContext, type UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useGroupConversationMessages } from './useGroupConversationMessages';

const createContext = (overrides: Partial<ConversationContext> = {}): ConversationContext => ({
  agentId: 'shared-supervisor',
  groupId: 'group-one',
  isSupervisor: true,
  scope: 'group',
  threadId: null,
  topicId: 'shared-topic',
  ...overrides,
});

const createMessage = (id: string, role: UIChatMessage['role']): UIChatMessage =>
  ({ content: id, id, role }) as UIChatMessage;

describe('useGroupConversationMessages', () => {
  const originalMessagesMap = useChatStore.getState().dbMessagesMap;

  beforeEach(() => {
    const groupContext = createContext();
    const otherGroupContext = createContext({ groupId: 'group-two' });
    const memberContext = createContext({ scope: 'group_agent' });

    act(() => {
      useChatStore.setState({
        dbMessagesMap: {
          [messageMapKey(groupContext)]: [createMessage('message-one', 'user')],
          [messageMapKey(otherGroupContext)]: [createMessage('message-two', 'user')],
          [messageMapKey(memberContext)]: [createMessage('message-member', 'assistant')],
        },
      });
    });
  });

  afterEach(() => {
    act(() => {
      useChatStore.setState({ dbMessagesMap: originalMessagesMap });
    });
  });

  it('selects the new private group bucket when the supervisor and topic stay unchanged', () => {
    const { result, rerender } = renderHook(
      ({ context }) => useGroupConversationMessages(context),
      { initialProps: { context: createContext() } },
    );

    expect(result.current?.[0]?.id).toBe('message-one');

    rerender({ context: createContext({ groupId: 'group-two' }) });

    expect(result.current?.[0]?.id).toBe('message-two');
  });

  it('selects the member stream when only the conversation scope changes', () => {
    const { result, rerender } = renderHook(
      ({ context }) => useGroupConversationMessages(context),
      { initialProps: { context: createContext() } },
    );

    rerender({ context: createContext({ scope: 'group_agent' }) });

    expect(result.current?.[0]?.id).toBe('message-member');
  });
});
