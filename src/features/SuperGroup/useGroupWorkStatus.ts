import pMap from 'p-map';

import { buildGoalGraphView } from '@/features/AgentGoals/ProcessControl/goalGraphViewModel';
import { useClientPollingSWR } from '@/libs/swr';
import { goalService } from '@/services/goal';
import { taskService } from '@/services/task';

import type { GroupWorkStatusItem } from './GroupWorkEntry';

const taskLabels: Record<string, string> = {
  backlog: '待开始',
  failed: '执行失败',
  paused: '已暂停',
  running: '等待执行',
  scheduled: '等待计划',
};
const goalLabels: Record<string, string> = {
  planning: '规划中',
  running: '等待执行',
  verifying: '等待验收',
  review: '等待确认',
  paused: '已暂停',
  failed: '执行失败',
};

/** Server-scoped lists, never the current topic's truncated message window. */
export async function loadGroupWorkStatus(groupId: string): Promise<GroupWorkStatusItem[]> {
  const goals: Awaited<ReturnType<typeof goalService.list>>['goals'] = [];
  const tasks: Awaited<ReturnType<typeof taskService.list>>['data'] = [];
  await Promise.all([
    (async () => {
      while (true) {
        const page = await goalService.list({
          groupId,
          limit: 100,
          offset: goals.length,
          statuses: ['planning', 'running', 'verifying', 'review', 'paused', 'failed'],
        });
        goals.push(...page.goals);
        if (!page.goals.length || goals.length >= page.total) break;
      }
    })(),
    (async () => {
      while (true) {
        const page = await taskService.list({
          groupId,
          limit: 100,
          offset: tasks.length,
          statuses: ['backlog', 'running', 'paused', 'scheduled', 'failed'],
        });
        tasks.push(...page.data);
        if (!page.data.length || tasks.length >= page.total) break;
      }
    })(),
  ]);
  const names = new Map(
    tasks.flatMap((task) => task.participants.map((p) => [p.id, p.title] as const)),
  );
  const goalItems = await pMap(
    goals,
    async ({ goal, pendingDecisions }): Promise<GroupWorkStatusItem> => {
      let isRunning = false;
      let rawStatus = goal.status;
      let status =
        pendingDecisions && goal.status !== 'paused'
          ? '等待确认'
          : goalLabels[goal.status] || goal.status;
      if (!pendingDecisions && ['running', 'verifying'].includes(goal.status)) {
        try {
          const graph = await goalService.getGraph(goal.id);
          rawStatus = graph.goal.status;
          const view = buildGoalGraphView(graph);
          isRunning =
            ['running', 'verifying'].includes(graph.goal.status) &&
            view.frontier.some(
              (item) => item.kind === 'running' && !!graph.runHeartbeats?.[item.view.node.id],
            );
          if (graph.goal.status === 'paused') {
            status = '已暂停';
          } else if (view.needsYou) {
            isRunning = false;
            status = '等待处理';
          } else if (isRunning) status = '执行中';
          else status = goalLabels[graph.goal.status] || graph.goal.status;
        } catch {
          status = '状态待更新';
        }
      }
      return {
        id: goal.id,
        rawStatus,
        agentId: goal.agentId || undefined,
        title: goal.title,
        kind: 'goals',
        assigneeLabel: names.get(goal.agentId || '') || '协调成员',
        status,
        isRunning,
      };
    },
    { concurrency: 4 },
  );
  const taskItems = await pMap(
    tasks,
    async (task): Promise<GroupWorkStatusItem> => {
      let isRunning = false;
      let rawStatus = task.status;
      let status = taskLabels[task.status] || task.status;
      if (task.status === 'running') {
        try {
          const { data } = await taskService.getDetail(task.id);
          rawStatus = data.status;
          const heartbeatFresh =
            !!data.heartbeat?.lastAt &&
            (data.heartbeat.timeout ?? 0) > 0 &&
            Date.now() - new Date(data.heartbeat.lastAt).getTime() <=
              (data.heartbeat.timeout ?? 0) * 1000;
          isRunning =
            data.status === 'running' &&
            heartbeatFresh &&
            !!data.activities?.some(
              (activity) =>
                activity.type === 'topic' &&
                activity.status === 'running' &&
                activity.id === task.currentTopicId &&
                !!activity.runningOperation,
            );
          status = isRunning ? '执行中' : taskLabels[data.status] || '等待执行';
        } catch {
          status = '状态待更新';
        }
      }
      return {
        id: task.id,
        rawStatus,
        agentId: task.assigneeAgentId || undefined,
        title: task.name || task.identifier,
        kind: 'tasks',
        assigneeLabel:
          task.participants
            .map((p) => p.title)
            .filter(Boolean)
            .join('、') || '待分配成员',
        status,
        isRunning,
      };
    },
    { concurrency: 4 },
  );
  return [...goalItems, ...taskItems];
}

export function useGroupWorkStatus(groupId: string) {
  return useClientPollingSWR<GroupWorkStatusItem[]>(
    groupId ? ['group-work-status', groupId] : null,
    () => loadGroupWorkStatus(groupId),
    {
      refreshInterval: 10_000,
      refreshWhenHidden: false,
      suspense: false,
      shouldRetryOnError: false,
    },
  );
}
