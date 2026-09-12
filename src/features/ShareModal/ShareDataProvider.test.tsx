import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import ShareDataProvider, { useShareData } from './ShareDataProvider';

const mocks = vi.hoisted(() => ({
  allowOwnerReads: false,
  fetch: vi.fn(() => ({ isLoading: false })),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (select: (state: unknown) => unknown) => {
    if (!mocks.allowOwnerReads) throw new Error('Must not read the owner conversation');
    return select({
      activeAgentId: 'other-agent',
      activeGroupId: 'other-group',
      activeThreadId: 'other-thread',
      activeTopicId: 'other-topic',
      useFetchMessages: mocks.fetch,
    });
  },
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: () => {
    if (!mocks.allowOwnerReads) throw new Error('Must not read private agent settings');
    return undefined;
  },
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: { getAgentSystemRoleById: () => () => undefined },
}));
vi.mock('@/store/chat/selectors', () => ({
  dbMessageSelectors: { getDbMessagesByKey: () => () => [] },
  displayMessageSelectors: { getDisplayMessagesByKey: () => () => [] },
  topicSelectors: { getTopicById: () => () => ({ title: 'Run' }) },
}));

function ReadShare() {
  const data = useShareData();
  return (
    <div>
      {data.title} {data.displayMessages.map((message) => message.content).join(' ')}{' '}
      {data.systemRole}
    </div>
  );
}

it('shares only the authorized snapshot without fetching owner data or private prompts', () => {
  mocks.allowOwnerReads = false;
  render(
    <ShareDataProvider
      snapshot={{
        context: { agentId: '', groupId: 'joined', scope: 'group', topicId: 't' },
        title: '加入的群',
        messages: [{ id: 'm', role: 'user', content: '可见消息' } as never],
      }}
    >
      <ReadShare />
    </ShareDataProvider>,
  );
  expect(screen.getByText('加入的群 可见消息')).toBeInTheDocument();
});

it('retains isolated run context when preparing a group conversation export', () => {
  mocks.allowOwnerReads = true;
  render(
    <ShareDataProvider
      context={{
        agentId: 'a',
        groupId: 'g',
        topicId: 't',
        threadId: null,
        isolatedTopic: true,
        scope: 'group',
      }}
    >
      <ReadShare />
    </ShareDataProvider>,
  );
  expect(mocks.fetch).toHaveBeenLastCalledWith(
    {
      agentId: 'a',
      groupId: 'g',
      topicId: 't',
      threadId: null,
      isolatedTopic: true,
      scope: 'group',
    },
    { skipFetch: false },
  );
});
