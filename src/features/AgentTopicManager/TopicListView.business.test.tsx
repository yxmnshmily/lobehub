import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { useTopicsViewStore } from './store';
import TopicListView from './TopicListView';

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/routes/(main)/agent/channel/const', () => ({ getPlatformIcon: () => undefined }));

afterEach(() => useTopicsViewStore.getState().reset());

it('shows business associations and topic credits alongside the update time', () => {
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
              cost: 0.015301,
              businessAssociations: [{ id: 'task-1', kind: 'task', title: '写宣传文案' }],
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
  expect(screen.getByText(/写宣传文案/)).toBeVisible();
  expect(screen.getByText('15,301')).toBeVisible();

  const topicLink = screen.getByRole('link', { name: '手机话题标题' });
  fireEvent.keyDown(topicLink, { key: 'Enter' });
  expect(onOpen).toHaveBeenCalledWith('topic-1');
});
