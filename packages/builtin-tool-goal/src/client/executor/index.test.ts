import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  advance: vi.fn(),
  create: vi.fn(),
  getGraph: vi.fn(),
  revise: vi.fn(),
  resume: vi.fn(),
}));

vi.mock('@/services/goal', () => ({
  goalService: {
    advance: mocks.advance,
    create: mocks.create,
    getGraph: mocks.getGraph,
    revise: mocks.revise,
    resume: mocks.resume,
  },
}));
vi.mock('@lobechat/builtin-tool-task/client/executor', () => ({
  taskExecutor: { onAfterCall: vi.fn() },
}));

const { goalExecutor } = await import('./index');

const params = {
  criteria: [{ title: 'It works' }],
  instruction: 'do the thing',
  name: 'A goal',
};

describe('goalExecutor.createGoal', () => {
  it('passes the originating group to the durable goal', async () => {
    mocks.create.mockResolvedValue({ goal: { id: 'goal_1', title: 'A goal' } });
    mocks.advance.mockResolvedValue({ message: 'Started' });
    await goalExecutor.createGoal(params, { agentId: 'agt_1', groupId: 'group-1' } as never);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ groupId: 'group-1' }),
      }),
    );
  });
  it('reports the created goal even when starting it fails', async () => {
    // The goal is already committed. Reporting creation failure makes the agent
    // create a second goal, and both then do the same paid work.
    mocks.create.mockResolvedValue({ goal: { id: 'goal_1', title: 'A goal' } });
    mocks.advance.mockRejectedValue(new Error('device runner offline'));

    const result = await goalExecutor.createGoal(params, { agentId: 'agt_1' } as never);

    expect(result.success).toBe(true);
    expect((result.state as { goalId?: string }).goalId).toBe('goal_1');
    expect(result.content).toContain('device runner offline');
    expect(result.content).toContain('Do not create it again');
  });

  it('fails only when the goal itself was not created', async () => {
    mocks.create.mockRejectedValue(new Error('database is down'));

    const result = await goalExecutor.createGoal(params, { agentId: 'agt_1' } as never);

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('GoalCreateFailed');
  });
});

it('executes follow-up APIs on the original goal through the remote service', async () => {
  mocks.getGraph.mockResolvedValue({
    goal: { id: 'g', status: 'paused', config: { groupId: 'group' } },
    nodes: [],
    workVersions: [],
  });
  mocks.revise.mockResolvedValue({
    data: { goal: { status: 'paused' }, taskIds: ['t'] },
    message: 'Saved',
  });
  mocks.resume.mockResolvedValue({ data: { status: 'running' }, message: 'Resumed' });
  const ctx = { groupId: 'group' } as never;
  expect((await goalExecutor.viewGoal({ goalId: 'g' }, ctx)).success).toBe(true);
  await goalExecutor.reviseGoal({ goalId: 'g', nodeId: 'n', instruction: 'new' }, ctx);
  expect(mocks.revise).toHaveBeenCalledWith({
    id: 'g',
    nodeId: 'n',
    instruction: 'new',
    groupId: 'group',
  });
  await goalExecutor.resumeGoal({ goalId: 'g' }, ctx);
  expect(mocks.resume).toHaveBeenCalledWith('g', 'group');
});
it('refuses a goal belonging to another group', async () => {
  mocks.getGraph.mockResolvedValue({ goal: { config: { groupId: 'other' } } });
  expect(
    (await goalExecutor.viewGoal({ goalId: 'g' }, { groupId: 'group' } as never)).success,
  ).toBe(false);
});
