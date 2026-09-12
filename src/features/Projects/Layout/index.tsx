'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, use } from 'react';
import { Outlet } from 'react-router';

import ProjectDisabled from '@/features/Projects/ProjectDisabled';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { GroupProjectScopeContext } from './GroupProjectScope';
import ProjectToolbar from './ProjectToolbar';
import ProjectSidebar from './Sidebar';

const ProjectLayout = memo(() => {
  const enabled = useUserStore(labPreferSelectors.enableProjects);
  const groupScope = use(GroupProjectScopeContext);

  if (!enabled && !groupScope) return <ProjectDisabled />;

  return (
    <>
      {!groupScope && <ProjectSidebar />}
      <Flexbox flex={1} height="100%" style={{ minWidth: 0, minHeight: 0 }}>
        {groupScope && <ProjectToolbar />}
        <Outlet />
      </Flexbox>
    </>
  );
});

ProjectLayout.displayName = 'ProjectLayout';

export default ProjectLayout;
