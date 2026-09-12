import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import GroupWorkPanel from './GroupWorkPanel';
import { useGroupWorkRequest } from './useGroupWorkRequest';
import { useGroupWorkStatus } from './useGroupWorkStatus';

vi.mock('./useGroupWorkStatus', () => ({
  useGroupWorkStatus: vi.fn(() => ({ data: [], error: null })),
}));

vi.mock('@/features/Conversation/store', () => ({
  useConversationStore: (selector: any) => selector({ context: { agentId: 'supervisor' } }),
}));
afterEach(() => {
  useGroupWorkRequest.setState({ request: null });
  vi.mocked(useGroupWorkStatus).mockReturnValue({ data: [], error: null } as any);
});

it('opens an existing task detail in the same group without issuing execution commands', () => {
  vi.mocked(useGroupWorkStatus).mockReturnValue({
    data: [
      {
        id: 'task-1',
        kind: 'tasks',
        agentId: 'researcher',
        title: '同行分析',
        assigneeLabel: '研究成员',
        status: '执行中',
        isRunning: true,
      },
    ],
  } as any);
  render(<GroupWorkPanel groupId="group" />);
  fireEvent.click(screen.getByRole('button', { name: '目标与任务' }));
  fireEvent.click(screen.getByRole('button', { name: /同行分析/ }));
  expect(useGroupWorkRequest.getState().request).toEqual({
    groupId: 'group',
    kind: 'tasks',
    detail: { id: 'task-1', agentId: 'researcher', title: '同行分析' },
  });
});

it('does not keep stale execution animation after a status request fails', () => {
  vi.mocked(useGroupWorkStatus).mockReturnValue({
    error: new Error('offline'),
    data: [
      {
        id: 'task-1',
        kind: 'tasks',
        title: '同行分析',
        assigneeLabel: '研究成员',
        status: '执行中',
        isRunning: true,
      },
    ],
  } as any);
  render(<GroupWorkPanel groupId="group" />);
  expect(screen.getByRole('status')).not.toHaveTextContent('执行中');
  expect(screen.getByText('进度更新失败，请重试')).toBeInTheDocument();
});

it.each([
  ['设定一个目标', 'goals'],
  ['制定一个任务', 'tasks'],
])('%s selects the original right-pane page, without opening a dialog', (label, kind) => {
  render(<GroupWorkPanel groupId="group" />);
  fireEvent.click(screen.getByRole('button', { name: '目标与任务' }));
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(useGroupWorkRequest.getState().request).toMatchObject({ groupId: 'group', kind });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
