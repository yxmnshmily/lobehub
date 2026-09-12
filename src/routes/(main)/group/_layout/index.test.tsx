/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMobileGroupSidebar } from '@/features/SuperGroup/useMobileGroupSidebar';

import Layout from './index';

const mocks = vi.hoisted(() => ({
  activeGroupId: undefined as string | undefined,
  gid: 'group-b',
  routeSuffix: '',
  isMobile: false,
  narrowViewport: false,
  groupQueryOptions: {} as Record<string, unknown>,
  groupDetailState: {
    data: undefined as { id: string } | null | undefined,
    error: undefined as unknown,
    isLoading: true,
    mutate: vi.fn(),
  },
  groupListState: {
    data: undefined as
      | Array<{
          avatar: string | null;
          groupId: string;
          joinedAt: Date | null;
          kind: 'member' | 'owner';
          membershipVersion: number;
          resourceOwnerUserId: string;
          title: string | null;
        }>
      | undefined,
    error: undefined as unknown,
    isError: false,
    isLoading: true,
    refetch: vi.fn(),
  },
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  ShikiLobeTheme: {},
}));

vi.mock('react-router', () => ({
  Outlet: () => {
    const sidebar = useMobileGroupSidebar();
    return (
      <div data-testid="group-layout-outlet">
        outlet
        {sidebar && (
          <button data-testid="sidebar-toggle" onClick={sidebar.toggle}>
            toggle
          </button>
        )}
      </div>
    );
  },
  useLocation: () => ({ pathname: `/group/${mocks.gid}${mocks.routeSuffix}`, search: '' }),
  useParams: () => ({ gid: mocks.gid }),
}));

vi.mock('@/components/AsyncError', () => ({
  default: ({ onRetry }: { onRetry?: () => void }) => (
    <button data-testid="group-layout-error" type="button" onClick={onRetry}>
      retry
    </button>
  ),
}));
vi.mock('@/components/Skeleton/Surface', () => ({
  default: () => <div data-testid="group-layout-loading" />,
}));
vi.mock('@/const/version', () => ({ isDesktop: false }));
vi.mock('@/features/GroupNotFound', () => ({
  GroupNotFound: () => <div data-testid="group-layout-not-found" />,
  GroupNotFoundGuard: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock('@/features/NavPanel/NavPanelPortal', () => ({
  NavPanelPortal: ({ hidden, navKey }: { hidden?: boolean; navKey?: string }) => (
    <div
      data-hidden={hidden ? 'true' : 'false'}
      data-nav-key={navKey}
      data-testid="nav-suppressor"
    />
  ),
}));
vi.mock('@/features/ProtocolUrlHandler', () => ({ default: () => null }));
vi.mock('@/features/SuperGroup/GroupMembersPage', () => ({ default: () => <h1>群成员页面</h1> }));
vi.mock('@/features/SuperGroup/GroupTopicsPage', () => ({ default: () => <h1>群话题页面</h1> }));
vi.mock('@/hooks/useInitGroupConfig', () => ({
  useInitGroupConfig: () => mocks.groupDetailState,
}));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mocks.narrowViewport }));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    groupConversation: {
      listGroups: {
        useQuery: (_input: unknown, options: Record<string, unknown>) => {
          mocks.groupQueryOptions = options;
          return mocks.groupListState;
        },
      },
    },
  },
}));
vi.mock('@/store/agentGroup', () => ({
  useAgentGroupStore: (selector: (state: { activeGroupId?: string }) => unknown) =>
    selector({ activeGroupId: mocks.activeGroupId }),
}));
vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: { isMobile: boolean }) => unknown) =>
    selector({ isMobile: mocks.isMobile }),
}));
vi.mock('../features/MemberConversation', () => {
  const MemberConversationMock = ({ group }: { group: { title: string | null } }) => {
    const sidebar = useMobileGroupSidebar();
    return (
      <section>
        <h1>{group.title}</h1>
        <span>仅支持真人成员纯文本沟通</span>
        {sidebar && (
          <button data-testid="member-sidebar-toggle" onClick={sidebar.toggle}>
            toggle member sidebar
          </button>
        )}
      </section>
    );
  };
  return { default: MemberConversationMock };
});
vi.mock('@/features/SuperGroup/MemberProfile', () => ({ default: () => <h1>群组档案页面</h1> }));
vi.mock('@/features/SuperGroup/JoinedGroupSidebar', () => ({
  default: ({ groupId }: { groupId: string }) => (
    <aside data-testid="joined-sidebar">{groupId}</aside>
  ),
  SuperGroupSidebarBody: ({ groupId }: { groupId: string }) => <div>{groupId}</div>,
}));
vi.mock('./GroupIdSync', () => ({ default: () => <div data-testid="group-layout-id-sync" /> }));
vi.mock('./MobileTopics', () => ({
  default: () => <div data-testid="group-layout-mobile-topics" />,
}));
vi.mock('./RegisterHotkeys', () => ({
  default: () => <div data-testid="group-layout-hotkeys" />,
}));
vi.mock('./Sidebar', () => ({ default: () => <div data-testid="group-layout-sidebar" /> }));
vi.mock('./Sidebar/Content', () => ({
  default: () => <div data-testid="group-sidebar-content" />,
}));
vi.mock('@/features/NavPanel/components/NavPanelDraggable', () => ({
  CompactNavPanel: ({ children }: { children: ReactNode }) => (
    <aside data-testid="group-mobile-icon-rail">{children}</aside>
  ),
}));

