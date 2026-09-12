import { agentDisplayName } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { Breadcrumb as AntBreadcrumb } from 'antd';
import { ChevronRight } from 'lucide-react';
import { memo, use } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useShallow } from 'zustand/react/shallow';

import GroupPageBreadcrumb from '@/features/SuperGroup/GroupPageBreadcrumb';
import { GroupWorkScopeContext } from '@/features/SuperGroup/GroupWorkScope';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useTaskStore } from '@/store/task';

import { styles } from './style';
import { taskDetailPath } from './taskDetailPath';
import { useAgentDisplayMeta } from './useAgentDisplayMeta';

interface BreadcrumbProps {
  agentId?: string;
  taskId?: string;
}

const Breadcrumb = memo<BreadcrumbProps>(({ taskId, agentId }) => {
  const { t } = useTranslation('chat');
  const groupScope = use(GroupWorkScopeContext);
  const { aid: routeAgentId } = useParams<{ aid?: string }>();
  const aid = agentId ?? routeAgentId;
  const agentMeta = useAgentDisplayMeta(aid);
  const taskTitle = useTaskStore((s) => (taskId ? s.taskDetailMap[taskId]?.name : undefined));
  const taskIdentifier = useTaskStore((s) =>
    taskId ? s.taskDetailMap[taskId]?.identifier : undefined,
  );
  const ancestors = useTaskStore(
    useShallow((s) => {
      if (!taskId) return [];
      const chain: Array<{ agentId?: string | null; identifier: string }> = [];
      const visited = new Set<string>([taskId]);
      let cursor = s.taskDetailMap[taskId]?.parent;
      while (cursor?.identifier && !visited.has(cursor.identifier)) {
        const detail = s.taskDetailMap[cursor.identifier];
        visited.add(cursor.identifier);
        chain.push({
          agentId: cursor.agentId === undefined ? detail?.agentId : cursor.agentId,
          identifier: cursor.identifier,
        });
        cursor = detail?.parent;
      }
      return chain.reverse();
    }),
  );

  if (groupScope)
    return (
      <GroupPageBreadcrumb
        groupId={groupScope.groupId}
        title="任务"
        detailTitle={taskId ? taskTitle || taskIdentifier || taskId : undefined}
      />
    );

  const allTasksLabel = (
    <Text color={'inherit'} weight={500}>
      {t('taskList.all')}
    </Text>
  );

  const agentCrumb =
    aid && agentMeta
      ? {
          key: `agent-${aid}`,
          title: (
            <Text
              ellipsis
              color={'inherit'}
              style={{ maxWidth: 160 }}
              type={taskId ? undefined : 'secondary'}
              weight={500}
            >
              {agentDisplayName(agentMeta)}
            </Text>
          ),
        }
      : undefined;

  // The agent crumb links to its task list only when it is not the current page
  // (i.e. when a deeper task crumb follows it).
  const agentCrumbNode =
    agentCrumb && taskId
      ? {
          ...agentCrumb,
          title: <WorkspaceLink to={`/agent/${aid}/tasks`}>{agentCrumb.title}</WorkspaceLink>,
        }
      : agentCrumb;

  const ancestorCrumbs = ancestors.map(({ identifier, agentId }) => ({
    key: identifier,
    title: (
      <WorkspaceLink to={taskDetailPath(identifier, agentId ?? undefined)}>
        <Text color={'inherit'} weight={500}>
          {identifier}
        </Text>
      </WorkspaceLink>
    ),
  }));

  const currentTaskCrumb = taskId
    ? {
        title: (
          <span
            style={{
              alignItems: 'center',
              display: 'inline-flex',
              gap: 6,
              maxWidth: '100%',
              minWidth: 0,
            }}
          >
            {taskIdentifier && (
              <Text
                as={'span'}
                color={'inherit'}
                style={{ flexShrink: 0 }}
                type={'secondary'}
                weight={500}
              >
                {taskIdentifier}
              </Text>
            )}
            <Text
              ellipsis
              as={'span'}
              color={'inherit'}
              style={{ flex: '1 1 auto', maxWidth: 240, minWidth: 0 }}
              weight={500}
            >
              {taskTitle || taskId}
            </Text>
          </span>
        ),
      }
    : undefined;

  return (
    <AntBreadcrumb
      className={styles.breadcrumb}
      separator={<Icon icon={ChevronRight} />}
      items={[
        {
          title:
            taskId || agentCrumbNode ? (
              <WorkspaceLink to={'/tasks'}>{allTasksLabel}</WorkspaceLink>
            ) : (
              allTasksLabel
            ),
        },
        ...(agentCrumbNode ? [agentCrumbNode] : []),
        ...ancestorCrumbs,
        ...(currentTaskCrumb ? [currentTaskCrumb] : []),
      ]}
    />
  );
});

export default Breadcrumb;
