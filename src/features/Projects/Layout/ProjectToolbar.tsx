'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, DropdownMenu } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { ClipboardCheck, FolderOpen, ListTodo, MoreHorizontal, Target } from 'lucide-react';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useCurrentProjectDetail } from '@/store/project';

import ProjectHeader from './ProjectHeader';

export default function ProjectToolbar() {
  const { projectId } = useActiveRouteParams<{ projectId: string }>();
  const detail = useCurrentProjectDetail(projectId);
  const navigate = useWorkspaceAwareNavigate();
  const root = `/project/${projectId}`;
  return (
    <Flexbox
      horizontal
      align="center"
      gap={8}
      justify="space-between"
      paddingInline={16}
      style={{
        flexShrink: 0,
        minHeight: 56,
        borderBottom: `0.5px solid ${cssVar.colorBorderSecondary}`,
      }}
    >
      <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
        <div style={{ width: 200, minWidth: 0 }}>
          <ProjectHeader project={detail?.project} />
        </div>
        <Button
          size="small"
          style={{ flexShrink: 0 }}
          type="text"
          onClick={() => navigate(`${root}/conversation`)}
        >
          项目对话
        </Button>
      </Flexbox>
      <Flexbox horizontal align="center" gap={4} style={{ flexShrink: 0 }}>
        <DropdownMenu
          items={[
            {
              key: 'projects',
              icon: FolderOpen,
              label: '全部项目',
              onClick: () => navigate('/projects'),
            },
            {
              key: 'tasks',
              icon: ListTodo,
              label: '管理任务',
              onClick: () => navigate(`${root}/tasks`),
            },
            {
              key: 'goals',
              icon: Target,
              label: '查看目标',
              onClick: () => navigate(`${root}/goals`),
            },
            {
              key: 'acceptance',
              icon: ClipboardCheck,
              label: '交付与验收',
              onClick: () => navigate(`${root}/acceptance`),
            },
          ]}
        >
          <Button aria-label="更多项目操作" icon={MoreHorizontal} size="small" type="text" />
        </DropdownMenu>
      </Flexbox>
    </Flexbox>
  );
}
