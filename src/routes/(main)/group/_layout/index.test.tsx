/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Layout from './index';

const mocks = vi.hoisted(() => ({
  activeGroupId: undefined as string | undefined,
  gid: 'group-b',
  isMobile: false,
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
  Outlet: () => <div data-testid="group-layout-outlet">outlet</div>,
  useLocation: () => ({ pathname: `/group/${mocks.gid}`, search: '' }),
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
vi.mock('@/features/ProtocolUrlHandler', () => ({ default: () => null }));
vi.mock('@/hooks/useInitGroupConfig', () => ({
  useInitGroupConfig: () => mocks.groupDetailState,
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    groupConversation: {
      listGroups: { useQuery: () => mocks.groupListState },
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
vi.mock('../features/MemberConversation', () => ({
  default: ({ group }: { group: { title: string | null } }) => (
    <section>
      <h1>{group.title}</h1>
      <span>仅支持真人成员纯文本沟通</span>
    </section>
  ),
}));
vi.mock('./GroupIdSync', () => ({ default: () => <div data-testid="group-layout-id-sync" /> }));
vi.mock('./MobileTopics', () => ({
  default: () => <div data-testid="group-layout-mobile-topics" />,
}));
vi.mock('./RegisterHotkeys', () => ({
  default: () => <div data-testid="group-layout-hotkeys" />,
}));
vi.mock('./Sidebar', () => ({ default: () => <div data-testid="group-layout-sidebar" /> }));

describe('Group layout route readiness', () => {
  beforeEach(() => {
    mocks.activeGroupId = 'group-b';
    mocks.gid = 'group-b';
    mocks.isMobile = false;
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

  it('shows a retryable error without mounting the conversation', () => {
    mocks.groupDetailState.error = new Error('network failed');
    mocks.groupDetailState.isLoading = false;

    render(<Layout />);
    fireEvent.click(screen.getByTestId('group-layout-error'));

    expect(mocks.groupDetailState.mutate).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('group-layout-outlet')).not.toBeInTheDocument();
  });

  it('keeps the owner error boundary active when stale owner detail remains cached', () => {
    mocks.groupDetailState.data = { id: 'group-b' };
    mocks.groupDetailState.error = new Error('owner refresh failed');
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

  it('mounts the safe member conversation when an active member cannot load owner detail', () => {
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

    expect(screen.getByRole('heading', { name: '默认私人旅游群' })).toBeInTheDocument();
    expect(screen.getByText('仅支持真人成员纯文本沟通')).toBeInTheDocument();
    expect(screen.queryByTestId('group-layout-not-found')).not.toBeInTheDocument();
    expect(screen.queryByTestId('group-layout-outlet')).not.toBeInTheDocument();
    expect(screen.queryByTestId('group-layout-sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('group-layout-hotkeys')).not.toBeInTheDocument();
  });

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
  });
});
