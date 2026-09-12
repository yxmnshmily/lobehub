import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { useTopicsViewStore } from './store';
import TopicListView from './TopicListView';

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => true }));
vi.mock('@/routes/(main)/agent/channel/const', () => ({ getPlatformIcon: () => undefined }));

afterEach(() => useTopicsViewStore.getState().reset());

it('keeps the topic title readable instead of rendering desktop-only columns on mobile', () => {
  const onOpen = vi.fn();
  render(
    <TopicListView
      agentId=""
      groupBy="none"
      readOnly={false}
      showGroupTitles={false}
      groups={[
        {
          children: [
            {
              id: 'topic-1',
              title: '手机话题标题',
              createdAt: 1,
              updatedAt: 1,
              status: 'active',
              trigger: 'chat',
            },
          ],
          id: 'all',
        },
      ]}
      onOpen={onOpen}
    />,
  );

  expect(screen.getByText('手机话题标题')).toBeVisible();
  expect(screen.getByRole('checkbox', { name: '手机话题标题' })).toBeVisible();
  expect(screen.queryByText('—')).toBeNull();

  const topicLink = screen.getByRole('link', { name: '手机话题标题' });
  fireEvent.keyDown(topicLink, { key: 'Enter' });
  expect(onOpen).toHaveBeenCalledWith('topic-1');
});
