import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { collectGroupWorkEntries, getGroupWorkPanelBounds } from './groupWorkEntries';

const message = (fields: Partial<UIChatMessage>) =>
  ({ content: '', createdAt: 0, updatedAt: 0, ...fields }) as UIChatMessage;

describe('group work panel entries', () => {
  it('includes compressed history recursively without duplicating records', () => {
    const task = message({ id: 'archived-task', role: 'task' });
    const wrapper = message({ id: 'history', role: 'compressedGroup', compressedMessages: [task] });
    expect(collectGroupWorkEntries([wrapper]).tasks).toEqual([task]);
    expect(collectGroupWorkEntries([wrapper, task]).tasks.map((entry) => entry.id)).toEqual([
      'archived-task',
    ]);
  });
  it('keeps ordinary conversation out, but includes pending goals and real group tasks', () => {
    const goal = message({
      id: 'plan',
      role: 'supervisor',
      children: [
        {
          id: 'block',
          content: '分工方案',
          tools: [
            {
              id: 'call',
              identifier: 'lobe-goal',
              apiName: 'createGoal',
              type: 'builtin',
              arguments: '{}',
              intervention: { status: 'pending' },
              result_msg_id: 'tool',
            },
          ],
        },
      ],
    });
    const task = message({
      id: 'tasks',
      role: 'groupTasks',
      tasks: [message({ id: 'task-1', role: 'task' })],
    });
    const result = collectGroupWorkEntries([
      message({ id: 'chat', role: 'user', content: '目标是什么' }),
      goal,
      task,
    ]);
    expect(result.goals.map((entry) => entry.id)).toEqual(['plan']);
    expect(result.tasks.map((entry) => entry.id)).toEqual(['tasks']);
  });

  it('recognizes single-agent task proposals without treating conversation speech as a task', () => {
    const makeTool = (apiName: string) =>
      message({
        id: apiName,
        role: 'tool',
        plugin: {
          apiName,
          identifier: 'lobe-group-management',
          type: 'builtin',
          arguments: '{}',
        },
      });
    expect(
      collectGroupWorkEntries([makeTool('speak'), makeTool('executeAgentTask')]).tasks.map(
        (entry) => entry.id,
      ),
    ).toEqual(['executeAgentTask']);
  });

  it('deduplicates messages classified by both their task role and tool call', () => {
    const task = message({
      id: 'task',
      role: 'task',
      plugin: {
        apiName: 'executeAgentTask',
        identifier: 'lobe-group-management',
        type: 'builtin',
      },
    });
    expect(collectGroupWorkEntries([task]).tasks).toHaveLength(1);
    expect(collectGroupWorkEntries([])).toEqual({ goals: [], tasks: [] });
  });
});

describe('group work panel geometry', () => {
  it('uses two thirds of the chat body in both axes, centered above the entry', () => {
    expect(getGroupWorkPanelBounds({ left: 300, top: 100, width: 1200, height: 900 }, 800)).toEqual(
      { left: 500, top: 192, width: 800, height: 600 },
    );
  });
  it('stays inside a short chat body when the composer occupies most of its height', () => {
    expect(getGroupWorkPanelBounds({ left: 0, top: 50, width: 360, height: 300 }, 200)).toEqual({
      left: 60,
      top: 50,
      width: 240,
      height: 142,
    });
  });
});
