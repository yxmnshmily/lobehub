import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SuperGroupSidebarBody } from './JoinedGroupSidebar';

vi.mock('@/features/GroupMembership/useMemberSidebar', () => ({
  useMemberSidebar: () => ({ arrange: (items: unknown[]) => items, category: () => undefined }),
}));
vi.mock('@/features/GroupMembership/AssistantActions', () => ({ default: () => null }));

vi.mock('@/hooks/usePrefetchGroup', () => ({ usePrefetchGroup: () => vi.fn() }));

const state = vi.hoisted(() => ({ status: { showLeftPanel: false } }));
vi.mock('@/store/global', () => ({ useGlobalStore: (selector: any) => selector(state) }));
vi.mock('@/store/agentGroup', () => ({
  useAgentGroupStore: (selector: any) => selector({ activeGroupId: 'joined' }),
}));
vi.mock('@/store/user', () => ({ useUserStore: () => true }));
vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => undefined,
}));
vi.mock('@/hooks/useActiveLocation', () => ({
  useActiveLocation: () => ({ pathname: '/group/joined' }),
}));
vi.mock('@/hooks/useQueryRoute', () => ({ useQueryRoute: () => ({ push: vi.fn() }) }));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    groupConversation: {
      listGroups: {
        useQuery: () => ({
          data: [{ groupId: 'joined', kind: 'member', ownerDisplayName: '小王' }],
        }),
      },
    },
    groupMembership: {
      listMyPendingInvitations: {
        useQuery: () => ({ data: { items: [], nextOffset: null } }),
      },
      listParticipants: {
        useQuery: () => ({ data: { items: [], assistants: [], nextOffset: null } }),
      },
    },
  },
}));
vi.mock('@/features/GroupMembership', () => ({ GroupMembersButton: () => null }));
vi.mock('@/features/GroupMembership/DefaultGroupActions', () => ({ default: () => null }));
vi.mock('./RecentTopicLinks', () => ({ default: () => null }));
vi.mock('./GroupTaskLink', () => ({ default: () => null }));

describe('desktop group sidebar collapse', () => {
  it('uses icon menus in the collapsed rail and restores the full list when expanded', () => {
    const { rerender } = render(<SuperGroupSidebarBody groupId="joined" />);
    expect(screen.queryByText('我加入的群')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '切换群组' })).toBeVisible();
    expect(screen.getByRole('button', { name: '成员' })).toBeVisible();
    expect(screen.getByRole('button', { name: '话题' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '切换群组' }));
    expect(screen.getByRole('button', { name: '切换群组', hidden: true })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    state.status.showLeftPanel = true;
    rerender(<SuperGroupSidebarBody groupId="joined" />);
    expect(screen.queryByRole('button', { name: '切换群组' })).not.toBeInTheDocument();
    expect(screen.getByText('我加入的群')).toBeVisible();
  });
});
