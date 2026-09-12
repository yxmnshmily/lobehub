import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AppsSidebar from '@/features/Apps/Sidebar';

import Content from './Content';
import TaskSidebarContent from './TaskSidebarContent';

const state = vi.hoisted(() => ({
  expanded: true,
  groupId: 'my-home-group' as string | undefined,
  workspace: null as string | null,
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => state.workspace,
}));
vi.mock('@/hooks/useMyTravelGroupReadiness', () => ({
  useMyTravelGroupReadiness: () => ({ groupId: state.groupId }),
}));
vi.mock('@/store/global', () => ({ useGlobalStore: () => state.expanded }));
vi.mock('@/store/global/selectors', () => ({ systemStatusSelectors: { showLeftPanel: vi.fn() } }));
vi.mock('@/features/NavPanel/NavPanelPortal', () => ({
  NavPanelPortal: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/features/NavPanel/SideBarLayout', () => ({
  default: ({ body, header }: { body: ReactNode; header?: ReactNode }) => (
    <>
      {header}
      {body}
    </>
  ),
}));
vi.mock('@/features/SuperGroup/JoinedGroupSidebar', () => ({
  SuperGroupSidebarBody: ({
    groupId,
    manageDefaultGroup,
  }: {
    groupId: string;
    manageDefaultGroup: boolean;
  }) => <div data-manage-default={manageDefaultGroup}>首页群：{groupId}</div>,
}));
vi.mock('@/features/SuperGroup/GroupSwitcher', () => ({
  default: ({ compact }: { compact: boolean }) => <div>群列表：{compact ? '收起' : '展开'}</div>,
}));
vi.mock('./Body', () => ({ default: () => <div>工作区专用栏目</div> }));
vi.mock('./Header', () => ({ default: () => <div>工作区导航</div> }));
vi.mock('./Body/Agent/ModalProvider', () => ({
  AgentModalProvider: ({ children }: { children: ReactNode }) => children,
}));

describe('shared home sidebar', () => {
  beforeEach(() => {
    state.expanded = true;
    state.groupId = 'my-home-group';
    state.workspace = null;
  });

  it.each([
    ['default pages', Content],
    ['tasks and statistics', TaskSidebarContent],
    ['apps', AppsSidebar],
  ])('uses the account home group and its management actions on %s', (_, Sidebar) => {
    render(<Sidebar />);
    expect(screen.getByText('首页群：my-home-group')).toHaveAttribute(
      'data-manage-default',
      'true',
    );
    expect(screen.queryByText('工作区专用栏目')).not.toBeInTheDocument();
  });

  it('keeps the group list while readiness loads and follows the shared collapse state', () => {
    state.groupId = undefined;
    const { rerender } = render(<Content />);
    expect(screen.getByText('群列表：展开')).toBeInTheDocument();
    state.expanded = false;
    rerender(<Content />);
    expect(screen.getByText('群列表：收起')).toBeInTheDocument();
  });

  it('preserves workspace-specific operations in a workspace', () => {
    state.workspace = 'team';
    render(<Content />);
    expect(screen.getByText('工作区专用栏目')).toBeInTheDocument();
    expect(screen.getByText('工作区导航')).toBeInTheDocument();
    expect(screen.queryByText('首页群：my-home-group')).not.toBeInTheDocument();
  });
});
