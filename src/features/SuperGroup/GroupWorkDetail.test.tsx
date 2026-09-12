import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import GroupWorkDetail from './GroupWorkDetail';

const state = vi.hoisted(() => ({
  data: { belongs: true, agentId: 'writer' },
  error: undefined as unknown,
}));
vi.mock('@/libs/swr', () => ({ useClientDataSWR: () => ({ ...state, mutate: vi.fn() }) }));
vi.mock('@/services/goal', () => ({ goalService: {} }));
vi.mock('@/services/task', () => ({ taskService: {} }));
vi.mock('@/features/AgentGoals/GoalDetailPage', () => ({
  default: ({ agentId, goalId }: any) => (
    <output aria-label="goal detail">
      {agentId}/{goalId}
    </output>
  ),
}));
vi.mock('@/features/AgentTasks/AgentTaskDetail/AgentScopedTaskDetailPage', () => ({
  default: ({ agentId, taskId }: any) => (
    <output aria-label="task detail">
      {agentId}/{taskId}
    </output>
  ),
}));

afterEach(() => {
  state.data = { belongs: true, agentId: 'writer' };
});

it.each(['goals', 'tasks'] as const)(
  'mounts the complete %s detail with its actual executor',
  async (kind) => {
    render(<GroupWorkDetail agentId="supervisor" groupId="travel" id="work-1" kind={kind} />);
    expect(
      await screen.findByLabelText(kind === 'goals' ? 'goal detail' : 'task detail'),
    ).toHaveTextContent('writer/work-1');
  },
);

it('does not mount work from another group', () => {
  state.data.belongs = false;
  render(<GroupWorkDetail agentId="supervisor" groupId="travel" id="work-1" kind="goals" />);
  expect(screen.queryByLabelText('goal detail')).toBeNull();
  expect(screen.getByText('未找到该群的目标或任务')).toBeVisible();
});
