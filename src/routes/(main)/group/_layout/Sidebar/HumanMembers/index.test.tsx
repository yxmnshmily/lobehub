/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HumanMembers from './index';

const mocks = vi.hoisted(() => ({
  activeGroupId: 'group-1' as string | undefined,
  confirmModal: vi.fn(({ onOk }: { onOk: () => Promise<void> }) => onOk()),
  createInvitation: vi.fn(),
  listMembers: {
    data: {
      items: [
        {
          avatar: null,
          canUsePaidAi: false,
          displayName: '锦绣',
          joinedAt: new Date('2026-09-04T00:00:00.000Z'),
          maxCreditsPerPeriod: null,
          maxCreditsPerRequest: null,
          memberUserId: 'member-1',
          membershipVersion: 3,
        },
      ],
      nextOffset: null,
    },
    isError: false,
    isLoading: false,
  },
  listPendingInvitations: {
    data: {
      items: [
        {
          expiresAt: new Date('2026-09-05T00:00:00.000Z'),
          invitationId: 'invite-1',
          maskedEmail: 'j***@qq.com',
          status: 'pending',
        },
      ],
      nextOffset: null,
    },
    isError: false,
    isLoading: false,
  },
  refetchMembers: vi.fn(),
  refetchPending: vi.fn(),
  refetchPolicy: vi.fn(),
  removeMember: vi.fn(),
  revokeInvitation: vi.fn(),
  sponsoredMutation: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  AccordionItem: ({ children, title }: { children: ReactNode; title: ReactNode }) => (
    <section>
      {title}
      {children}
    </section>
  ),
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Skeleton: () => <div data-testid="loading" />,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Avatar: ({ avatar, title }: { avatar?: string | null; title?: string }) => (
    <span aria-label={title}>{avatar}</span>
  ),
  Button: ({ children, htmlType, loading, ...props }: Record<string, unknown>) => {
    const { danger: _danger, type: _type, ...buttonProps } = props;
    return (
    <button
      disabled={Boolean(loading) || Boolean(buttonProps.disabled)}
      type={(htmlType as 'button' | 'submit' | 'reset') || 'button'}
      {...buttonProps}
    >
      {children as ReactNode}
    </button>
    );
  },
  Input: (props: Record<string, unknown>) => <input {...props} />,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  confirmModal: mocks.confirmModal,
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    groupMembership: {
      createInvitation: {
        useMutation: () => ({ isPending: false, mutateAsync: mocks.createInvitation }),
      },
      listMembers: {
        useQuery: () => ({ ...mocks.listMembers, refetch: mocks.refetchMembers }),
      },
      listPendingInvitations: {
        useQuery: () => ({ ...mocks.listPendingInvitations, refetch: mocks.refetchPending }),
      },
      removeMember: {
        useMutation: () => ({ isPending: false, mutateAsync: mocks.removeMember }),
      },
      revokeInvitation: {
        useMutation: () => ({ isPending: false, mutateAsync: mocks.revokeInvitation }),
      },
    },
    groupSponsoredCredit: {
      disablePolicy: {
        useMutation: () => ({ mutateAsync: mocks.sponsoredMutation }),
      },
      enablePolicy: {
        useMutation: () => ({ mutateAsync: mocks.sponsoredMutation }),
      },
      getOwnerPolicy: {
        useQuery: () => ({
          data: undefined,
          isError: true,
          isLoading: false,
          refetch: mocks.refetchPolicy,
        }),
      },
      revokeMemberPaidAi: {
        useMutation: () => ({ mutateAsync: mocks.sponsoredMutation }),
      },
      setMemberLimits: {
        useMutation: () => ({ mutateAsync: mocks.sponsoredMutation }),
      },
      updatePolicyLimit: {
        useMutation: () => ({ mutateAsync: mocks.sponsoredMutation }),
      },
    },
  },
}));

