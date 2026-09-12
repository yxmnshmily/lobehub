// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { TaskModel } from '@/database/models/task';
import { agents, chatGroups, chatGroupsAgents, users, workspaces } from '@/database/schemas';
import { AiAgentService } from '@/server/services/aiAgent';
import { getPlatformManagedExecutionContext } from '@/server/services/aiAgent/platformManagedExecution';
import { TaskService } from '@/server/services/task';

import { resolveGroupExecution } from './groupExecution';
import { TaskRunnerService } from './index';

const db = await getTestDB();
beforeEach(async () => {
  await db.insert(users).values([{ id: 'group-owner' }, { id: 'outsider' }]);
  await db.insert(agents).values([
    { id: 'agt_supervisor', userId: 'group-owner', title: 'Coordinator' },
    { id: 'agt_writer', userId: 'group-owner', title: 'Writer', description: 'Travel copywriting' },
    { id: 'agt_nonmember', userId: 'group-owner' },
  ]);
  await db.insert(chatGroups).values({ id: 'cg_work', userId: 'group-owner' });
  await db.insert(chatGroupsAgents).values([
    {
      chatGroupId: 'cg_work',
      agentId: 'agt_supervisor',
      userId: 'group-owner',
      role: 'supervisor',
    },
    { chatGroupId: 'cg_work', agentId: 'agt_writer', userId: 'group-owner', role: 'participant' },
  ]);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete(chatGroupsAgents);
  await db.delete(chatGroups);
  await db.delete(agents);
  await db.delete(workspaces);
  await db.delete(users);
});

describe('group task execution boundary', () => {
  it.each([
    ['cg_work', 'group-owner', 'group-owner'],
    ['cg_foreign', 'group-owner', 'group-owner'],
    ['cg_work', 'outsider', 'group-owner'],
    ['cg_work', 'group-owner', 'outsider'],
  ])(
    'only inherits an approved budget for the same group and principal: %s %s %s',
    async (sourceGroupId, actorUserId, resourceOwnerUserId) => {
      const execute = vi
        .spyOn(AiAgentService.prototype, 'execAgent')
        .mockResolvedValue({ operationId: 'op-test' } as never);
      const task = await new TaskModel(db, 'group-owner').create({
        assigneeAgentId: 'agt_writer',
        config: { groupId: 'cg_work', model: 'test', provider: 'test' },
        instruction: 'Write',
      });
      const sharedBudget = {} as any;
      const execution = new TaskRunnerService(db, 'group-owner').runTask({
        taskId: task.id,
        executionContext: {
          groupId: sourceGroupId,
          capability: {
            actorUserId,
            resourceOwnerUserId,
            sharedBudget,
          },
        },
      });
      if (
        sourceGroupId !== 'cg_work' ||
        actorUserId !== 'group-owner' ||
        resourceOwnerUserId !== 'group-owner'
      ) {
        await expect(execution).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(execute).not.toHaveBeenCalled();
        expect((await new TaskModel(db, 'group-owner').findById(task.id))?.status).toBe('backlog');
        return;
      }
      await execution;
      expect(getPlatformManagedExecutionContext(execute.mock.calls[0][0])?.sharedBudget).toBe(
        sharedBudget,
      );
    },
  );
  it('hides private-group work from workspace peers even through unfiltered lists and graph reads', async () => {
    await db
      .insert(workspaces)
      .values({ id: 'ws_team', slug: 'team', name: 'Team', primaryOwnerId: 'group-owner' });
    await db.insert(chatGroups).values({
      id: 'cg_private',
      userId: 'group-owner',
      workspaceId: 'ws_team',
      visibility: 'private',
    });
    const goal = await new GoalModel(db, 'group-owner', 'ws_team').create({
      title: 'Private group goal',
      config: { groupId: 'cg_private' },
    });
    await new GoalGraphModel(db, 'group-owner', 'ws_team').createNode(goal.id, {
      title: 'Private details',
      kind: 'problem',
    });
    const task = await new TaskModel(db, 'group-owner', 'ws_team').create({
      instruction: 'Private group task',
      config: { groupId: 'cg_private' },
    });
    expect(await new GoalModel(db, 'outsider', 'ws_team').findById(goal.id)).toBeUndefined();
    expect(await new GoalGraphModel(db, 'outsider', 'ws_team').getGraph(goal.id)).toBeUndefined();
    expect((await new GoalModel(db, 'outsider', 'ws_team').list()).total).toBe(0);
    expect(await new TaskModel(db, 'outsider', 'ws_team').findById(task.id)).toBeNull();
    expect((await new TaskModel(db, 'outsider', 'ws_team').list()).total).toBe(0);
    expect(await new TaskModel(db, 'group-owner', 'ws_team').findById(task.id)).toBeDefined();
  });
  it('rejects out-of-group assignment at task creation', async () => {
    await expect(
      new TaskService(db, 'group-owner').createTask({
        assigneeAgentId: 'agt_nonmember',
        config: { groupId: 'cg_work' },
        instruction: 'Write',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('executes through the selected member with durable group context', async () => {
    const execute = vi
      .spyOn(AiAgentService.prototype, 'execAgent')
      .mockResolvedValue({ operationId: 'op-test' } as never);
    const task = await new TaskModel(db, 'group-owner').create({
      assigneeAgentId: 'agt_writer',
      config: { groupId: 'cg_work', model: 'test', provider: 'test' },
      instruction: 'Write',
    });
    await new TaskRunnerService(db, 'group-owner').runTask({ taskId: task.id });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agt_writer',
        appContext: { groupId: 'cg_work', taskId: task.id },
        taskId: task.id,
      }),
    );
  });
  it('preserves the selected group member instead of replacing it with the supervisor', async () => {
    expect(
      await resolveGroupExecution(
        db,
        'group-owner',
        undefined,
        { groupId: 'cg_work' },
        'agt_writer',
      ),
    ).toMatchObject({
      groupId: 'cg_work',
      agentId: 'agt_writer',
      supervisorAgentId: 'agt_supervisor',
    });
  });
  it('defaults an unassigned group task to its coordinator, never the private inbox', async () => {
    expect(
      await resolveGroupExecution(db, 'group-owner', undefined, { groupId: 'cg_work' }),
    ).toMatchObject({ agentId: 'agt_supervisor' });
  });
  it('rejects an agent outside the group even if the caller owns it', async () => {
    await expect(
      resolveGroupExecution(db, 'group-owner', undefined, { groupId: 'cg_work' }, 'agt_nonmember'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('does not expose another user’s group roster', async () => {
    await expect(
      resolveGroupExecution(db, 'outsider', undefined, { groupId: 'cg_work' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('leaves personal tasks unchanged and rejects malformed group claims', async () => {
    expect(await resolveGroupExecution(db, 'group-owner', undefined, {})).toBeUndefined();
    await expect(
      resolveGroupExecution(db, 'group-owner', undefined, { groupId: 42 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
