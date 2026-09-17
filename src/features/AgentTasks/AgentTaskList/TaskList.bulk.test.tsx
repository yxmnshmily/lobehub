import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { TaskListItem } from '@/store/task/slices/list/initialState';

import type { TaskListViewOptions } from './listViewOptions';
import TaskList from './TaskList';

const mocks = vi.hoisted(() => ({
  groupOwner: true,
  remove: vi.fn(),
  confirm: vi.fn(),
  allowed: true,
}));
vi.mock('@lobehub/ui/base-ui', async (original) => ({
  ...(await original<object>()),
  confirmModal: mocks.confirm,
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: mocks.allowed }) }));
vi.mock('@/store/task', () => ({
  useTaskStore: (selector: (s: object) => unknown) =>
    selector({ tasks: [], tasksTotal: 0, deleteTask: mocks.remove }),
}));
vi.mock('@/components/AsyncBoundary', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../features/AgentTaskItem', () => ({
  default: ({ task }: { task: TaskListItem }) => <div>{task.name}</div>,
}));
vi.mock('./useClosestScrollParent', () => ({
  useClosestScrollParent: () => ({ ref: () => {}, scrollParent: document.body }),
}));
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data: unknown[];
    itemContent: (i: number, row: unknown) => ReactNode;
  }) => (
    <>
      {data.map((row, index) => (
        <div key={index}>{itemContent(index, row)}</div>
      ))}
    </>
  ),
}));
const options = {
  groupBy: 'none',
  subGroupBy: 'none',
  showSubTasks: true,
  hideCompleted: false,
  nestedSubTasks: false,
} as TaskListViewOptions;
const tasks = [
  { id: 'one', identifier: 'T-1', name: 'First', status: 'backlog' },
  { id: 'two', identifier: 'T-2', name: 'Second', status: 'completed' },
] as TaskListItem[];
beforeEach(() => {
  mocks.groupOwner = true;
  vi.clearAllMocks();
  mocks.allowed = true;
  mocks.remove.mockResolvedValue({ deletion: {} });
});
it('selects filtered tasks, waits for confirmation and passes task identifiers', async () => {
  render(<TaskList data items={tasks} options={{ ...options, hideCompleted: true }} />);
  await userEvent.click(screen.getAllByRole('checkbox')[0]);
  fireEvent.click(screen.getByRole('button', { name: /删除|Delete|bulkDelete.deleteSelected/ }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
  expect(mocks.remove).not.toHaveBeenCalled();
  await act(async () => {
    await mocks.confirm.mock.calls[0][0].onOk();
  });
  expect(mocks.remove).toHaveBeenCalledWith({
    resource: 'task',
    ids: ['T-1'],
    snapshot: 'snapshot',
  });
});
it('retains all selections after an atomic failure and drops them when filtered away', async () => {
  mocks.remove.mockRejectedValueOnce(new Error('failure'));
  const { rerender } = render(<TaskList data items={tasks} options={options} />);
  await userEvent.click(screen.getAllByRole('checkbox')[0]);
  fireEvent.click(screen.getByRole('button', { name: /删除|Delete|bulkDelete.deleteSelected/ }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
  await act(async () => {
    await expect(mocks.confirm.mock.calls[0][0].onOk()).rejects.toThrow('failure');
  });
  expect(screen.getByRole('checkbox', { name: /Second/ })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: /First/ })).toBeChecked();
  rerender(<TaskList data items={tasks} options={{ ...options, hideCompleted: true }} />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: /删除|Delete|bulkDelete.deleteSelected/ }),
    ).not.toBeDisabled(),
  );
});
it('does not offer bulk actions without existing management permission', () => {
  mocks.allowed = false;
  render(<TaskList data items={tasks} options={options} />);
  expect(screen.queryByRole('checkbox')).toBeNull();
});

vi.mock('@/features/SuperGroup/useGroupDeletePermission', () => ({
  useGroupDeletePermission: (allowed: boolean) => ({
    canDelete: allowed && mocks.groupOwner,
    checkDeletePermission: () => allowed && mocks.groupOwner,
  }),
}));

it('does not expose deletion in a joined group', () => {
  mocks.groupOwner = false;
  render(<TaskList data items={tasks} options={options} />);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('button', { name: /bulkDelete.deleteSelected/ })).toBeNull();
});

vi.mock('@/services/resourceDeletionCache', () => ({ clearResourceDeletionCache: vi.fn() }));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    resourceDeletion: {
      retryPendingCleanup: { mutate: vi.fn().mockResolvedValue({ storageCleanups: [] }) },
      delete: { mutate: mocks.remove },
      preview: {
        query: vi.fn().mockResolvedValue({
          snapshot: 'snapshot',
          deleteCounts: { goals: 1, tasks: 1, topics: 2, files: 3 },
          retainedCounts: { goals: 0, tasks: 0, topics: 1, files: 1 },
        }),
      },
    },
  },
}));

afterEach(() => {
  for (const [modal] of mocks.confirm.mock.calls) modal.onCancel?.();
});
