import { fireEvent, render as renderUI, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import GroupSwitcher from './GroupSwitcher';

const render = (ui: ReactNode) => renderUI(ui, { wrapper: MemoryRouter });

vi.mock('@/features/GroupMembership/useMemberSidebar', () => ({
  useMemberSidebar: () => ({ arrange: (items: unknown[]) => items, category: () => undefined }),
}));

vi.mock('@/hooks/usePrefetchGroup', () => ({ usePrefetchGroup: () => state.prefetch }));

vi.mock('@/hooks/useActiveLocation', () => ({
  useActiveLocation: () => ({ pathname: state.pathname }),
}));

const state = vi.hoisted(() => ({
  invitations: { items: [] as Array<{ invitationId: string }>, nextOffset: null },
  activeGroupId: 'mine',
  pathname: '/group/mine',
  push: vi.fn(),
  prefetch: vi.fn(),
  workspace: undefined as string | undefined,
  groups: [
    { groupId: 'mine', kind: 'owner', title: '默认群' },
    { groupId: 'joined', kind: 'member', ownerDisplayName: '张三', title: '朋友的旅游群' },
  ],
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => state.workspace,
}));
vi.mock('@/store/user', () => ({ useUserStore: () => true }));
vi.mock('@/store/agentGroup', () => ({ useAgentGroupStore: (selector: any) => selector(state) }));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    groupConversation: { listGroups: { useQuery: () => ({ data: state.groups }) } },
    groupMembership: {
      listMyPendingInvitations: { useQuery: () => ({ data: state.invitations }) },
      listParticipants: { useQuery: () => ({ data: { items: [], assistants: [] } }) },
    },
  },
}));
vi.mock('@/features/Workspace/WorkspaceLink', () => ({
  default: ({ to, children, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('./RecentTopicLinks', () => ({
  default: ({ groupId }: any) => <div>历史话题：{groupId}</div>,
}));
vi.mock('@/features/GroupMembership/DefaultGroupActions', () => ({ default: () => null }));
vi.mock('@/features/GroupMembership/AssistantActions', () => ({ default: () => null }));
vi.mock('@/hooks/useQueryRoute', () => ({ useQueryRoute: () => ({ push: state.push }) }));
vi.mock('@/features/GroupMembership', () => ({
  GroupMembersButton: ({ groupId }: any) => <button>群成员：{groupId}</button>,
}));
vi.mock('@/features/NavPanel/components/SkeletonList', () => ({ default: () => null }));

describe('GroupSwitcher', () => {
  beforeEach(() => {
    state.invitations.items = [];
    state.workspace = undefined;
    state.activeGroupId = 'mine';
    state.pathname = '/group/mine';
    state.push.mockClear();
    state.prefetch.mockClear();
  });
  it.each([
    ['mine', '我的超级工作群'],
    ['joined', '张三的群'],
  ])(
    'opens the %s conversation from another page, even with a stale active group',
    (groupId, title) => {
      state.pathname = '/settings/profile';
      state.activeGroupId = groupId;
      render(
        <GroupSwitcher>
          <div>当前群内容</div>
        </GroupSwitcher>,
      );
      const joined = screen.getByRole('button', { name: title });
      fireEvent.click(joined);
      expect(state.push).toHaveBeenCalledWith(`/group/${groupId}`, { replace: true });
      expect(screen.getByRole('button', { name: `收起${title}` })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    },
  );
  it('switches from the owned conversation to a joined conversation', () => {
    render(<GroupSwitcher />);
    fireEvent.click(screen.getByRole('button', { name: '张三的群' }));
    expect(state.push).toHaveBeenCalledWith('/group/joined', { replace: true });
  });
  it.each([
    '/group/mine/topic-1',
    '/group/mine/members',
    '/group/mine/topics',
    '/group/mine/goals',
    '/group/mine/tasks',
    '/group/mine/projects',
    '/group/mine/project/demo/tasks',
  ])('returns to the conversation from %s when clicking the group title', (pathname) => {
    state.pathname = pathname;
    render(
      <GroupSwitcher>
        <div>当前群内容</div>
      </GroupSwitcher>,
    );
    fireEvent.click(screen.getByRole('button', { name: '我的超级工作群' }));
    expect(state.push).toHaveBeenCalledWith('/group/mine', { replace: true });
    expect(state.prefetch).toHaveBeenCalledTimes(0);
    expect(screen.getByText('当前群内容')).toBeVisible();
  });
  it('preloads on pointer and keyboard intent without navigating', () => {
    render(<GroupSwitcher />);
    const joined = screen.getByRole('button', { name: '张三的群' });
    fireEvent.pointerEnter(joined);
    fireEvent.focus(joined);
    fireEvent.pointerDown(joined);
    expect(state.prefetch).toHaveBeenCalledTimes(3);
    expect(state.prefetch).toHaveBeenCalledWith('joined', 'member');
    fireEvent.pointerEnter(screen.getByRole('button', { name: '我的超级工作群' }));
    expect(state.prefetch).toHaveBeenCalledTimes(3);
    expect(state.push).not.toHaveBeenCalled();
  });
  it('does not duplicate the relocated group logs in the sidebar', () => {
    render(<GroupSwitcher />);
    const own = screen.getByRole('button', { name: '我的超级工作群' });
    fireEvent.click(own);
    expect(own.parentElement!.querySelector('a[href="/tasks"]')).toBeNull();
    expect(own.parentElement).not.toHaveTextContent('群日志');
  });
  it('nests the sidebar sections under the active group', () => {
    const { rerender } = render(
      <GroupSwitcher>
        <div>成员和话题</div>
      </GroupSwitcher>,
    );
    const ownGroup = screen.getByRole('button', { name: '我的超级工作群' }).parentElement!;
    expect(ownGroup).toContainElement(screen.getByText('成员和话题'));
    state.activeGroupId = 'joined';
    rerender(
      <GroupSwitcher>
        <div>成员和话题</div>
      </GroupSwitcher>,
    );
    expect(ownGroup).not.toContainElement(screen.getByText('成员和话题'));
    expect(screen.getByRole('button', { name: '张三的群' }).parentElement).toContainElement(
      screen.getByText('成员和话题'),
    );
  });
  it('keeps the home group sections under their owner on the apps page', () => {
    state.pathname = '/apps';
    state.activeGroupId = 'joined';
    render(
      <GroupSwitcher sectionGroupId="mine">
        <div>首页群栏目</div>
      </GroupSwitcher>,
    );
    expect(screen.getByRole('button', { name: '我的超级工作群' }).parentElement).toContainElement(
      screen.getByText('首页群栏目'),
    );
    expect(screen.getByRole('button', { name: '张三的群' }).parentElement).not.toContainElement(
      screen.getByText('首页群栏目'),
    );
  });
  it.each([
    ['mine', '我的超级工作群'],
    ['joined', '张三的群'],
  ])('collapses and expands %s without removing its sections', (groupId, title) => {
    state.activeGroupId = groupId;
    state.pathname = `/group/${groupId}`;
    render(
      <GroupSwitcher>
        <div>成员和话题</div>
      </GroupSwitcher>,
    );
    const toggle = screen.getByRole('button', { name: `收起${title}` });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('成员和话题')).not.toBeVisible();
    fireEvent.click(toggle);
    expect(screen.getByText('成员和话题')).toBeVisible();
    expect(state.push).not.toHaveBeenCalled();
  });
  it('uses only the arrow to collapse while viewing a child column', () => {
    state.pathname = '/group/mine/tasks';
    render(
      <GroupSwitcher>
        <div>当前群内容</div>
      </GroupSwitcher>,
    );
    fireEvent.click(screen.getByRole('button', { name: '收起我的超级工作群' }));
    expect(screen.getByText('当前群内容')).not.toBeVisible();
    expect(state.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '展开我的超级工作群' }));
    expect(screen.getByText('当前群内容')).toBeVisible();
    expect(state.push).not.toHaveBeenCalled();
  });
  it('does not show personal groups inside a workspace', () => {
    state.workspace = 'team';
    const { container } = render(<GroupSwitcher />);
    expect(container).toBeEmptyDOMElement();
  });
});

it.each([false, true])(
  'shows pending invitations below joined groups and hides them after handling (compact=%s)',
  (compact) => {
    state.workspace = undefined;
    state.invitations.items = [{ invitationId: 'invite-1' }];
    const { rerender } = render(<GroupSwitcher compact={compact} />);
    if (compact) fireEvent.click(screen.getByRole('button', { name: '切换群组' }));
    const notice = document.querySelector('a[href="/settings/profile"]');
    expect(notice).not.toBeNull();
    const joined = screen.getByRole('button', { name: '张三的群' });
    expect(joined.compareDocumentPosition(notice!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    state.invitations.items = [];
    rerender(<GroupSwitcher compact={compact} />);
    expect(document.querySelector('a[href="/settings/profile"]')).toBeNull();
  },
);

it.each([false, true])('does not put More below the group directory (compact=%s)', (compact) => {
  state.workspace = undefined;
  render(<GroupSwitcher compact={compact} />);
  if (compact) fireEvent.click(screen.getByRole('button', { name: '切换群组' }));
  expect(screen.queryByRole('button', { name: /^(更多|More)$/ })).toBeNull();
});