describe('Group layout route readiness', () => {
  beforeEach(() => {
    mocks.activeGroupId = 'group-b';
    mocks.gid = 'group-b';
    mocks.routeSuffix = '';
    mocks.isMobile = false;
    mocks.narrowViewport = false;
    mocks.groupDetailState.data = undefined;
    mocks.groupDetailState.error = undefined;
    mocks.groupDetailState.isLoading = true;
    mocks.groupDetailState.mutate.mockReset();
    mocks.groupListState.data = undefined;
    mocks.groupListState.error = undefined;
    mocks.groupListState.isError = false;
    mocks.groupListState.isLoading = true;
    mocks.groupListState.refetch.mockReset();
  });

  it('does not mount the conversation while the routed group detail is loading', () => {
    render(<Layout />);

    expect(screen.getByTestId('group-layout-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('group-layout-outlet')).not.toBeInTheDocument();
  });

  it('does not reuse the previous group while the route id is synchronizing', () => {
    mocks.activeGroupId = 'group-a';
    mocks.groupDetailState.data = { id: 'group-a' };
    mocks.groupDetailState.isLoading = false;

    render(<Layout />);

    expect(screen.getByTestId('group-layout-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('group-layout-outlet')).not.toBeInTheDocument();
  });

  it('keeps the member navigation mounted through A → B synchronization and profile navigation', () => {
    mocks.groupDetailState.data = null;
    mocks.groupDetailState.isLoading = false;
    mocks.groupListState.isLoading = false;
    mocks.groupListState.data = ['group-a', 'group-b'].map((groupId) => ({
      avatar: null,
      groupId,
      joinedAt: null,
      kind: 'member' as const,
      membershipVersion: 1,
      resourceOwnerUserId: 'owner',
      title: groupId,
    }));
    mocks.gid = 'group-a';
    mocks.activeGroupId = 'group-a';
    const { rerender } = render(<Layout />);
    const sidebar = screen.getByTestId('joined-sidebar');
    mocks.gid = 'group-b';
    rerender(<Layout />);
    expect(screen.getByTestId('joined-sidebar')).toBe(sidebar);
    expect(sidebar).toHaveTextContent('group-b');
    expect(screen.queryByTestId('group-layout-sidebar')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'group-a' })).not.toBeInTheDocument();
    mocks.activeGroupId = 'group-b';
    rerender(<Layout />);
    expect(screen.getByTestId('joined-sidebar')).toBe(sidebar);
    expect(screen.getByRole('heading', { name: 'group-b' })).toBeInTheDocument();
    mocks.routeSuffix = '/profile';
    rerender(<Layout />);
    expect(screen.getByTestId('joined-sidebar')).toBe(sidebar);
  });

  it('shows a retryable error without mounting the conversation', () => {
    mocks.groupDetailState.error = new Error('network failed');
    mocks.groupDetailState.isLoading = false;

    render(<Layout />);
    fireEvent.click(screen.getByTestId('group-layout-error'));

    expect(mocks.groupDetailState.mutate).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('group-layout-outlet')).not.toBeInTheDocument();
  });

  it('keeps the cached owner route mounted when a background refresh fails', () => {
    mocks.groupDetailState.data = { id: 'group-b' };
    mocks.groupDetailState.error = new Error('owner refresh failed');
    mocks.groupDetailState.isLoading = false;

    render(<Layout />);

    expect(screen.queryByTestId('group-layout-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('group-layout-outlet')).toBeInTheDocument();
  });

  it('does not keep cached owner access after an authorization failure', () => {
    mocks.groupDetailState.data = { id: 'group-b' };
    mocks.groupDetailState.error = { data: { code: 'FORBIDDEN' } };
    mocks.groupDetailState.isLoading = false;

    render(<Layout />);

    expect(screen.getByTestId('group-layout-error')).toBeInTheDocument();
    expect(screen.queryByTestId('group-layout-outlet')).not.toBeInTheDocument();
  });

  it('shows not-found when the current group resolves to no accessible detail', () => {
    mocks.groupDetailState.data = null;
    mocks.groupDetailState.isLoading = false;
    mocks.groupListState.data = [];
    mocks.groupListState.isLoading = false;

    render(<Layout />);

    expect(screen.getByTestId('group-layout-not-found')).toBeInTheDocument();
    expect(screen.queryByTestId('group-layout-outlet')).not.toBeInTheDocument();
  });

  it.each([
    ['', '默认私人旅游群'],
    ['/profile', '群组档案页面'],
    ['/topics', 'outlet'],
    ['/members', 'outlet'],
    ['/permission', 'outlet'],
  ])(
    'mounts the requested member route %s through its authoritative child surface',
    (routeSuffix, expected) => {
      mocks.routeSuffix = routeSuffix;
      mocks.groupDetailState.data = null;
      mocks.groupDetailState.isLoading = false;
      mocks.groupListState.data = [
        {
          avatar: '🏔️',
          groupId: 'group-b',
          joinedAt: new Date('2026-09-04T02:00:00.000Z'),
          kind: 'member',
          membershipVersion: 1,
          resourceOwnerUserId: 'owner-1',
          title: '默认私人旅游群',
        },
      ];
      mocks.groupListState.isLoading = false;

      render(<Layout />);

      if (expected === 'outlet') expect(screen.getByTestId('group-layout-outlet')).toBeVisible();
      else expect(screen.getByRole('heading', { name: expected })).toBeInTheDocument();
      if (routeSuffix)
        expect(screen.queryByText('仅支持真人成员纯文本沟通')).not.toBeInTheDocument();
      expect(screen.queryByTestId('group-layout-not-found')).not.toBeInTheDocument();
      expect(screen.queryByTestId('group-layout-sidebar')).not.toBeInTheDocument();
      expect(screen.queryByTestId('group-layout-hotkeys')).not.toBeInTheDocument();
      expect(screen.queryByTestId('nav-suppressor')).not.toBeInTheDocument();
    },
  );

  it('fails closed when a membership refresh errors while cached member data remains', () => {
    mocks.groupDetailState.data = null;
    mocks.groupDetailState.isLoading = false;
    mocks.groupListState.data = [
      {
        avatar: '🏔️',
        groupId: 'group-b',
        joinedAt: new Date('2026-09-04T02:00:00.000Z'),
        kind: 'member',
        membershipVersion: 1,
        resourceOwnerUserId: 'owner-1',
        title: '默认私人旅游群',
      },
    ];
    mocks.groupListState.error = new Error('membership refresh failed');
    mocks.groupListState.isError = true;
    mocks.groupListState.isLoading = false;

    render(<Layout />);

    expect(screen.getByTestId('group-layout-error')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '默认私人旅游群' })).not.toBeInTheDocument();
  });

  it('refreshes membership while foregrounded and removes a revoked member conversation', () => {
    mocks.groupDetailState.data = null;
    mocks.groupDetailState.isLoading = false;
    mocks.groupListState.isLoading = false;
    mocks.groupListState.data = [
      {
        avatar: null,
        groupId: 'group-b',
        joinedAt: new Date('2026-09-04T02:00:00.000Z'),
        kind: 'member',
        membershipVersion: 1,
        resourceOwnerUserId: 'owner-1',
        title: '受邀工作群',
      },
    ];
    const { rerender } = render(<Layout />);
    expect(screen.getByRole('heading', { name: '受邀工作群' })).toBeInTheDocument();
    expect(mocks.groupQueryOptions).toMatchObject({
      gcTime: 0,
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
      retry: false,
    });
    mocks.groupListState.data = [];
    rerender(<Layout />);
    expect(screen.queryByRole('heading', { name: '受邀工作群' })).not.toBeInTheDocument();
    expect(screen.getByTestId('group-layout-not-found')).toBeInTheDocument();
  });

  it('mounts the conversation only after the current routed group is ready', () => {
    mocks.groupDetailState.data = { id: 'group-b' };
    mocks.groupDetailState.isLoading = false;

    render(<Layout />);

    expect(screen.getByTestId('group-layout-outlet')).toBeInTheDocument();
    expect(screen.queryByTestId('group-layout-loading')).not.toBeInTheDocument();
  });

  it('allows the conversation column to shrink to a mobile viewport', () => {
    mocks.groupDetailState.data = { id: 'group-b' };
    mocks.groupDetailState.isLoading = false;

    render(<Layout />);

    expect(screen.getByTestId('group-layout-outlet').parentElement).toHaveAttribute(
      'width',
      '100%',
    );
    expect(screen.getByTestId('group-layout-outlet').parentElement).toHaveStyle({ minWidth: '0' });
  });

  it('mounts mobile topic history without desktop sidebar behavior', () => {
    mocks.groupDetailState.data = { id: 'group-b' };
    mocks.groupDetailState.isLoading = false;
    mocks.isMobile = true;

    render(<Layout />);

    expect(screen.queryByTestId('group-layout-sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('group-layout-hotkeys')).not.toBeInTheDocument();
    expect(screen.getByTestId('group-layout-mobile-topics')).toBeInTheDocument();
    expect(screen.getByTestId('group-layout-outlet')).toBeInTheDocument();
    expect(screen.getByTestId('group-layout-outlet').parentElement?.parentElement).toHaveStyle({
      minHeight: '0',
      overflow: 'hidden',
    });
    expect(screen.queryByTestId('group-mobile-icon-rail')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sidebar-toggle'));
    expect(screen.getByTestId('group-mobile-icon-rail')).toBeInTheDocument();
    expect(screen.getByTestId('group-sidebar-content')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sidebar-toggle'));
    expect(screen.queryByTestId('group-mobile-icon-rail')).not.toBeInTheDocument();
  });

  it('keeps joined-group navigation reachable on a mobile viewport', () => {
    mocks.groupDetailState.data = null;
    mocks.groupDetailState.isLoading = false;
    mocks.groupListState.isLoading = false;
    mocks.groupListState.data = [
      {
        avatar: null,
        groupId: 'group-b',
        joinedAt: new Date('2026-09-04T02:00:00.000Z'),
        kind: 'member',
        membershipVersion: 1,
        resourceOwnerUserId: 'owner',
        title: '受邀工作群',
      },
    ];
    mocks.narrowViewport = true;

    render(<Layout />);

    fireEvent.click(screen.getByTestId('member-sidebar-toggle'));
    expect(screen.getByTestId('group-mobile-icon-rail')).toBeInTheDocument();
    expect(screen.getByText('group-b')).toBeInTheDocument();
  });

  it('makes mobile history reachable in a narrow desktop window and restores desktop navigation', () => {
    mocks.groupDetailState.data = { id: 'group-b' };
    mocks.groupDetailState.isLoading = false;
    mocks.narrowViewport = true;
    const { rerender } = render(<Layout />);
    expect(screen.getByTestId('group-layout-mobile-topics')).toBeInTheDocument();
    expect(screen.queryByTestId('group-layout-sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('group-mobile-icon-rail')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sidebar-toggle'));
    expect(screen.getByTestId('group-mobile-icon-rail')).toBeInTheDocument();
    mocks.narrowViewport = false;
    rerender(<Layout />);
    expect(screen.getByTestId('group-layout-sidebar')).toBeInTheDocument();
    expect(screen.queryByTestId('group-mobile-icon-rail')).not.toBeInTheDocument();
    expect(screen.queryByTestId('group-layout-mobile-topics')).not.toBeInTheDocument();
  });
});
