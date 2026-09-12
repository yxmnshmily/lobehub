'use client';

import { Flexbox } from '@lobehub/ui';
import { Alert, Button, Text } from '@lobehub/ui/base-ui';
import { lazy, Suspense, useMemo } from 'react';
import { useParams } from 'react-router';
import { SWRConfig } from 'swr';

import { lambdaQuery } from '@/libs/trpc/client';

import type { GroupWorkKind } from './groupWorkEntries';
import { GroupWorkScopeContext } from './GroupWorkScope';

const AgentGoalsPage = lazy(() => import('@/features/AgentGoals/AgentGoalsPage'));
const AgentTasksPage = lazy(() => import('@/features/AgentTasks/AgentTaskList/AgentTasksPage'));
const GroupWorkDetail = lazy(() => import('./GroupWorkDetail'));

/** Reuse the original pages, including their creation forms and data scoping. */
export default function GroupWorkPage({
  kind,
  detail,
  groupId,
}: {
  kind: GroupWorkKind;
  detail?: { id: string };
  groupId?: string;
}) {
  const params = useParams<{ gid: string; goalId?: string; taskId?: string }>();
  const gid = groupId ?? params.gid;
  const detailId = detail?.id ?? (kind === 'goals' ? params.goalId : params.taskId);
  const scope = useMemo(() => ({ groupId: gid ?? '' }), [gid]);
  // Joined conversations intentionally have no agent id. Resolve the current
  // group's supervisor without changing their hosted chat transport context.
  const participants = lambdaQuery.groupMembership.listParticipants.useQuery(
    { groupId: gid ?? '' },
    { enabled: !!gid, retry: false },
  );
  const agentId = participants.data?.assistants.find((agent) => agent.isSupervisor)?.id;
  if (participants.isError || !agentId) {
    return (
      <Flexbox padding={24} width="100%">
        {gid && participants.isLoading && !participants.isError ? (
          <Text role="status">正在加载群成员…</Text>
        ) : (
          <Alert
            showIcon
            title={
              participants.isError ? '群成员加载失败，请重试' : '当前群未找到主管，请检查群成员配置'
            }
            type="error"
            action={<Button onClick={() => void participants.refetch()}>重试</Button>}
          />
        )}
      </Flexbox>
    );
  }
  return (
    <GroupWorkScopeContext value={scope}>
      <SWRConfig value={{ suspense: false }}>
        <Suspense fallback="正在加载…">
          {detailId ? (
            <GroupWorkDetail agentId={agentId} groupId={gid!} id={detailId} kind={kind} />
          ) : kind === 'goals' ? (
            <AgentGoalsPage agentId={agentId} groupId={gid} />
          ) : (
            <AgentTasksPage agentId={agentId} groupId={gid} />
          )}
        </Suspense>
      </SWRConfig>
    </GroupWorkScopeContext>
  );
}
