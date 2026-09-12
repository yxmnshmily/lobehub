import { lazy, Suspense } from 'react';

import NotFound from '@/components/404';
import AsyncError from '@/components/AsyncError';
import GoalDetailSkeleton from '@/components/Skeleton/GoalDetail';
import { useClientDataSWR } from '@/libs/swr';
import { goalService } from '@/services/goal';
import { taskService } from '@/services/task';

import type { GroupWorkKind } from './groupWorkEntries';
import { belongsToWorkGroup } from './GroupWorkScope';

const GoalDetailPage = lazy(() => import('@/features/AgentGoals/GoalDetailPage'));
const TaskDetailPage = lazy(
  () => import('@/features/AgentTasks/AgentTaskDetail/AgentScopedTaskDetailPage'),
);

/** Check the record's actual group, not its executor (one member can work for many groups). */
export default function GroupWorkDetail({
  agentId,
  groupId,
  id,
  kind,
}: {
  agentId: string;
  groupId: string;
  id: string;
  kind: GroupWorkKind;
}) {
  const { data, error, mutate } = useClientDataSWR(
    ['group-work-detail-scope', groupId, kind, id],
    async () => {
      const record =
        kind === 'goals'
          ? (await goalService.getGraph(id)).goal
          : (await taskService.getDetail(id)).data;
      return { belongs: belongsToWorkGroup(record?.config, groupId), agentId: record?.agentId };
    },
  );
  if (error) return <AsyncError error={error} variant="page" onRetry={() => void mutate()} />;
  if (!data) return <GoalDetailSkeleton />;
  if (!data.belongs) return <NotFound title="未找到该群的目标或任务" />;
  return (
    <Suspense fallback={<GoalDetailSkeleton />}>
      {kind === 'goals' ? (
        <GoalDetailPage agentId={data.agentId ?? agentId} goalId={id} />
      ) : (
        <TaskDetailPage agentId={data.agentId ?? agentId} taskId={id} />
      )}
    </Suspense>
  );
}
