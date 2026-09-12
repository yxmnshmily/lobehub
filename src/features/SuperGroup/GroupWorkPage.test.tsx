import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import GroupWorkPage from './GroupWorkPage';

const state = vi.hoisted(() => ({
  context: { agentId: '', groupId: 'joined-group' },
  query: {
    data: { assistants: [{ id: 'host', isSupervisor: true }] } as
      { assistants: { id: string; isSupervisor: boolean }[] } | undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  useQuery: vi.fn(),
}));
vi.mock('react-router', () => ({ useParams: () => ({ gid: 'joined-group' }) }));
vi.mock('@/features/Conversation/store', () => ({
  useConversationStore: (select: (value: typeof state) => unknown) => select(state),
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: { groupMembership: { listParticipants: { useQuery: state.useQuery } } },
}));
// The reused pages are separate workspaces; expose the scope passed across this boundary.
vi.mock('@/features/AgentGoals/AgentGoalsPage', () => ({
  default: ({ agentId, groupId }: { agentId: string; groupId: string }) => (
    <output aria-label="goal scope">
      {groupId}/{agentId}
    </output>
  ),
}));
vi.mock('@/features/AgentTasks/AgentTaskList/AgentTasksPage', () => ({
  default: ({ agentId, groupId }: { agentId: string; groupId: string }) => (
    <output aria-label="task scope">
      {groupId}/{agentId}
    </output>
  ),
}));

beforeEach(() => {
  state.context = { agentId: '', groupId: 'joined-group' };
  state.query = {
    data: {
      assistants: [
        { id: 'other', isSupervisor: false },
        { id: 'host', isSupervisor: true },
      ],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
  state.useQuery.mockReset().mockImplementation(() => state.query);
});

it.each([
  ['goals', 'goal scope'],
  ['tasks', 'task scope'],
] as const)(
  'opens %s for the joined group even when its conversation has no agent id',
  async (kind, label) => {
    render(<GroupWorkPage kind={kind} />);
    expect(await screen.findByLabelText(label)).toHaveTextContent('joined-group/host');
  },
);

it('does not reuse an agent from the previous group', async () => {
  state.context = { agentId: 'previous-host', groupId: 'previous-group' };
  render(<GroupWorkPage kind="goals" />);
  expect(await screen.findByLabelText('goal scope')).toHaveTextContent('joined-group/host');
});

it('shows a retry action instead of loading forever after member lookup fails', () => {
  state.query.data = undefined;
  state.query.isError = true;
  render(<GroupWorkPage kind="goals" />);
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(state.query.refetch).toHaveBeenCalledOnce();
  expect(screen.queryByText('正在加载群成员…')).toBeNull();
});

it('reports a missing supervisor after the member list has finished loading', () => {
  state.query.data = { assistants: [] };
  render(<GroupWorkPage kind="tasks" />);
  expect(screen.getByRole('button', { name: '重试' })).toBeVisible();
  expect(screen.queryByText('正在加载群成员…')).toBeNull();
});

it('resolves the actual supervisor even if the previous conversation selected another member', async () => {
  state.context.agentId = 'owner-host';
  render(<GroupWorkPage kind="goals" />);
  expect(await screen.findByLabelText('goal scope')).toHaveTextContent('joined-group/host');
  expect(state.useQuery).toHaveBeenCalledWith(
    { groupId: 'joined-group' },
    expect.objectContaining({ enabled: true }),
  );
});
