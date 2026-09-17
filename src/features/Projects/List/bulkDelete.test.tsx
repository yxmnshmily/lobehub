import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { GroupProjectScopeContext } from '../Layout/GroupProjectScope';
import ProjectListPage from './index';

dayjs.extend(relativeTime);

const state = vi.hoisted(() => ({
  groupOwner: true,
  projects: [
    { id: 'p1', name: 'Own one', userId: 'u1', totalRunCost: 0.015301, totalRunDuration: 120000 },
    { id: 'p2', name: 'Own two', userId: 'u1' },
    { id: 'p3', name: 'Other owner', userId: 'u2' },
  ],
  remove: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('@/store/user', () => ({ useUserStore: (selector: any) => selector({}) }));
vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: { enableProjects: () => true },
  userProfileSelectors: { userId: () => 'u1' },
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => undefined,
}));
vi.mock('@/features/User/UserAvatar', () => ({ default: () => null }));
vi.mock('@/features/TopicCreatorAvatar', () => ({ default: () => null }));
vi.mock('@/features/Workspace/WorkspaceLink', () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@/features/NavHeader', () => ({ default: () => null }));
vi.mock('@/features/WideScreenContainer', () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('@/store/project', () => ({
  useCurrentProjectList: () => state.projects,
  useProjectStore: (selector: any) =>
    selector({
      deleteProject: state.remove,
      useFetchProjectList: () => ({ isLoading: false, mutate: vi.fn() }),
    }),
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
});
const page = (groupId = 'g1') => (
  <GroupProjectScopeContext value={{ groupId }}>
    <ProjectListPage />
  </GroupProjectScopeContext>
);
it('selects only owned visible projects in one atomic request', async () => {
  render(page());
  await userEvent.click(screen.getByRole('checkbox', { name: 'bulkDelete.selectVisible' }));
  expect(screen.queryByRole('checkbox', { name: 'Other owner' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /bulkDelete.deleteSelected/ }));
  await waitFor(() => expect(state.confirm).toHaveBeenCalled());
  expect(state.confirm.mock.calls[0][0].okButtonProps.danger).toBe(true);
  await act(async () => state.confirm.mock.calls[0][0].onOk());
  expect(state.remove).toHaveBeenCalledWith({
    resource: 'project',
    ids: ['p1', 'p2'],
    snapshot: 'snapshot',
  });
  expect(screen.getByRole('checkbox', { name: 'Own one' })).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Own two' })).not.toBeChecked();
});
it('clears selection on filter and group change and rejects stale confirmation', async () => {
  const view = render(page());
  fireEvent.click(screen.getByRole('checkbox', { name: 'Own one' }));
  fireEvent.click(screen.getByRole('button', { name: /bulkDelete.deleteSelected/ }));
  await waitFor(() => expect(state.confirm).toHaveBeenCalled());
  view.rerender(page('g2'));
  await act(async () => state.confirm.mock.calls[0][0].onOk());
  expect(state.remove).not.toHaveBeenCalled();
  expect(screen.getByRole('checkbox', { name: 'Own one' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Own two' }));
  fireEvent.change(screen.getByPlaceholderText('list.searchPlaceholder'), {
    target: { value: 'Own one' },
  });
  expect(screen.getByRole('button', { name: /bulkDelete.deleteSelected/ })).toBeDisabled();
});

vi.mock('@/features/SuperGroup/useGroupDeletePermission', () => ({
  useGroupDeletePermission: (allowed: boolean) => ({
    canDelete: allowed && state.groupOwner,
    checkDeletePermission: () => allowed && state.groupOwner,
  }),
}));

it('hides selection and deletion in a joined group and rejects the old owner confirmation', async () => {
  const view = render(page());
  fireEvent.click(screen.getByRole('checkbox', { name: 'Own one' }));
  fireEvent.click(screen.getByRole('button', { name: /bulkDelete.deleteSelected/ }));
  await waitFor(() => expect(state.confirm).toHaveBeenCalled());
  state.groupOwner = false;
  view.rerender(page());
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

vi.mock('@/features/CustomerCenter/useMonthlyExchangeRate', () => ({
  useMonthlyExchangeRate: () => ({ format: String, notice: '' }),
}));

it('renders recorded project duration and equivalent credits', () => {
  render(page());
  expect(screen.getByText(/15,301/)).toBeInTheDocument();
  expect(screen.getByText('2runUsage.minutes')).toBeInTheDocument();
});
