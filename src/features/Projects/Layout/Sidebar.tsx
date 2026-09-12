'use client';

import { Flexbox } from '@lobehub/ui';
import { ClipboardCheckIcon, ListTodoIcon, MessageSquareIcon, TargetIcon } from 'lucide-react';
import { memo, use } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import AsyncError from '@/components/AsyncError';
import NavItem from '@/features/NavPanel/components/NavItem';
import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useCurrentProjectDetail, useProjectStore } from '@/store/project';

import { GroupProjectScopeContext, scopeProjectPath } from './GroupProjectScope';
import {
  getProjectAcceptancePath,
  getProjectConversationPath,
  getProjectGoalsPath,
  getProjectTasksPath,
} from './navigation';
import ProjectHeader from './ProjectHeader';

const ProjectSidebarContent = memo(() => {
  const { t } = useTranslation('project');
  const { projectId } = useActiveRouteParams<{ projectId: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const { pathname } = useLocation();
  const groupScope = use(GroupProjectScopeContext);
  const detail = useCurrentProjectDetail(projectId);
  const detailSWR = useProjectStore((s) => s.useFetchProjectDetail)(projectId);
  const projectTasksPath = scopeProjectPath(getProjectTasksPath(projectId!), groupScope);
  const conversationPath = scopeProjectPath(getProjectConversationPath(projectId!), groupScope);
  const projectGoalsPath = scopeProjectPath(getProjectGoalsPath(projectId!), groupScope);
  const projectAcceptancePath = scopeProjectPath(getProjectAcceptancePath(projectId!), groupScope);

  const header = <ProjectHeader project={detail?.project} />;

  if (detailSWR.error)
    return (
      <SideBarLayout
        body={<AsyncError error={detailSWR.error} variant="inline" onRetry={detailSWR.mutate} />}
        header={header}
      />
    );

  return (
    <SideBarLayout
      header={header}
      body={
        <Flexbox gap={8} paddingInline={4}>
          <NavItem
            active={pathname.startsWith(conversationPath)}
            icon={MessageSquareIcon}
            title="项目对话"
            onClick={() => navigate(conversationPath)}
          />
          <NavItem
            active={pathname === projectTasksPath}
            icon={ListTodoIcon}
            title={t('sections.tasks')}
            onClick={() => navigate(projectTasksPath)}
          />
          <NavItem
            active={pathname === projectGoalsPath}
            icon={TargetIcon}
            title={t('sections.goals')}
            onClick={() => navigate(projectGoalsPath)}
          />
          <NavItem
            active={pathname === projectAcceptancePath}
            icon={ClipboardCheckIcon}
            title={t('sections.acceptance')}
            onClick={() => navigate(projectAcceptancePath)}
          />
        </Flexbox>
      }
    />
  );
});

const ProjectSidebar = memo(() => {
  const groupScope = use(GroupProjectScopeContext);
  if (groupScope)
    return (
      <Flexbox data-project-sidebar="" style={{ minHeight: 0 }}>
        <ProjectSidebarContent />
      </Flexbox>
    );
  return (
    <NavPanelPortal navKey="project">
      <ProjectSidebarContent />
    </NavPanelPortal>
  );
});

ProjectSidebar.displayName = 'ProjectSidebar';

export default ProjectSidebar;
