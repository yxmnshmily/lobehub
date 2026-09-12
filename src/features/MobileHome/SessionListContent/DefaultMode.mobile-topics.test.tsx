/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import WorkGroupSessions from '@/features/SuperGroup/WorkGroupSessions';
import MobileTopics from '@/routes/(main)/group/_layout/MobileTopics';

import DefaultMode from './DefaultMode';

const mobileTopicMocks = vi.hoisted(() => ({
  invitations: { items: [] as Array<{ invitationId: string }>, nextOffset: null as number | null },
  group: { clientId: 'default-travel-service-group', workspaceId: null as string | null },
  toggleMobileTopic: vi.fn(),
}));

vi.mock('@/store/agentGroup', () => ({
  useAgentGroupStore: (selector: (state: any) => unknown) =>
    selector({ activeGroupId: 'group-1', groupMap: { 'group-1': mobileTopicMocks.group } }),
}));
vi.mock('@/components/ImperativeModal', () => ({
  default: ({ children, title, open }: { children: ReactNode; title: ReactNode; open: boolean }) =>
    open ? (
      <div role="dialog">
        {title}
        {children}
      </div>
    ) : null,
}));
vi.mock('@/hooks/useWorkspaceModal', () => ({
  useWorkspaceModal: (open: boolean, onChange: (open: boolean) => void) => [open, onChange],
}));
vi.mock('@/routes/(main)/group/_layout/Sidebar/Topic/Actions', () => ({
  default: () => <button>更多话题操作</button>,
}));
vi.mock('@/routes/(main)/group/_layout/Sidebar/Topic/Filter', () => ({
  default: () => <button>筛选话题</button>,
}));
vi.mock('@/routes/(main)/group/_layout/Sidebar/Topic/List', () => ({
  default: () => <button>普通群话题</button>,
}));
vi.mock('@/store/chat/selectors', () => ({ topicSelectors: { currentTopicCount: () => 99 } }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { amount?: string }) =>
      key === 'superGroup.pendingInvitations'
        ? `你有 ${options?.amount} 条群组邀请`
        : {
            'defaultList': '默认列表',
            'pin': '置顶',
            'topic.recent': '最近话题',
            'superGroup.recentTopics': '最近 10 个话题',
            'superGroup.viewInvitations': '查看邀请',
          }[key] || key,
  }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => null,
}));
vi.mock('@/hooks/useFetchSessions', () => ({ useFetchSessions: vi.fn() }));
vi.mock('@/hooks/useMyTravelGroupReadiness', () => ({
  useMyTravelGroupReadiness: () => ({ status: 'ready', isEnabled: true }),
}));
vi.mock('@/features/HomeSidebar/Body/Agent/TravelGroupReadiness', () => ({ default: () => null }));
vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({ title }: { title: string }) => <span>{title}</span>,
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    groupMembership: {
      listMyPendingInvitations: { useQuery: () => ({ data: mobileTopicMocks.invitations }) },
    },
    groupConversation: {
      listGroups: {
        useQuery: () => ({
          data: [
            { groupId: 'group-1', kind: 'owner', isDefaultGroup: true },
            { groupId: 'joined-group', kind: 'member', ownerDisplayName: '张三' },
          ],
        }),
      },
      listTopics: {
        useQuery: (input: { groupId: string; recent: boolean; limit: number }) => {
          expect(input).toEqual({ groupId: 'group-1', recent: true, limit: 10 });
          return {
            data: {
              items: Array.from({ length: 12 }, (_, index) => ({
                id: `topic-${index + 1}`,
                title: index === 0 ? '西藏行程讨论' : `讨论 ${index + 1}`,
                createdAt: new Date(index + 1),
              })),
            },
          };
        },
      },
    },
  },
}));
vi.mock('@/libs/swr', () => ({
  useClientDataSWR: () => ({
    data: [
      {
        agentId: 'agent-1',
        icon: 'topic',
        id: 'topic-1',
        routePath: '/agent/agent-1/topic-1',
        status: null,
        title: '西藏行程讨论',
        type: 'topic',
        updatedAt: new Date('2026-09-05T00:00:00.000Z'),
      },
    ],
  }),
}));
vi.mock('@/libs/swr/useCacheScope', () => ({ useCacheScope: () => 'personal' }));
vi.mock('@/services/recent', () => ({
  recentService: { getAll: vi.fn() },
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: { updateSystemStatus: () => void }) => unknown) =>
    selector({
      updateSystemStatus: vi.fn(),
      toggleMobileTopic: mobileTopicMocks.toggleMobileTopic,
    } as any),
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: { topicDataMap: object }) => unknown) =>
    selector({ topicDataMap: {} }),
}));
vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: { sessionGroupKeys: () => () => [], mobileShowTopic: () => true },
}));
vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: { isMobile: boolean }) => unknown) =>
    selector({ isMobile: true }),
}));
vi.mock('@/store/serverConfig/selectors', () => ({
  serverConfigSelectors: { isMobile: (state: { isMobile: boolean }) => state.isMobile },
}));
vi.mock('@/store/session', () => ({
  useSessionStore: (selector: (state: object) => unknown) => selector({}),
}));
vi.mock('@/store/session/selectors', () => ({
  sessionSelectors: {
    customSessionGroups: () => [],
    defaultSessions: () => [],
    pinnedSessions: () => [],
  },
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { isLogin: boolean }) => unknown) => selector({ isLogin: true }),
}));
vi.mock('@/store/user/selectors', () => ({
  authSelectors: { isLogin: (state: { isLogin: boolean }) => state.isLogin },
}));
vi.mock('@/features/Workspace/WorkspaceLink', () => ({
  default: ({
    children,
    to,
    onClick,
  }: {
    children?: ReactNode;
    to: string;
    onClick?: () => void;
  }) => (
    <a href={to} onClick={onClick}>
      {children}
    </a>
  ),
}));
vi.mock('@/features/Home/Recents/Item', () => ({
  default: ({ title }: { title: string }) => <span>{title}</span>,
}));
vi.mock('./CollapseGroup', () => ({
  default: ({
    items,
  }: {
    items?: Array<{ children?: ReactNode; key: string; label?: ReactNode }>;
  }) => (
    <div>
      {items?.map((item) => (
        <section key={item.key}>
          <h2>{item.label}</h2>
          {item.children}
        </section>
      ))}
    </div>
  ),
}));
vi.mock('./CollapseGroup/Actions', () => ({ default: () => null }));
vi.mock('./Inbox', () => ({ default: () => null }));
vi.mock('./List', () => ({ default: () => null }));
vi.mock('./Modals/ConfigGroupModal', () => ({ default: () => null }));
vi.mock('./Modals/RenameGroupModal', () => ({ openRenameGroupModal: vi.fn() }));

