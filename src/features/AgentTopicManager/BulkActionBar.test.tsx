import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import BulkActionBar from './BulkActionBar';
import { useTopicsViewStore } from './store';

const confirm = vi.hoisted(() => vi.fn());
vi.mock('@/features/DeleteTopicConfirm', () => ({ confirmRemoveTopic: confirm }));
vi.mock('./MoveToAgentButton', () => ({ default: () => <span>移动到助手</span> }));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: object) => unknown) => selector({}),
}));
afterEach(() => {
  useTopicsViewStore.getState().reset();
  vi.clearAllMocks();
});

it('archives only selected topics and restores them from the archived view', async () => {
  const management = { favoriteTopic: vi.fn(), removeTopic: vi.fn(), updateTopicStatus: vi.fn() };
  useTopicsViewStore.setState({ selectedIds: ['one', 'two'], selectMode: true });
  render(<BulkActionBar management={management} />);
  expect(screen.getByText('移动到助手')).toBeVisible();
  fireEvent.click(screen.getAllByRole('button')[1]);
  await waitFor(() => expect(useTopicsViewStore.getState().selectedIds).toEqual([]));
  expect(management.updateTopicStatus.mock.calls).toEqual([
    [{ topicId: 'one', status: 'completed' }],
    [{ topicId: 'two', status: 'completed' }],
  ]);
  useTopicsViewStore.setState({ selectedIds: ['one'], selectMode: true, status: 'completed' });
  await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(4));
  fireEvent.click(screen.getAllByRole('button')[1]);
  await waitFor(() =>
    expect(management.updateTopicStatus).toHaveBeenLastCalledWith({
      topicId: 'one',
      status: 'active',
    }),
  );
  expect(screen.queryByText('移动到助手')).toBeNull();
});

it('does not delete before confirmation and forwards the attachment choice', async () => {
  const management = { favoriteTopic: vi.fn(), removeTopic: vi.fn(), updateTopicStatus: vi.fn() };
  useTopicsViewStore.setState({ selectedIds: ['one', 'two'], selectMode: true });
  render(<BulkActionBar management={management} />);
  fireEvent.click(screen.getAllByRole('button')[2]);
  expect(management.removeTopic).not.toHaveBeenCalled();
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ topicIds: ['one', 'two'] }));
  await confirm.mock.calls[0][0].onConfirm(false);
  expect(management.removeTopic.mock.calls).toEqual([
    ['one', false],
    ['two', false],
  ]);
});
