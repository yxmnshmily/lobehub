/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import GroupMember from './GroupMember';

vi.mock('@lobechat/types', () => ({
  agentDisplayName: (agent: { title: string }) => agent.title,
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  ActionIcon: ({ title }: { title?: string }) => <button>{title}</button>,
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({ memberTrigger: 'member-trigger' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/AgentProfileCard/AgentProfilePopup', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({ title }: { title: ReactNode }) => <div>{title}</div>,
}));

vi.mock('@/features/ResourcePermission/useResourceAccess', () => ({
  useResourceAccess: () => ({ canEditResource: true }),
}));

vi.mock('@/features/User/UserAvatar', () => ({ default: () => <span>User</span> }));

vi.mock('@/hooks/useActiveLocation', () => ({
  useActiveLocation: () => ({ pathname: '/group/group-1', search: '' }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true, reason: 'forbidden' }),
}));

vi.mock('@/hooks/useQueryRoute', () => ({ useQueryRoute: () => ({ push: vi.fn() }) }));

vi.mock('@/store/agentGroup', () => ({
  useAgentGroupStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      addAgentsToGroup: vi.fn(),
      groupMap: {
        'group-1': {
          agents: [
            {
              avatar: '🤖',
              backgroundColor: null,
              id: 'agent-1',
              isSupervisor: false,
              title: 'Member 1',
              virtual: true,
            },
          ],
        },
      },
      removeAgentFromGroup: vi.fn(),
    }),
}));

vi.mock('@/store/agentGroup/selectors', () => ({
  agentGroupSelectors: {
    getGroupMembers:
      (groupId: string) =>
      (state: { groupMap: Record<string, { agents: unknown[] }> }) =>
        state.groupMap[groupId].agents,
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { nickname: string; username: string }) => unknown) =>
    selector({ nickname: 'Owner', username: 'owner' }),
}));

vi.mock('@/store/user/slices/auth/selectors', () => ({
  userProfileSelectors: {
    nickName: (state: { nickname: string }) => state.nickname,
    username: (state: { username: string }) => state.username,
  },
}));

vi.mock('../AddGroupMemberModal', () => ({
  default: () => <div data-testid="add-group-member-modal" />,
}));

vi.mock('./GroupMemberItem', () => ({
  default: ({ actions, title }: { actions?: ReactNode; title: string }) => (
    <div>
      {title}
      {actions}
    </div>
  ),
}));

vi.mock('./useRemoveGroupMember', () => ({
  useRemoveGroupMember: () => ({ confirmRemoveMember: vi.fn(), removingMemberIds: [] }),
}));

describe('GroupMember management policy', () => {
  it('renders managed-group membership as read-only for an ordinary user', () => {
    render(
      <GroupMember
        addModalOpen={false}
        canManage={false}
        groupId="group-1"
        onAddModalOpenChange={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'groupSidebar.members.removeMember' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('add-group-member-modal')).not.toBeInTheDocument();
  });

  it('keeps member mutations for an authorized group manager', () => {
    render(
      <GroupMember
        canManage
        addModalOpen={false}
        groupId="group-1"
        onAddModalOpenChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'groupSidebar.members.removeMember' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('add-group-member-modal')).toBeInTheDocument();
  });
});
