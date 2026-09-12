import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import AgentTopicManager from './index';
import { useTopicsViewStore } from './store';

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: object) => unknown) =>
    selector({
      useFetchAgentTopicsView: () => ({}),
      useSearchTopics: () => ({}),
    }),
}));
vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    agentTopicsViewTopics: () => [],
    agentTopicsViewHasMore: () => false,
    agentTopicsViewIsLoadingMore: () => false,
    agentTopicsViewLoadMoreError: () => undefined,
  },
}));
vi.mock('./Header', () => ({ default: () => null }));
vi.mock('./Toolbar', () => ({ default: () => null }));
vi.mock('./BulkActionBar', () => ({ default: () => null }));
vi.mock('./TopicGrid', () => ({ default: () => null }));
vi.mock('./TopicListView', () => ({ default: () => null }));
vi.mock('./EmptyState', () => ({ default: () => <span>没有匹配的话题</span> }));
afterEach(() => {
  useTopicsViewStore.getState().reset();
  vi.unstubAllGlobals();
});

it('keeps pagination available when the current page has no archived matches', () => {
  const observe = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = observe;
      disconnect = vi.fn();
    },
  );
  const { container } = render(
    <AgentTopicManager
      source={{
        scopeKey: 'group-test',
        header: null,
        topics: [{ id: 'active', title: '活跃话题', createdAt: 1, updatedAt: 1, status: 'active' }],
        hasMore: true,
        isLoading: false,
        isLoadingMore: false,
        loadMore: vi.fn(),
        retry: vi.fn(),
        onOpen: vi.fn(),
      }}
    />,
  );
  act(() => useTopicsViewStore.getState().setStatus('completed'));
  expect(container.textContent).toContain('没有匹配的话题');
  expect(container.querySelector('[aria-hidden]')).not.toBeNull();
  expect(observe).toHaveBeenCalled();
});

it('starts source-backed topic pages without the agent-only chat filter', () => {
  render(
    <AgentTopicManager
      source={{
        scopeKey: 'group-test',
        header: null,
        topics: [],
        hasMore: false,
        isLoading: false,
        isLoadingMore: false,
        loadMore: vi.fn(),
        retry: vi.fn(),
        onOpen: vi.fn(),
      }}
    />,
  );

  expect(useTopicsViewStore.getState().triggers).toEqual([]);
});
