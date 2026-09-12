import type { TaskDetailActivity } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { goalService } from '@/services/goal';
import { taskService } from '@/services/task';

import { loadGroupWorkStatus } from './useGroupWorkStatus';

vi.mock('@/services/goal', () => ({ goalService: { list: vi.fn(), getGraph: vi.fn() } }));
vi.mock('@/services/task', () => ({ taskService: { list: vi.fn(), getDetail: vi.fn() } }));

describe('group work status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(goalService.list).mockResolvedValue({ goals: [], total: 0 });
  });

  it('requires a live run activity, not just a running task flag, and preserves all pages', async () => {
    const task = (id: string, status = 'running') => ({
      id,
      name: id,
      status,
      assigneeAgentId: 'researcher',
      currentTopicId: `topic-${id}`,
      participants: [{ id: 'researcher', title: '研究成员', type: 'agent' }],
    });
    vi.mocked(taskService.list)
      .mockResolvedValueOnce({
        data: [task('live'), task('stale')],
        total: 3,
        success: true,
      } as any)
      .mockResolvedValueOnce({ data: [task('paused', 'paused')], total: 3, success: true } as any);
    vi.mocked(taskService.getDetail).mockImplementation(
      async (id) =>
        ({
          success: true,
          data: {
            status: 'running',
            heartbeat: { lastAt: new Date().toISOString(), timeout: 60 },
            activities: [
              {
                type: 'topic',
                id: `topic-${id}`,
                status: 'running',
                runningOperation:
                  id === 'live' ? { operationId: 'op', assistantMessageId: 'message' } : null,
              } satisfies TaskDetailActivity,
            ],
          },
        }) as any,
    );
    const items = await loadGroupWorkStatus('group-a');
    expect(items).toEqual([
      expect.objectContaining({
        id: 'live',
        isRunning: true,
        status: '执行中',
        assigneeLabel: '研究成员',
      }),
      expect.objectContaining({ id: 'stale', isRunning: false, status: '等待执行' }),
      expect.objectContaining({ id: 'paused', isRunning: false, status: '已暂停' }),
    ]);
    expect(taskService.list).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ groupId: 'group-a', offset: 2 }),
    );
    expect(goalService.list).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'group-a' }));
  });

  it('requires a fresh heartbeat and caps detail requests at four', async () => {
    vi.mocked(taskService.list).mockResolvedValue({
      data: Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        name: String(i),
        status: 'running',
        currentTopicId: String(i),
        participants: [],
      })),
      total: 10,
      success: true,
    } as any);
    let active = 0;
    let peak = 0;
    vi.mocked(taskService.getDetail).mockImplementation(async (id) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return {
        success: true,
        data: {
          status: 'running',
          heartbeat:
            id === '0'
              ? undefined
              : { lastAt: new Date(Date.now() - 120_000).toISOString(), timeout: 60 },
          activities: [
            {
              type: 'topic',
              id,
              status: 'running',
              runningOperation: { operationId: 'op', assistantMessageId: 'message' },
            } satisfies TaskDetailActivity,
          ],
        },
      } as any;
    });
    const items = await loadGroupWorkStatus('group-a');
    expect(peak).toBeLessThanOrEqual(4);
    expect(items.every((item) => !item.isRunning)).toBe(true);
  });

  it('does not turn a goal waiting for a decision into an active spinner', async () => {
    vi.mocked(goalService.list).mockResolvedValue({
      goals: [
        {
          goal: { id: 'goal-a', agentId: 'supervisor', title: '账号策划', status: 'running' },
          pendingDecisions: 1,
        },
      ],
      total: 1,
    } as any);
    vi.mocked(taskService.list).mockResolvedValue({ data: [], total: 0, success: true });
    const items = await loadGroupWorkStatus('group-a');
    expect(items).toEqual([
      expect.objectContaining({ id: 'goal-a', isRunning: false, status: '等待确认' }),
    ]);
  });

  it.each([false, true])(
    'uses the goal operation heartbeat as execution evidence: %s',
    async (live) => {
      const now = new Date();
      const goal = { id: 'goal-a', agentId: 'supervisor', title: '账号策划', status: 'running' };
      vi.mocked(goalService.list).mockResolvedValue({
        goals: [{ goal, pendingDecisions: 0 }],
        total: 1,
      } as any);
      vi.mocked(taskService.list).mockResolvedValue({ data: [], total: 0, success: true });
      vi.mocked(goalService.getGraph).mockResolvedValue({
        goal,
        nodes: [{ id: 'node-a', kind: 'task', status: 'active', updatedAt: now, priority: 0 }],
        decisions: [],
        edges: [],
        events: [],
        workVersions: [],
        runHeartbeats: live ? { 'node-a': now } : {},
      } as any);
      const items = await loadGroupWorkStatus('group-a');
      expect(items[0]).toMatchObject({ isRunning: live, status: live ? '执行中' : '等待执行' });
    },
  );
});
