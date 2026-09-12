import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { useTopicsViewStore } from './store';
import TopicCard from './TopicCard';

vi.mock('@/features/CustomerCenter/useMonthlyExchangeRate', () => ({
  useMonthlyExchangeRate: () => ({ format: String }),
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('@/routes/(main)/agent/channel/const', () => ({ getPlatformIcon: () => undefined }));
afterEach(() => useTopicsViewStore.getState().reset());

it('selects a manageable group topic without opening its conversation', () => {
  const onOpen = vi.fn();
  render(
    <TopicCard
      agentId=""
      readOnly={false}
      topic={{ id: 't1', title: '群话题', createdAt: 1, updatedAt: 1 }}
      onOpen={onOpen}
    />,
  );
  fireEvent.click(screen.getByRole('checkbox'));
  expect(useTopicsViewStore.getState().selectedIds).toEqual(['t1']);
  expect(onOpen).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('群话题'));
  expect(useTopicsViewStore.getState().selectedIds).toEqual([]);
  expect(onOpen).not.toHaveBeenCalled();
});

it('keeps an explicitly read-only group topic unselectable', () => {
  const onOpen = vi.fn();
  render(
    <TopicCard
      readOnly
      agentId=""
      topic={{ id: 't1', title: '群话题', createdAt: 1, updatedAt: 1 }}
      onOpen={onOpen}
    />,
  );
  expect(screen.queryByRole('checkbox')).toBeNull();
  const topicLink = screen.getByRole('link', { name: '群话题' });
  fireEvent.keyDown(topicLink, { key: 'Enter' });
  expect(onOpen).toHaveBeenCalledWith('t1');
});
