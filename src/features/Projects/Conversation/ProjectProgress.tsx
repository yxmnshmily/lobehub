'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRight } from 'lucide-react';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { ProjectDetail } from '@/store/project';

const styles = createStaticStyles(({ css }) => ({
  panel: css`
    overflow: auto;
    min-height: 0;
    min-width: 0;
    padding: 16px;
    border-inline-start: 0.5px solid ${cssVar.colorBorderSecondary};
    background: ${cssVar.colorBgContainer};
    @container project-conversation (max-width: 840px) {
      flex-shrink: 0;
      max-height: 160px;
      border-inline-start: 0;
      border-block-end: 0.5px solid ${cssVar.colorBorderSecondary};
    }
  `,
  row: css`
    width: 100%;
    height: auto;
    min-height: 56px;
    padding: 8px;
    gap: 8px;
    justify-content: space-between;
    border-radius: 0;
    border-block-end: 0.5px solid ${cssVar.colorBorderSecondary};
    text-align: start;
    white-space: normal;
  `,
  history: css`
    margin-top: 12px;
    > summary {
      cursor: pointer;
      padding: 8px;
      font-size: 12px;
      color: ${cssVar.colorTextSecondary};
    }
  `,
}));

const statusLabels: Record<string, string> = {
  backlog: '待开始',
  running: '进行中',
  scheduled: '已安排',
  paused: '已暂停',
  failed: '执行失败',
  completed: '已完成',
  canceled: '已取消',
};

export default function ProjectProgress({
  detail,
  stale = false,
}: {
  detail: ProjectDetail;
  stale?: boolean;
}) {
  const navigate = useWorkspaceAwareNavigate();
  const tasks = detail.tasks ?? [];
  const activeTasks = tasks.filter((task) => task.status !== 'canceled');
  const completed = activeTasks.filter((task) => task.status === 'completed').length;
  const projectPath = `/project/${detail.project.slug ?? detail.project.id}`;
  const finishedTasks = tasks.filter((task) => ['completed', 'canceled'].includes(task.status));
  const pendingTasks = tasks.filter((task) => !['completed', 'canceled'].includes(task.status));
  const renderTask = (task: (typeof tasks)[number]) => {
    const assignee = detail.agents?.find(({ agent }) => agent.id === task.assigneeAgentId)?.agent;
    return (
      <Button
        className={styles.row}
        key={task.id}
        type="text"
        onClick={() => navigate(`/task/${task.identifier}`)}
      >
        <Flexbox
          flex={1}
          gap={4}
          style={{ minWidth: 0, alignItems: 'stretch', textAlign: 'start' }}
        >
          <Text style={{ overflowWrap: 'anywhere' }} title={task.name || task.instruction}>
            {task.name || task.instruction}
          </Text>
          <Flexbox horizontal gap={8} wrap="wrap">
            <Text fontSize={12} type={task.status === 'failed' ? 'danger' : 'secondary'}>
              {statusLabels[task.status] ?? task.status}
            </Text>
            <Text ellipsis fontSize={12} type="secondary">
              {assignee?.title || (task.assigneeAgentId ? '已分配成员' : '未分配成员')}
            </Text>
          </Flexbox>
        </Flexbox>
        <ChevronRight aria-hidden size={14} style={{ flexShrink: 0 }} />
      </Button>
    );
  };
  return (
    <aside aria-label="项目进度" className={styles.panel}>
      <Flexbox gap={8} style={{ paddingBottom: 8 }}>
        <Flexbox horizontal align="center" gap={8} justify="space-between" wrap="wrap">
          <Text weight={600}>任务进度</Text>
          {tasks.length > 0 && (
            <Text fontSize={12} type="secondary">
              已完成 {completed} / {activeTasks.length}
            </Text>
          )}
        </Flexbox>
        {stale && (
          <Text fontSize={12} role="status" type="danger">
            进度更新失败，当前显示上次记录，稍后自动重试。
          </Text>
        )}
        {tasks.length === 0 && (
          <Text fontSize={12} type="secondary">
            还没有任务记录
          </Text>
        )}
      </Flexbox>
      {pendingTasks.map(renderTask)}
      {finishedTasks.length > 0 && (
        <details className={styles.history} key={detail.project.id}>
          <summary>已结束（{finishedTasks.length}）</summary>
          {finishedTasks.map(renderTask)}
        </details>
      )}
      <Button
        style={{ marginTop: 12 }}
        type="text"
        onClick={() => navigate(`${projectPath}/acceptance`)}
      >
        查看交付与验收
      </Button>
    </aside>
  );
}
