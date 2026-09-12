'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { useMemo } from 'react';
import { Outlet, useParams } from 'react-router';

import NavHeader from '@/features/NavHeader';
import { GroupProjectScopeContext } from '@/features/Projects/Layout/GroupProjectScope';
import ProjectListPage from '@/features/Projects/List';

import GroupPageBreadcrumb from './GroupPageBreadcrumb';

const styles = createStaticStyles(({ css, cssVar }) => ({
  pane: css`
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: ${cssVar.colorBgContainer};
    & > [data-project-sidebar] {
      width: 208px;
      height: 100%;
      flex-shrink: 0;
      border-inline-end: 0.5px solid ${cssVar.colorBorderSecondary};
    }
    @media (max-width: 767px) {
      flex-direction: column;
      & > [data-project-sidebar] {
        width: 100%;
        height: 192px;
        border-inline-end: 0;
        border-block-end: 0.5px solid ${cssVar.colorBorderSecondary};
      }
    }
  `,
}));

export default function GroupProjectsLayout() {
  const { gid = '', projectId } = useParams<{ gid: string; projectId?: string }>();
  const scope = useMemo(() => ({ groupId: gid, projectId }), [gid, projectId]);
  return (
    <GroupProjectScopeContext value={scope}>
      <Flexbox flex={1} height="100%" style={{ minWidth: 0, minHeight: 0 }}>
        <NavHeader left={<GroupPageBreadcrumb groupId={gid} title="项目" />} />
        <Flexbox horizontal className={styles.pane} data-group-projects="" flex={1} height="100%">
          <Outlet />
        </Flexbox>
      </Flexbox>
    </GroupProjectScopeContext>
  );
}

export function GroupProjectsEntry() {
  return <ProjectListPage />;
}