vi.mock('@/store/agentGroup', () => ({
  useAgentGroupStore: (selector: (state: { activeGroupId?: string }) => unknown) =>
    selector({ activeGroupId: mocks.activeGroupId }),
}));

vi.mock('@/store/agentGroup/selectors', () => ({
  agentGroupSelectors: {
    activeGroupId: (state: { activeGroupId?: string }) => state.activeGroupId,
  },
}));

describe('HumanMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeGroupId = 'group-1';
    mocks.listMembers.data = {
      items: [
        {
          avatar: null,
          canUsePaidAi: false,
          displayName: '锦绣',
          joinedAt: new Date('2026-09-04T00:00:00.000Z'),
          memberUserId: 'member-1',
          membershipVersion: 3,
        },
      ],
      nextOffset: null,
    };
    mocks.listMembers.isError = false;
    mocks.listMembers.isLoading = false;
    mocks.listPendingInvitations.data = {
      items: [
        {
          expiresAt: new Date('2026-09-05T00:00:00.000Z'),
          invitationId: 'invite-1',
          maskedEmail: 'j***@qq.com',
          status: 'pending',
        },
      ],
      nextOffset: null,
    };
    mocks.listPendingInvitations.isError = false;
    mocks.listPendingInvitations.isLoading = false;
  });

  it('lets the owner invite by email and only renders safe member fields', async () => {
    mocks.createInvitation.mockResolvedValue({
      expiresAt: new Date(),
      invitationId: 'invite-new',
      status: 'created',
      token: 'must-never-render',
    });
    render(<HumanMembers itemKey="human-members" />);

    expect(screen.getByText('真人成员 1')).toBeInTheDocument();
    expect(screen.getByText('锦绣')).toBeInTheDocument();
    expect(screen.getByText('j***@qq.com')).toBeInTheDocument();
    expect(screen.queryByText('member-1')).not.toBeInTheDocument();
    expect(screen.queryByText('invite-1')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('注册邮箱'), { target: { value: ' User@QQ.com ' } });
    fireEvent.click(screen.getByRole('button', { name: '发送邀请' }));

    await waitFor(() =>
      expect(mocks.createInvitation).toHaveBeenCalledWith({
        email: 'User@QQ.com',
        groupId: 'group-1',
      }),
    );
    expect(screen.queryByText('must-never-render')).not.toBeInTheDocument();
    expect(mocks.refetchMembers).toHaveBeenCalledTimes(1);
    expect(mocks.refetchPending).toHaveBeenCalledTimes(1);
  });

  it('revokes pending invitations and removes members with server-bound identifiers', async () => {
    mocks.revokeInvitation.mockResolvedValue({ status: 'revoked' });
    mocks.removeMember.mockResolvedValue({ status: 'removed' });
    render(<HumanMembers itemKey="human-members" />);

    fireEvent.click(screen.getByRole('button', { name: '撤销 j***@qq.com 的邀请' }));
    await waitFor(() =>
      expect(mocks.revokeInvitation).toHaveBeenCalledWith({
        groupId: 'group-1',
        invitationId: 'invite-1',
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: '移除 锦绣' }));
    await waitFor(() =>
      expect(mocks.removeMember).toHaveBeenCalledWith({
        expectedMembershipVersion: 3,
        groupId: 'group-1',
        memberUserId: 'member-1',
      }),
    );
    expect(mocks.confirmModal).toHaveBeenCalledTimes(2);
  });

  it('fails closed to a neutral empty state without guessing the viewer role', () => {
    mocks.listMembers.data = undefined as never;
    mocks.listMembers.isError = true;
    mocks.listPendingInvitations.data = undefined as never;
    mocks.listPendingInvitations.isError = true;

    render(<HumanMembers itemKey="human-members" />);

    expect(screen.getByText('真人成员管理暂不可用')).toBeInTheDocument();
    expect(screen.queryByLabelText('注册邮箱')).not.toBeInTheDocument();
    expect(screen.queryByText(/群主|权限|成员身份/)).not.toBeInTheDocument();
  });
});
