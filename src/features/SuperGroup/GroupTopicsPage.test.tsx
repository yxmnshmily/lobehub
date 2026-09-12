import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { TopicPageSource } from '@/features/AgentTopicManager';
import { useTopicsViewStore } from '@/features/AgentTopicManager/store';

import { GroupTopics } from './GroupTopicsPage';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  query: vi.fn(),
  more: vi.fn(),
  error: false,
  fetchNextError: false,
  groupsError: false,
  groupsRefetch: vi.fn(),
  kind: 'owner',
  update: vi.fn(),
  remove: vi.fn(),
  invalidate: vi.fn(),
  list: vi.fn(),
}));
vi.mock('@/services/topic', () => ({
  topicService: { updateTopic: mocks.update, removeTopic: mocks.remove },
}));
vi.mock('@/store/chat/utils/evictMessageCache', () => ({ evictMessageCache: vi.fn() }));
vi.mock('@/hooks/useQueryRoute', () => ({ useQueryRoute: () => ({ push: mocks.push }) }));
vi.mock('@/features/AgentTopicManager', () => ({
  default: ({ source }: { source: TopicPageSource }) => (
    <div data-testid="original-topic-page">
      {source.header}
      <input
        aria-label="搜索群话题"
        onChange={(e) => useTopicsViewStore.getState().setSearch(e.target.value)}
      />
      {source.error ? (
        <span>话题加载失败</span>
      ) : (
        source.topics.map((topic) => (
          <button key={topic.id} onClick={() => source.onOpen(topic.id)}>
            {topic.title}
          </button>
        ))
      )}
      {(source as TopicPageSource & { loadMoreError?: Error }).loadMoreError && (
        <span>更多话题加载失败</span>
      )}
      <button onClick={source.loadMore}>加载更多话题</button>
      {source.management && (
        <>
          <button
            onClick={() =>
              source.management!.updateTopicStatus({ topicId: 'topic-1', status: 'completed' })
            }
          >
            归档
          </button>
          <button onClick={() => source.management!.removeTopic('topic-1', false)}>删除</button>
          <button onClick={() => source.getArchiveTopics?.()}>归档旧话题</button>
        </>
      )}
    </div>
  ),
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { groupConversation: { listTopics: { query: mocks.list } } },
  lambdaQuery: {
    useUtils: () => ({
      message: { getMessages: { invalidate: mocks.invalidate } },
      groupConversation: {
        listTopics: { invalidate: mocks.invalidate },
        listGroups: { invalidate: mocks.invalidate },
      },
    }),
    groupConversation: {
      listGroups: {
        useQuery: () => ({
          data: [{ groupId: 'group-1', kind: mocks.kind }],
          error: mocks.groupsError ? new Error('Permission lookup failed') : undefined,
          isError: mocks.groupsError,
          refetch: mocks.groupsRefetch,
        }),
      },
      listTopics: {
        useInfiniteQuery: (input: unknown) => {
          mocks.query(input);
          return {
            data: {
              pages: [
                {
                  items: [{ id: 'topic-1', title: '行程计划', createdAt: new Date('2026-09-07') }],
                },
              ],
            },
            isError: mocks.error,
            isFetchNextPageError: mocks.fetchNextError,
            error: new Error('Forbidden'),
            hasNextPage: true,
            fetchNextPage: mocks.more,
            isLoading: false,
            isFetchingNextPage: false,
          };
        },
      },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.error = false;
  mocks.fetchNextError = false;
  mocks.groupsError = false;
  mocks.kind = 'owner';
});
afterEach(() => useTopicsViewStore.getState().reset());

it('reuses the original topic page and opens only the selected group topic', () => {
  render(<GroupTopics groupId="group-1" />);
  expect(screen.getByTestId('original-topic-page')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '行程计划' }));
  expect(mocks.push).toHaveBeenCalledWith('/group/group-1/topic-1');
  fireEvent.click(screen.getByRole('button', { name: '加载更多话题' }));
  expect(mocks.more).toHaveBeenCalled();
});
it('searches server-side in the selected group', async () => {
  render(<GroupTopics groupId="group-2" />);
  fireEvent.change(screen.getByRole('textbox', { name: '搜索群话题' }), {
    target: { value: ' 行程 ' },
  });
  await waitFor(() =>
    expect(mocks.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ groupId: 'group-2', keywords: '行程' }),
    ),
  );
});
it('does not expose cached group topics after access fails', () => {
  mocks.error = true;
  render(<GroupTopics groupId="group-1" />);
  expect(screen.getByText('话题加载失败')).toBeVisible();
  expect(screen.queryByRole('button', { name: '行程计划' })).toBeNull();
});

it('shows a retryable warning when group permissions cannot be confirmed', () => {
  mocks.groupsError = true;

  render(<GroupTopics groupId="group-1" />);

  expect(screen.getByRole('alert')).toHaveTextContent('群权限加载失败');
  fireEvent.click(screen.getByRole('button', { name: '重试权限加载' }));
  expect(mocks.groupsRefetch).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: '删除' })).toBeNull();
});

it('keeps loaded topics visible when only the next page fails', () => {
  mocks.error = true;
  mocks.fetchNextError = true;

  render(<GroupTopics groupId="group-1" />);

  expect(screen.getByRole('button', { name: '行程计划' })).toBeVisible();
  expect(screen.getByText('更多话题加载失败')).toBeVisible();
  expect(screen.queryByText('话题加载失败')).toBeNull();
  expect(screen.getByRole('button', { name: '归档', exact: true })).toBeVisible();
  expect(screen.getByRole('button', { name: '删除' })).toBeVisible();
});

it('connects owner archive and delete to the topic service and refreshes group data', async () => {
  render(<GroupTopics groupId="group-1" />);
  fireEvent.click(screen.getByRole('button', { name: '归档', exact: true }));
  await waitFor(() =>
    expect(mocks.update).toHaveBeenCalledWith('topic-1', { status: 'completed' }),
  );
  fireEvent.click(screen.getByRole('button', { name: '删除' }));
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('topic-1', false));
  await waitFor(() => expect(mocks.invalidate).toHaveBeenCalled());
});

it('keeps joined-group management read-only', () => {
  mocks.kind = 'member';
  render(<GroupTopics groupId="group-1" />);
  expect(screen.queryByRole('button', { name: '删除' })).toBeNull();
});

it('loads every page only from the current group for stale archival', async () => {
  mocks.list
    .mockResolvedValueOnce({ items: [], nextCursor: { id: 'cursor', createdAt: new Date(1) } })
    .mockResolvedValueOnce({ items: [], nextCursor: null });
  render(<GroupTopics groupId="group-1" />);
  fireEvent.click(screen.getByRole('button', { name: '归档旧话题' }));
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  expect(mocks.list).toHaveBeenLastCalledWith({
    groupId: 'group-1',
    limit: 50,
    order: 'oldest',
    cursor: { id: 'cursor', createdAt: new Date(1) },
  });
});
