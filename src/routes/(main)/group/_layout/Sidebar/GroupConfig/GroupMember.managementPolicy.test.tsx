/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import GroupMember from './GroupMember';

const fixture = vi.hoisted(() => ({ managed: false }));

vi.mock('@/features/GroupMembership/useMemberSidebar', () => ({
  useMemberSidebar: () => ({ arrange: (items: unknown[]) => items }),
}));
vi.mock('@/features/GroupMembership/AssistantActions', () => ({
  default: () => <button>template member menu</button>,
}));
vi.mock('@/features/GroupMembership/AssistantMenu', () => ({
  default: ({ onRemove }: any) => (
    <button onClick={onRemove}>groupSidebar.members.removeMember</button>
  ),
}));

vi.mock('@lobechat/types', () => ({
  DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID: 'travel-default',
  agentDisplayName: (agent: { title: string }) => agent.title,
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Popover: ({ children, content }: { children: ReactNode; content: ReactNode }) => (
    <div>
      {children}
      {content}
    </div>
  ),
  ActionIcon: ({ title }: { title?: string }) => <button>{title}</button>,
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({ memberTrigger: 'member-trigger' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/AgentProfileCard/AgentProfilePopup', () => ({
  default: ({ children, agent }: { children: ReactNode; agent: { description?: string } }) => (
    <div aria-label="完整成员档案">
      {children}
      <span>{agent.description}</span>
    </div>
  ),
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
          clientId: fixture.managed ? 'travel-default' : null,
          workspaceId: null,
          agents: [
            {
              avatar: '🌏',
              description: '协调群内分工与秩序',
              id: 'supervisor-1',
              isSupervisor: true,
              title: '旅游群主',
              virtual: true,
            },
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
      (groupId: string) => (state: { groupMap: Record<string, { agents: unknown[] }> }) =>
        state.groupMap[groupId].agents.filter((agent: any) => !agent.isSupervisor),
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
  beforeEach(() => {
    fixture.managed = false;
  });

  it('shows the actual supervisor instead of the account placeholder only in a default supergroup', () => {
    fixture.managed = true;
    render(
      <GroupMember
        addModalOpen={false}
        canManage={false}
        groupId="group-1"
        onAddModalOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByText('旅游群主')).toBeInTheDocument();
    expect(screen.getAllByLabelText('完整成员档案')).toHaveLength(2);
    expect(screen.getByText('协调群内分工与秩序')).toBeInTheDocument();
    expect(screen.queryByText('Owner')).not.toBeInTheDocument();
    expect(screen.getByText('Member 1')).toBeInTheDocument();
  });

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

  it('keeps default group membership mutations in the existing dedicated controls', () => {
    fixture.managed = true;
    render(<GroupMember addModalOpen canManage groupId="group-1" onAddModalOpenChange={vi.fn()} />);

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
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.queryByText('旅游群主')).not.toBeInTheDocument();
  });
});
