import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  advanceGoal: vi.fn(),
  create: vi.fn(),
  graph: vi.fn(),
  revise: vi.fn(),
  resume: vi.fn(),
  scheduleGoalAdvance: vi.fn(),
}));

vi.mock('@/server/services/goal', () => ({
  GoalService: vi.fn(function () {
    return { create: mocks.create, graph: mocks.graph, revise: mocks.revise, resume: mocks.resume };
  }),
}));
vi.mock('@/server/services/goal/advanceGoal', () => ({ advanceGoal: mocks.advanceGoal }));
vi.mock('@/server/services/goal/scheduler', () => ({
  scheduleGoalAdvance: mocks.scheduleGoalAdvance,
}));

const { goalRuntime } = await import('../goal');

const runtime = () =>
  goalRuntime.factory({
    agentId: 'agt_1',
    serverDB: {} as never,
    toolManifestMap: {},
    userId: 'user-1',
    workspaceId: 'ws-1',
  } as never);

const args = {
  criteria: [{ title: 'It works' }],
  instruction: 'do the thing',
  name: 'A goal',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ goal: { id: 'goal_1', title: 'A goal' } });
});

describe('goalRuntime.createGoal', () => {
  it('keeps a group-created goal in that group when execution moves to the coordinator', async () => {
    mocks.advanceGoal.mockResolvedValue({ result: { message: 'Started', taskId: 't1' } });
    const grouped = goalRuntime.factory({
      agentId: 'agt_1',
      groupId: 'group-1',
      serverDB: {},
      toolManifestMap: {},
      userId: 'user-1',
      workspaceId: 'ws-1',
    } as never);
    await grouped.createGoal(args);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ groupId: 'group-1' }),
      }),
    );
  });
  it('queues the advance so a failed kickoff is genuinely recoverable', async () => {
    // This path calls GoalService directly, so nothing else schedules the goal.
    // Without the queued advance the "the server will pick it up" message below
    // is false and the goal sits in `planning` forever.
    mocks.advanceGoal.mockRejectedValue(new Error('runner offline'));

    const result = await runtime().createGoal(args);

    expect(mocks.scheduleGoalAdvance).toHaveBeenCalledWith({
      goalId: 'goal_1',
      // The label survives the queue hop onto the trajectory, so a run can be
      // sliced by what drove it — asserted here rather than left loose.
      trigger: 'create',
      userId: 'user-1',
      workspaceId: 'ws-1',
    });
    expect(result.success).toBe(true);
    expect(result.content).toContain('Do not create it again');
  });

  it('reports the started goal when the kickoff succeeds', async () => {
    mocks.advanceGoal.mockResolvedValue({ result: { message: 'Started task T-1', taskId: 't1' } });

    const result = await runtime().createGoal(args);

    expect(mocks.scheduleGoalAdvance).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.content).toContain('Started task T-1');
  });
});

describe('goalRuntime existing work', () => {
  it('returns current work identifiers so a revision can address the original task', async () => {
    mocks.graph.mockResolvedValue({
      goal: { id: 'goal_1', title: 'Poster', status: 'achieved' },
      nodes: [
        { id: 'node-1', kind: 'task', title: 'Artwork', taskId: 'task-1', status: 'resolved' },
      ],
      workVersions: [],
    });
    const result = await runtime().viewGoal({ goalId: 'goal_1' });
    expect(result.success).toBe(true);
    expect(result.content).toContain('task-1');
    expect(result.content).toContain('node-1');
  });

  it('queues the saved revision without claiming a new result is already finished', async () => {
    mocks.revise.mockResolvedValue({
      goal: { id: 'goal_1', status: 'running' },
      revisedNodeIds: ['node-1'],
      taskIds: ['task-1'],
    });
    const result = await runtime().reviseGoal({
      goalId: 'goal_1',
      nodeId: 'node-1',
      instruction: 'Warmer wording',
    });
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      goalId: 'goal_1',
      taskIds: ['task-1'],
      status: 'running',
    });
    expect(result.content).toContain('queued');
  });

  it('keeps internal cancellation errors out of the conversation', async () => {
    mocks.revise.mockRejectedValueOnce(new Error('private-host token=secret'));
    const result = await runtime().reviseGoal({
      goalId: 'goal_1',
      nodeId: 'node-1',
      instruction: 'Change',
    });
    expect(result.success).toBe(false);
    expect(result.content).not.toContain('secret');
    expect(result.content).toContain('paused');
  });

  it('does not reveal a goal belonging to another group', async () => {
    mocks.graph.mockResolvedValue({
      goal: { id: 'goal_1', config: { groupId: 'other' } },
      nodes: [],
    });
    const tool = goalRuntime.factory({
      agentId: 'agt_1',
      groupId: 'current',
      serverDB: {},
      toolManifestMap: {},
      userId: 'user-1',
    } as never);
    const result = await tool.viewGoal({ goalId: 'goal_1' });
    expect(result.success).toBe(false);
    expect(result.content).not.toContain('other');
  });
});

describe('goalRuntime.resumeGoal', () => {
  it('resumes the same paused goal without replacing its budget', async () => {
    mocks.graph.mockResolvedValue({ goal: { id: 'goal_1', status: 'paused', maxTotalCost: 2 } });
    mocks.resume.mockResolvedValue({ id: 'goal_1', status: 'running', maxTotalCost: 2 });
    mocks.scheduleGoalAdvance.mockResolvedValue(undefined);
    const result = await runtime().resumeGoal({ goalId: 'goal_1' });
    expect(mocks.resume).toHaveBeenCalledWith('goal_1');
    expect(mocks.scheduleGoalAdvance).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: 'goal_1', trigger: 'manual' }),
    );
    expect(result.state).toEqual({ goalId: 'goal_1', status: 'running' });
    expect(result.content).toContain('queued');
  });
  it('does not resume another group goal', async () => {
    mocks.graph.mockResolvedValue({
      goal: { id: 'goal_1', status: 'paused', config: { groupId: 'other' } },
    });
    const tool = goalRuntime.factory({
      userId: 'user-1',
      serverDB: {},
      groupId: 'current',
      toolManifestMap: {},
    } as never);
    expect((await tool.resumeGoal({ goalId: 'goal_1' })).success).toBe(false);
    expect(mocks.resume).not.toHaveBeenCalled();
    expect(mocks.scheduleGoalAdvance).not.toHaveBeenCalled();
  });
  it('does not replay a completed goal or bypass a pending review', async () => {
    mocks.graph.mockResolvedValue({ goal: { id: 'goal_1', status: 'achieved' } });
    await runtime().resumeGoal({ goalId: 'goal_1' });
    expect(mocks.resume).not.toHaveBeenCalled();
    mocks.graph.mockResolvedValue({ goal: { id: 'goal_1', status: 'paused' } });
    mocks.resume.mockResolvedValue({ id: 'goal_1', status: 'review' });
    const result = await runtime().resumeGoal({ goalId: 'goal_1' });
    expect(result.state).toEqual({ goalId: 'goal_1', status: 'review' });
    expect(mocks.scheduleGoalAdvance).not.toHaveBeenCalled();
  });
});
