import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NavPanel from './index';
import { NavPanelPortal } from './NavPanelPortal';
import {
  clearNavPanelRegistry,
  registerNavPanelContent,
  unregisterNavPanelContent,
} from './registry';
import NavPanelShell from './Shell';

const panelRender = vi.fn();

let pathname = '/lobe-team/settings/general';
let narrowViewport = false;
/* 群组导航条在 <1200px 隐藏（xl 断点），测试通过该变量模拟宽/窄屏 */
const xlViewport = true;
const viewportListeners = new Set<() => void>();

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: () =>
    useSyncExternalStore(
      (listener) => {
        viewportListeners.add(listener);
        return () => viewportListeners.delete(listener);
      },
      () => narrowViewport,
    ),
}));

vi.mock('antd-style', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.mock factory cannot use a top-level type import
  const actual = await importOriginal<typeof import('antd-style')>();
  return {
    ...actual,
    useResponsive: () => ({ ...actual.useResponsive(), xl: xlViewport }),
  };
});

interface WorkspaceMock {
  activeWorkspaceId: string;
  workspaces: { id: string; slug: string }[];
}

interface NavPanelDraggableMockProps {
  activeContent: {
    key: string;
    node: ReactNode;
  };
  navKey: string;
}

const workspaceState: WorkspaceMock = {
  activeWorkspaceId: 'workspace-1',
  workspaces: [{ id: 'workspace-1', slug: 'lobe-team' }],
};

vi.mock('react-router', () => ({
  useLocation: () => ({ pathname }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () =>
    workspaceState.workspaces.find((workspace) => workspace.id === workspaceState.activeWorkspaceId)
      ?.slug ?? null,
}));

vi.mock('./components/NavPanelDraggable', () => ({
  NavPanelDraggable: ({ activeContent, navKey }: NavPanelDraggableMockProps) => {
    panelRender();
    return (
      <div data-layout-key={navKey} data-nav-key={activeContent.key} data-testid="nav-panel">
        {activeContent.node}
      </div>
    );
  },
}));

vi.mock('@/features/HomeSidebar/Content', () => ({
  default: () => <div>Home sidebar</div>,
}));

vi.mock('@/features/HomeSidebar/TaskSidebarContent', () => ({
  default: () => <div>Group task sidebar</div>,
}));

describe('NavPanel', () => {
  beforeEach(() => {
    narrowViewport = false;
    pathname = '/lobe-team/settings/general';
    clearNavPanelRegistry();
  });

  it('releases group sidebar space on narrow screens and restores it on wide screens', () => {
    pathname = '/group/group-1';
    render(<NavPanel />);
    expect(screen.getByTestId('nav-panel')).toBeInTheDocument();
    act(() => {
      narrowViewport = true;
      viewportListeners.forEach((listener) => listener());
    });
    expect(screen.queryByTestId('nav-panel')).not.toBeInTheDocument();
    act(() => {
      narrowViewport = false;
      viewportListeners.forEach((listener) => listener());
    });
    expect(screen.getByTestId('nav-panel')).toBeInTheDocument();
  });

  it('keeps other route navigation unchanged in a narrow window', () => {
    narrowViewport = true;
    render(<NavPanel />);
    expect(screen.getByTestId('nav-panel')).toBeInTheDocument();
  });

  it('suppresses a route panel without leaving its fallback skeleton behind', async () => {
    pathname = '/group/member-group';

    render(
      <>
        <NavPanelPortal hidden navKey="group" />
        <NavPanel />
      </>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('nav-panel')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('nav-sidebar-skeleton')).not.toBeInTheDocument();
  });

  it.each([false, true])(
    'ignores unrelated registrations with active content present: %s',
    (registered) => {
      pathname = '/tasks';
      const owner = Symbol('tasks');
      if (registered) registerNavPanelContent('tasks', owner, <div>Original</div>);
      render(<NavPanel />);
      const before = panelRender.mock.calls.length;
      const otherOwner = Symbol('discover');

      act(() => registerNavPanelContent('discover', otherOwner, <div>Discover</div>));
      act(() => unregisterNavPanelContent('discover', otherOwner));
      expect(panelRender).toHaveBeenCalledTimes(before);

      act(() => registerNavPanelContent('tasks', owner, <div>Updated</div>));
      expect(screen.getByText('Updated')).toBeInTheDocument();
      act(() => unregisterNavPanelContent('tasks', owner));
      expect(screen.getByTestId('nav-sidebar-skeleton')).toBeInTheDocument();
    },
  );

  it('selects the route-owned entry instead of a concurrently registered Home entry', async () => {
    render(
      <>
        <NavPanelPortal navKey="home">
          <div>Home sidebar</div>
        </NavPanelPortal>
        <NavPanelPortal navKey="workspace-settings">
          <div>Workspace settings sidebar</div>
        </NavPanelPortal>
        <NavPanel />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByText('Workspace settings sidebar')).toBeInTheDocument();
    });
    expect(screen.getByTestId('nav-panel')).toHaveAttribute('data-nav-key', 'workspace-settings');
    expect(screen.queryByText('Home sidebar')).not.toBeInTheDocument();
  });

  it('uses the Home entry for routes without a dedicated navigation panel', async () => {
    pathname = '/lobe-team/tasks';

    render(
      <>
        <NavPanelPortal navKey="home">
          <div>Home sidebar</div>
        </NavPanelPortal>
        <NavPanel />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByText('Home sidebar')).toBeInTheDocument();
    });
    expect(screen.getByTestId('nav-panel')).toHaveAttribute('data-nav-key', 'home');
  });

  it('shows a route-keyed fallback instead of stale Home content while a dedicated portal loads', async () => {
    pathname = '/lobe-team/community';

    render(
      <>
        <NavPanelPortal navKey="home">
          <div>Home sidebar</div>
        </NavPanelPortal>
        <NavPanel />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('nav-sidebar-skeleton')).toBeInTheDocument();
    });
    expect(screen.getByTestId('nav-panel')).toHaveAttribute('data-nav-key', 'pending:discover');
    expect(screen.queryByText('Home sidebar')).not.toBeInTheDocument();
  });

  it('gives the settings skeleton a search placeholder', async () => {
    pathname = '/settings/profile';

    render(<NavPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('nav-sidebar-skeleton')).toBeInTheDocument();
    });
    expect(screen.getByTestId('nav-sidebar-skeleton-search')).toBeInTheDocument();
    expect(screen.queryByTestId('nav-sidebar-skeleton-nav')).not.toBeInTheDocument();
  });

  it('drops the search placeholder for the searchless workspace settings sidebar', async () => {
    pathname = '/lobe-team/settings/general';

    render(<NavPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('nav-sidebar-skeleton')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('nav-sidebar-skeleton-search')).not.toBeInTheDocument();
  });

  it('shapes the skeleton per nav key: discover is header-plus-nav with no body', async () => {
    pathname = '/community';

    render(<NavPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('nav-sidebar-skeleton')).toBeInTheDocument();
    });
    expect(screen.getByTestId('nav-sidebar-skeleton-nav')).toBeInTheDocument();
    expect(screen.queryByTestId('nav-sidebar-skeleton-search')).not.toBeInTheDocument();
  });

  it('does not let an older owner cleanup remove the newer entry for the same key', async () => {
    const Harness = ({ showOld }: { showOld: boolean }) => (
      <>
        {showOld && (
          <NavPanelPortal key="old" navKey="home">
            <div>Old Home sidebar</div>
          </NavPanelPortal>
        )}
        <NavPanelPortal key="new" navKey="home">
          <div>New Home sidebar</div>
        </NavPanelPortal>
        <NavPanel />
      </>
    );

    pathname = '/';
    const { rerender } = render(<Harness showOld />);

    await waitFor(() => {
      expect(screen.getByText('New Home sidebar')).toBeInTheDocument();
    });

    rerender(<Harness showOld={false} />);

    await waitFor(() => {
      expect(screen.getByText('New Home sidebar')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('nav-sidebar-skeleton')).not.toBeInTheDocument();
  });
});

