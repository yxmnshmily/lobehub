import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { MobileSidebarContext } from '@/features/SuperGroup/useMobileGroupSidebar';

import { GroupMembers } from './GroupMembersPage';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  error: false,
  toggle: vi.fn().mockResolvedValue(undefined),
  hidden: false,
}));
vi.mock('@/hooks/useQueryRoute', () => ({ useQueryRoute: () => ({ push: vi.fn() }) }));
vi.mock('@/features/NavHeader', () => ({
  default: ({ left, right, showTogglePanelButton }: any) => (
    <header data-global-toggle={String(showTogglePanelButton)}>
      {left}
      {right}
    </header>
  ),
}));
vi.mock('@/features/AgentViewAll/ListConfig', () => ({
  default: ({ setOptions }: any) => (
    <button
      onClick={() =>
        setOptions((previous: any) => ({
          ...previous,
          showSidebarHidden: !previous.showSidebarHidden,
        }))
      }
    >
      切换显示隐藏成员
    </button>
  ),
}));
vi.mock('@/features/AgentProfileCard/AgentProfilePopup', () => ({
  default: ({ children, groupId }: any) => <div data-group={groupId}>{children}</div>,
}));
vi.mock('@/features/GroupMembership', () => ({
  GroupMembersButton: () => <button>管理成员</button>,
}));
vi.mock('@/features/GroupMembership/DefaultGroupActions', () => ({
  default: () => <button>添加成员</button>,
}));
vi.mock('@/features/GroupMembership/AssistantActions', () => ({
  default: () => <button>成员操作</button>,
}));
vi.mock('@/features/GroupMembership/useMemberSidebar', () => ({
  useMemberSidebar: () => ({ arrange: (items: any[]) => (mocks.hidden ? [] : items) }),
}));
vi.mock('@/features/HomeSidebar/Body/Agent/useSidebarItemVisibility', () => ({
  useSidebarItemVisibility: () => ({
    isSidebarItemVisible: () => !mocks.hidden,
    setSidebarItemVisible: mocks.toggle,
  }),
}));
vi.mock('@/features/AgentViewAll/SidebarAgentsSection', () => ({
  sidebarSectionStyles: { card: 'card', description: 'description' },
  default: ({ items, renderItem }: any) => (
    <section aria-label="侧边栏展示">
      {items.map((item: any) => (
        <div key={item.id}>{renderItem(item)}</div>
      ))}
    </section>
  ),
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    groupMembership: {
      listParticipants: {
        useQuery: (input: unknown) => {
          mocks.query(input);
          return {
            isError: mocks.error,
            data: {
              viewerRole: 'member',
              items: [{ memberUserId: 'person', displayName: '群主', role: 'owner' }],
              assistants: [
                {
                  id: 'assistant',
                  title: '小林',
                  subtitle: '行程规划师',
                  description: '桂林路线规划',
                },
              ],
            },
            refetch: vi.fn(),
          };
        },
      },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.error = false;
  mocks.hidden = false;
});
it('shows only the selected group, and searches its member names, roles and descriptions', () => {
  render(<GroupMembers groupId="group-a" />);
  expect(mocks.query).toHaveBeenCalledWith({ groupId: 'group-a', limit: 50, offset: 0 });
  expect(screen.getByRole('region', { name: '侧边栏展示' })).toBeVisible();
  fireEvent.change(screen.getByRole('textbox', { name: '搜索成员' }), {
    target: { value: '桂林' },
  });
  expect(screen.getByRole('button', { name: '小林' })).toBeVisible();
  expect(screen.queryByText('群主')).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: '搜索成员' }), {
    target: { value: '不存在' },
  });
  expect(screen.getByText('没有匹配的成员')).toBeVisible();
});
it('does not reveal cached members after permission failure', () => {
  mocks.error = true;
  render(<GroupMembers groupId="group-a" />);
  expect(screen.getByText('成员加载失败')).toBeVisible();
  expect(screen.queryByText('小林')).toBeNull();
});
it('keeps hidden sidebar members in the searchable list', () => {
  mocks.hidden = true;
  render(<GroupMembers groupId="group-a" />);
  expect(screen.queryByRole('region', { name: '侧边栏展示' })).toBeNull();
  expect(screen.getByRole('button', { name: '小林' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '在侧边栏显示 小林' }));
  expect(mocks.toggle).toHaveBeenCalledWith('assistant', true);
});
it('filters hidden assistants without changing membership or hiding human participants', () => {
  mocks.hidden = true;
  render(<GroupMembers groupId="group-a" />);
  fireEvent.click(screen.getByRole('button', { name: '切换显示隐藏成员' }));
  expect(screen.queryByRole('button', { name: '小林' })).toBeNull();
  expect(screen.getAllByText('群主').length).toBeGreaterThan(0);
  expect(mocks.toggle).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '切换显示隐藏成员' }));
  expect(screen.getByRole('button', { name: '小林' })).toBeVisible();
});

it('uses the group sidebar control instead of the global toggle inside the mobile group shell', () => {
  const toggle = vi.fn();

  render(
    <MobileSidebarContext value={{ open: false, toggle }}>
      <GroupMembers groupId="group-a" />
    </MobileSidebarContext>,
  );

  expect(document.querySelector('header')).toHaveAttribute('data-global-toggle', 'false');
  fireEvent.click(screen.getByRole('button', { name: '展开侧栏' }));
  expect(toggle).toHaveBeenCalledOnce();
});
