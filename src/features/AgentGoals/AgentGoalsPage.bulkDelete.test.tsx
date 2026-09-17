import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import AgentGoalsPage from './AgentGoalsPage';

const state = vi.hoisted(() => ({
  groupOwner: true,
  remove: vi.fn(),
  confirm: vi.fn(),
  filter: 'all',
  allowed: true,
  goals: [
    { goal: { id: 'g1', title: 'Goal one', agentId: 'a1', status: 'pursuing' } },
    { goal: { id: 'g2', title: 'Goal two', agentId: null, status: 'achieved' } },
    { goal: { id: 'g3', title: 'Not loaded yet', status: 'pursuing' } },
    { goal: { id: 'g4', title: 'Canceled goal', status: 'canceled' } },
  ],
}));
vi.mock('@/store/goal', () => ({
  goalSelectors: { goalList: () => () => state.goals, isGoalListInitialized: () => () => true },
  useGoalStore: (selector: any) =>
    selector({
      deleteGoal: state.remove,
      refreshGoals: vi.fn(),
      goalListFilter: state.filter,
      goalViewMode: 'list',
      goalListVisibleLimit: 2,
      setGoalListFilter: vi.fn(),
      setGoalViewMode: vi.fn(),
      useFetchGoals: () => ({}),
    }),
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: state.allowed }) }));
vi.mock('@/features/SuperGroup/useGroupWorkHistory', () => ({
  useGroupWorkHistory: () => ({ isHome: false, toggleView: vi.fn() }),
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('@/features/NavHeader', () => ({ default: () => null }));
vi.mock('@/features/WideScreenContainer', () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('./GoalListItem', () => ({
  GoalListItem: ({ goal }: any) => <span>{goal.goal.title}</span>,
}));
vi.mock('./GoalCardItem', () => ({
  GoalCardItem: ({ goal }: any) => <span>{goal.goal.title}</span>,
}));
vi.mock('./CreateGoalModal', () => ({ createGoalModal: vi.fn() }));
vi.mock('./goalSummary', () => ({
  summarizeGoals: () => ({ total: 3, pursuing: 2, delivered: 1 }),
}));
vi.mock('@lobehub/ui/base-ui', async (original) => ({
  ...(await original<any>()),
  confirmModal: state.confirm,
}));
beforeEach(() => {
  state.groupOwner = true;
  state.remove.mockReset().mockResolvedValue({ deletion: {} });
  for (const [modal] of state.confirm.mock.calls) modal.onCancel?.();
  state.confirm.mockReset();
  state.allowed = true;
  state.filter = 'all';
});
it('deletes only displayed selections in one atomic request', async () => {
  render(<AgentGoalsPage groupId="group1" />);
  await userEvent.click(screen.getByRole('checkbox', { name: 'bulkDelete.selectVisible' }));
  fireEvent.click(screen.getByRole('button', { name: /bulkDelete.deleteSelected/ }));
  await waitFor(() => expect(state.confirm).toHaveBeenCalled());
  await act(async () => state.confirm.mock.calls[0][0].onOk());
  expect(state.remove).toHaveBeenCalledWith({
    resource: 'goal',
    ids: ['g1', 'g2'],
    snapshot: 'snapshot',
  });
  expect(screen.getByRole('checkbox', { name: 'Goal one' })).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Goal two' })).not.toBeChecked();
});
it('clears selection on scope change and rejects a previous group confirmation', async () => {
  const view = render(<AgentGoalsPage groupId="group1" />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Goal one' }));
  fireEvent.click(screen.getByRole('button', { name: /bulkDelete.deleteSelected/ }));
  await waitFor(() => expect(state.confirm).toHaveBeenCalled());
  view.rerender(<AgentGoalsPage groupId="group2" />);
  await act(async () => state.confirm.mock.calls[0][0].onOk());
  expect(state.remove).not.toHaveBeenCalled();
  expect(screen.getByRole('checkbox', { name: 'Goal one' })).not.toBeChecked();
});
it('preserves the existing edit permission', () => {
  state.allowed = false;
  render(<AgentGoalsPage groupId="group1" />);
  expect(screen.queryByRole('checkbox')).toBeNull();
});

vi.mock('@/features/SuperGroup/useGroupDeletePermission', () => ({
  useGroupDeletePermission: (allowed: boolean) => ({
    canDelete: allowed && state.groupOwner,
    checkDeletePermission: () => allowed && state.groupOwner,
  }),
}));

it('hides selection and deletion in a joined group and rejects the old owner confirmation', async () => {
  const view = render(<AgentGoalsPage groupId="group1" />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Goal one' }));
  fireEvent.click(screen.getByRole('button', { name: /bulkDelete.deleteSelected/ }));
  await waitFor(() => expect(state.confirm).toHaveBeenCalled());
  state.groupOwner = false;
  view.rerender(<AgentGoalsPage groupId="joined" />);
  expect(screen.queryByRole('button', { name: /bulkDelete.deleteSelected/ })).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  await act(async () => state.confirm.mock.calls[0][0].onOk());
  expect(state.remove).not.toHaveBeenCalled();
});

vi.mock('@/services/resourceDeletionCache', () => ({ clearResourceDeletionCache: vi.fn() }));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    resourceDeletion: {
      retryPendingCleanup: { mutate: vi.fn().mockResolvedValue({ storageCleanups: [] }) },
      delete: { mutate: state.remove },
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
  for (const [modal] of state.confirm.mock.calls) modal.onCancel?.();
});

it('shows canceled goals independently of the active filter and its pagination', () => {
  state.filter = 'canceled';
  const view = render(<AgentGoalsPage groupId="group1" />);
  expect(screen.getByText('Canceled goal')).toBeInTheDocument();
  expect(screen.queryByText('Goal one')).toBeNull();
  expect(screen.queryByText('Goal two')).toBeNull();
  state.filter = 'active';
  view.rerender(<AgentGoalsPage groupId="group2" />);
  expect(screen.queryByText('Canceled goal')).toBeNull();
  expect(screen.getByText('Goal one')).toBeInTheDocument();
});