describe('mobile home recent topics', () => {
  beforeEach(() => {
    mobileTopicMocks.invitations = { items: [], nextOffset: null };
    mobileTopicMocks.group = { clientId: 'default-travel-service-group', workspaceId: null };
    mobileTopicMocks.toggleMobileTopic.mockReset();
  });

  it('puts pending invitations before the group links and clears the notice when handled', () => {
    mobileTopicMocks.invitations.items = [{ invitationId: 'invite-1' }];
    const { rerender } = render(<WorkGroupSessions />);
    expect(screen.getByText('你有 1 条群组邀请')).toBeInTheDocument();
    expect(screen.getAllByRole('link')[0]).toHaveAttribute('href', '/settings/profile');
    expect(screen.getByRole('link', { name: /查看邀请/ })).toBeInTheDocument();
    mobileTopicMocks.invitations.items = [];
    rerender(<WorkGroupSessions />);
    expect(screen.queryByRole('link', { name: /查看邀请/ })).toBeNull();
  });

  it('opens only ten recent links in the default group history dialog and closes it on navigation', () => {
    render(<MobileTopics />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('最近 10 个话题')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(10);
    expect(screen.queryByText('讨论 11')).toBeNull();
    expect(screen.queryByRole('button', { name: '筛选话题' })).toBeNull();
    expect(screen.queryByRole('button', { name: '更多话题操作' })).toBeNull();
    const topic = screen.getByRole('link', { name: '西藏行程讨论' });
    expect(topic).toHaveAttribute('href', '/group/group-1/topic-1');
    fireEvent.click(topic);
    expect(mobileTopicMocks.toggleMobileTopic).toHaveBeenCalledWith(false);
  });

  it.each(['ordinary', 'workspace'])('keeps the existing %s group history controls', (kind) => {
    if (kind === 'ordinary') mobileTopicMocks.group.clientId = 'ordinary-group';
    else mobileTopicMocks.group.workspaceId = 'workspace-1';
    render(<MobileTopics />);
    expect(screen.getByRole('button', { name: '普通群话题' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '筛选话题' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更多话题操作' })).toBeInTheDocument();
  });

  it('shows a direct link back to each recent topic', () => {
    render(<DefaultMode />);

    expect(screen.getByText('最近 10 个话题')).toBeInTheDocument();
    expect(screen.queryByText('讨论 11')).toBeNull();
    expect(
      screen
        .getAllByRole('link')
        .filter(
          (link) =>
            link.getAttribute('href')?.includes('/topic-') &&
            link.textContent !== 'superGroup.ownGroup',
        ),
    ).toHaveLength(10);
    expect(screen.getByRole('link', { name: 'superGroup.ownGroup' })).toHaveAttribute(
      'href',
      '/group/group-1/topic-1',
    );
    expect(screen.getByRole('link', { name: '西藏行程讨论' })).toHaveAttribute(
      'href',
      '/group/group-1/topic-1',
    );
    expect(
      screen
        .getAllByRole('link')
        .every((link) => !link.getAttribute('href')?.startsWith('/agent/')),
    ).toBe(true);
  });
});
