// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { BriefModel } from '@/database/models/brief';
import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { goalEdges, goalEvents, goalNodes, goals, tasks, users } from '@/database/schemas';

import { buildTaskPrompt } from './buildTaskPrompt';

const db = await getTestDB();
const userId = 'goal-work-prompt-test-user';

beforeEach(async () => {
  await db.insert(users).values({ id: userId }).onConflictDoNothing();
});

afterEach(async () => {
  await db.delete(goalEdges);
  await db.delete(goalEvents);
  await db.delete(goalNodes);
  await db.delete(goals);
  await db.delete(tasks);
  await db.delete(users);
});

describe('buildTaskPrompt Goal loop context', () => {
  it('includes resolved prerequisite findings but not unrelated sibling findings', async () => {
    const taskModel = new TaskModel(db, userId);
    const task = await taskModel.create({ instruction: 'Analyze collected data' });
    const goal = await new GoalModel(db, userId).create({ title: 'Research' });
    const graph = new GoalGraphModel(db, userId);
    const source = await graph.createNode(goal.id, {
      kind: 'task',
      title: 'Collect',
      status: 'resolved',
    });
    const target = await graph.createNode(goal.id, { kind: 'task', title: 'Analyze' });
    const finding = await graph.createNode(goal.id, {
      kind: 'finding',
      title: 'Collected evidence',
      description: 'Source sample: 17 real comments; 4 ask for routes.',
    });
    await graph.createNode(goal.id, {
      kind: 'finding',
      title: 'Unrelated finding',
      description: 'UNRELATED_SECRET',
    });
    await graph.bindTask(goal.id, target!.id, task.id);
    await graph.createEdge(goal.id, target!.id, source!.id, 'depends_on');
    await graph.createEdge(goal.id, source!.id, finding!.id, 'produces');
    const result = await buildTaskPrompt(task, {
      briefModel: new BriefModel(db, userId),
      db,
      taskModel,
      taskTopicModel: new TaskTopicModel(db, userId),
      userId,
    });
    expect(result.prompt).toContain('17 real comments');
    expect(result.prompt).not.toContain('UNRELATED_SECRET');
  });
  it('uses the per-Task attempt budget for a Goal Graph Task', async () => {
    const taskModel = new TaskModel(db, userId);
    const task = await taskModel.create({
      instruction: 'Close the remaining acceptance gap.',
    });
    await taskModel.update(task.id, { totalTopics: 1 });
    const goal = await new GoalModel(db, userId).create({
      config: { recovery: { maxAttemptsPerTask: 2 } },
      maxRounds: 20,
      subjectType: 'standalone',
      title: 'Graph-managed work budget',
    });
    const graphModel = new GoalGraphModel(db, userId);
    const taskNode = await graphModel.createNode(goal.id, {
      kind: 'task',
      title: 'Close acceptance gap',
    });
    await graphModel.bindTask(goal.id, taskNode!.id, task.id);
    const currentTask = await taskModel.findById(task.id);

    const result = await buildTaskPrompt(currentTask!, {
      briefModel: new BriefModel(db, userId),
      db,
      taskModel,
      taskTopicModel: new TaskTopicModel(db, userId),
      userId,
    });

    expect(result.prompt).toContain('Goal loop — round 2 of 2');
    expect(result.prompt).not.toContain('round 2 of 20');
  });
});