describe('NavPanelShell', () => {
  beforeEach(() => {
    clearNavPanelRegistry();
  });

  it('provides the Home entry on routes that never mount the Home layout', async () => {
    pathname = '/agents';

    render(<NavPanelShell />);

    await waitFor(() => {
      expect(screen.getByText('Home sidebar')).toBeInTheDocument();
    });
    expect(screen.getByTestId('nav-panel')).toHaveAttribute('data-nav-key', 'home');
    expect(screen.queryByTestId('nav-sidebar-skeleton')).not.toBeInTheDocument();
  });

  it.each(['/tasks', '/task/task-1'])('selects the group task panel for %s', async (route) => {
    pathname = route;
    render(<NavPanelShell />);

    await waitFor(() => {
      expect(screen.getByTestId('nav-panel')).toHaveAttribute('data-nav-key', 'tasks');
    });
    expect(screen.queryByText('Home sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-sidebar-skeleton')).not.toBeInTheDocument();
  });

  it('still yields to a dedicated route panel', async () => {
    pathname = '/community';

    render(<NavPanelShell />);

    await waitFor(() => {
      expect(screen.getByTestId('nav-sidebar-skeleton')).toBeInTheDocument();
    });
    expect(screen.queryByText('Home sidebar')).not.toBeInTheDocument();
  });
});

it('keeps group layout while the group sidebar is still loading', () => {
  pathname = '/group/group-loading';
  render(<NavPanel />);
  expect(screen.getByTestId('nav-panel')).toHaveAttribute('data-layout-key', 'group');
  expect(screen.getByTestId('nav-panel')).toHaveAttribute('data-nav-key', 'pending:group');
});
