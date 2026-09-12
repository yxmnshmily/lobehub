import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { SuperGroupSidebarBody } from './JoinedGroupSidebar';

vi.mock('@/features/GroupMembership/useMemberSidebar', () => ({
  useMemberSidebar: () => ({ arrange: (items: unknown[]) => items, category: () => undefined }),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    groupConversation: {
      listGroups: { useQuery: () => ({ data: [{ groupId: 'joined', kind: 'member' }] }) },
    },
    groupMembership: {
      listParticipants: {
        useQuery: () => ({
          data: {
            items: [
              { memberUserId: 'owner', displayName: '群主账号', role: 'owner', avatar: null },
              { memberUserId: 'me', displayName: '我的账号', role: 'member', avatar: null },
            ],
            assistants: ['旅游群主 AI', 'Codex', 'KIMI-K3', '抖音文案专家'].map((title, id) => ({
              id: String(id),
              title,
              avatar: null,
            })),
            nextOffset: null,
          },
          isLoading: false,
          isError: false,
        }),
      },
    },
  },
}));
vi.mock('@/features/GroupMembership', () => ({ GroupMembersButton: () => null }));
vi.mock('@/features/GroupMembership/DefaultGroupActions', () => ({ default: () => null }));
vi.mock('@/features/GroupMembership/AssistantActions', () => ({ default: () => null }));
vi.mock('@/features/NavPanel/NavPanelPortal', () => ({
  NavPanelPortal: ({ children }: any) => children,
}));
vi.mock('@/features/NavPanel/SideBarLayout', () => ({ default: ({ body }: any) => body }));
vi.mock('./GroupSwitcher', () => ({ default: ({ children }: any) => children }));
vi.mock('./RecentTopicLinks', () => ({ default: () => null }));

describe('joined group members', () => {
  it.each([
    ['/group/joined', true],
    ['/group/other', false],
    ['/group/joined/profile', false],
    ['/group/joined?topic=topic-1', false],
    ['/group/joined#topic%3Atopic-1', false],
    ['/tasks', false],
  ])('selects only the matching group home at %s', (route, selected) => {
    render(
      <MemoryRouter initialEntries={[route]}>
        <SuperGroupSidebarBody groupId="joined" />
      </MemoryRouter>,
    );
    const home = screen.getByRole('link', { name: '群组首页' });
    if (selected) expect(home).toHaveAttribute('aria-current', 'page');
    else expect(home).not.toHaveAttribute('aria-current');
  });
  it.each([false, true])(
    'shows the same people and AI structure (management=%s)',
    (manageDefaultGroup) => {
      render(
        <MemoryRouter>
          <SuperGroupSidebarBody
            groupId="joined"
            manageDefaultGroup={manageDefaultGroup}
            onSelectTopic={() => {}}
          />
        </MemoryRouter>,
      );
      fireEvent.click(screen.getByText('成员 6'));
      expect(screen.queryByRole('link', { name: /任务|tab.tasks/ })).toBeNull();
      expect(screen.getByText('群主账号')).toBeVisible();
      expect(screen.getByText('我的账号')).toBeVisible();
      expect(screen.getByText('旅游群主 AI')).toBeVisible();
      expect(screen.getByText('Codex')).toBeVisible();
      expect(screen.getByText('KIMI-K3')).toBeVisible();
      expect(screen.getByText('抖音文案专家')).toBeVisible();
    },
  );
});
