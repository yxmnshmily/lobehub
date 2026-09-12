import type * as LobeUIBase from '@lobehub/ui/base-ui';
import { focusManager, QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GroupInvitations from './GroupInvitations';

const mocks = vi.hoisted(() => ({
  useGroupsQuery: vi.fn(),
  useInvitationsQuery: vi.fn(),
  acceptInvitation: vi.fn(),
  confirmModal: vi.fn(),
  invitationsQuery: {
    data: undefined as
      | {
          items: Array<{
            avatar: string | null;
            billingMode?: 'automatic_owner';
            expiresAt: Date;
            groupId: string;
            invitationId: string;
            sponsorship: {
              billingResponsibility: 'group_owner' | null;
              maxCreditsPerPeriod: number | null;
              maxCreditsPerRequest: number | null;
            };
            title: string | null;
          }>;
        }
      | undefined,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  },
  groupsQuery: {
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
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  },
  leaveGroup: vi.fn(),
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof LobeUIBase>()),
  confirmModal: mocks.confirmModal,
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    groupConversation: {
      listGroups: {
        useQuery: mocks.useGroupsQuery,
      },
    },
    groupMembership: {
      acceptMyInvitation: {
        useMutation: () => ({ isPending: false, mutateAsync: mocks.acceptInvitation }),
      },
      leaveGroup: { useMutation: () => ({ isPending: false, mutateAsync: mocks.leaveGroup }) },
      listMyPendingInvitations: {
        useQuery: mocks.useInvitationsQuery,
      },
    },
  },
}));

beforeEach(() => {
  mocks.useGroupsQuery.mockImplementation(() => mocks.groupsQuery);
  mocks.useInvitationsQuery.mockImplementation(() => mocks.invitationsQuery);
  mocks.acceptInvitation.mockReset().mockResolvedValue({ status: 'accepted' });
  mocks.leaveGroup.mockReset().mockResolvedValue({ status: 'left' });
  mocks.confirmModal.mockReset();
  Object.assign(mocks.invitationsQuery, {
    data: {
      items: [
        {
          avatar: 'https://example.test/invited.png',
          expiresAt: new Date('2026-09-10T08:00:00.000Z'),
          groupId: 'group-invited',
          invitationId: 'invitation-1',
          sponsorship: {
            billingResponsibility: 'group_owner',
            maxCreditsPerPeriod: 3000,
            maxCreditsPerRequest: 500,
          },
          title: '西藏文案协作群',
        },
      ],
    },
    isError: false,
    isLoading: false,
  });
  Object.assign(mocks.groupsQuery, {
    data: [
      {
        avatar: null,
        groupId: 'group-member',
        joinedAt: new Date('2026-09-01T08:00:00.000Z'),
        kind: 'member',
        membershipVersion: 7,
        resourceOwnerUserId: 'must-not-render-owner-id',
        title: '四川旅游协作群',
      },
      {
        avatar: null,
        groupId: 'group-owner',
        joinedAt: null,
        kind: 'owner',
        membershipVersion: 0,
        resourceOwnerUserId: 'current-user-id',
        title: '我的默认旅游群',
      },
    ],
    isError: false,
    isLoading: false,
  });
  mocks.invitationsQuery.refetch.mockReset().mockResolvedValue(undefined);
  mocks.groupsQuery.refetch.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

const renderGroupInvitations = () =>
  render(
    <MemoryRouter>
      <GroupInvitations locale="zh-CN" />
    </MemoryRouter>,
  );

describe('GroupInvitations', () => {
  it('removes a departed group within one refresh period and refreshes handled invitations on focus', async () => {
    vi.useFakeTimers();
    mocks.useGroupsQuery.mockImplementation(function useGroupsQuery(
      _input: unknown,
      options: object,
    ) {
      return useQuery({
        queryKey: ['member-groups'],
        queryFn: async () => mocks.groupsQuery.data,
        ...options,
      });
    });
    mocks.useInvitationsQuery.mockImplementation(function useInvitationsQuery(
      _input: unknown,
      options: object,
    ) {
      return useQuery({
        queryKey: ['pending-invitations'],
        queryFn: async () => mocks.invitationsQuery.data,
        ...options,
      });
    });
    focusManager.setFocused(true);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <GroupInvitations locale="zh-CN" />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(screen.getByRole('link', { name: '进入四川旅游协作群群聊' })).toBeInTheDocument();
      mocks.groupsQuery.data = mocks.groupsQuery.data!.filter(({ kind }) => kind === 'owner');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_010);
      });
      expect(screen.queryByRole('link', { name: '进入四川旅游协作群群聊' })).toBeNull();
      expect(screen.getByRole('link', { name: '进入我的默认旅游群群聊' })).toBeInTheDocument();
      focusManager.setFocused(false);
      mocks.invitationsQuery.data = { items: [] };
      await act(async () => {
        focusManager.setFocused(true);
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(screen.queryByRole('button', { name: '接受西藏文案协作群的邀请' })).toBeNull();
    } finally {
      cleanup();
      client.clear();
      focusManager.setFocused(undefined);
      vi.useRealTimers();
    }
  });

  it('provides safe chat links for owner and member groups without exposing group identifiers', () => {
    renderGroupInvitations();

    expect(screen.getByText('西藏文案协作群')).toBeTruthy();
    expect(screen.getByText('四川旅游协作群')).toBeTruthy();
    expect(screen.getByText('我的默认旅游群')).toBeTruthy();
    expect(screen.getByRole('button', { name: '接受西藏文案协作群的邀请' })).toBeTruthy();
    expect(screen.getByText('费用由群主承担')).toBeTruthy();
    expect(screen.getByText('单次 500 / 周期 3000 积分')).toBeTruthy();
    expect(screen.getByRole('button', { name: '退出四川旅游协作群' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '退出我的默认旅游群' })).toBeNull();
    expect(screen.getByRole('link', { name: '进入四川旅游协作群群聊' })).toHaveAttribute(
      'href',
      '/group/group-member',
    );
    expect(screen.getByRole('link', { name: '进入我的默认旅游群群聊' })).toHaveAttribute(
      'href',
      '/group/group-owner',
    );
    expect(screen.queryByText('group-member')).toBeNull();
    expect(screen.queryByText('group-owner')).toBeNull();
    expect(document.body.textContent).not.toMatch(
      /must-not-render-owner-id|current-user-id|token|hash|余额|模型设置/iu,
    );
    expect(document.body.textContent).not.toMatch(/account|policyVersion|resourceOwnerUserId/iu);
  });

  it('fails closed when an invitation does not include a valid owner-sponsored snapshot', () => {
    const invitation = mocks.invitationsQuery.data!.items[0];
    invitation.sponsorship = {
      billingResponsibility: null,
      maxCreditsPerPeriod: null,
      maxCreditsPerRequest: null,
    };

    renderGroupInvitations();

    expect(screen.getByText('AI任务未开放')).toBeTruthy();
    expect(screen.queryByText('费用由群主承担')).toBeNull();
  });

  it('shows automatic owner billing without manual limits for default supergroup invitations', () => {
    const invitation = mocks.invitationsQuery.data!.items[0];
    invitation.billingMode = 'automatic_owner';
    invitation.sponsorship = {
      billingResponsibility: null,
      maxCreditsPerPeriod: null,
      maxCreditsPerRequest: null,
    };

    renderGroupInvitations();

    expect(screen.getByText('群内实际 Token 消耗自动计入群所属账号，无需设置代付。')).toBeTruthy();
    expect(screen.queryByText('AI任务未开放')).toBeNull();
    expect(screen.queryByText(/单次 .*周期/u)).toBeNull();
  });

  it('does not ask default supergroup invitees to repair manual sponsorship on conflict', async () => {
    mocks.invitationsQuery.data!.items[0].billingMode = 'automatic_owner';
    mocks.acceptInvitation.mockRejectedValueOnce({ data: { code: 'CONFLICT' } });
    renderGroupInvitations();

    fireEvent.click(screen.getByRole('button', { name: '接受西藏文案协作群的邀请' }));

    expect(
      await screen.findByText('邀请状态已变更，请刷新后重试或联系群主重新邀请。'),
    ).toBeTruthy();
    expect(screen.queryByText('邀请中的代付设置已变更，请群主重新邀请。')).toBeNull();
  });

  it('accepts the listed invitation id and refreshes both invitations and accessible groups', async () => {
    renderGroupInvitations();

    fireEvent.click(screen.getByRole('button', { name: '接受西藏文案协作群的邀请' }));

    await waitFor(() =>
      expect(mocks.acceptInvitation).toHaveBeenCalledWith({ invitationId: 'invitation-1' }),
    );
    expect(mocks.invitationsQuery.refetch).toHaveBeenCalledOnce();
    expect(mocks.groupsQuery.refetch).toHaveBeenCalledOnce();
  });

  it('asks the owner to re-invite when the sponsorship snapshot conflicts', async () => {
    mocks.acceptInvitation.mockRejectedValueOnce({ data: { code: 'CONFLICT' } });
    renderGroupInvitations();

    fireEvent.click(screen.getByRole('button', { name: '接受西藏文案协作群的邀请' }));

    expect(await screen.findByText('邀请中的代付设置已变更，请群主重新邀请。')).toBeTruthy();
    expect(mocks.invitationsQuery.refetch).not.toHaveBeenCalled();
    expect(mocks.groupsQuery.refetch).not.toHaveBeenCalled();
  });

  it('requires confirmation before leaving a member group with its current membership version', async () => {
    renderGroupInvitations();

    fireEvent.click(screen.getByRole('button', { name: '退出四川旅游协作群' }));
    expect(mocks.confirmModal).toHaveBeenCalledOnce();

    const options = mocks.confirmModal.mock.calls[0][0] as { onOk: () => Promise<void> };
    await act(options.onOk);

    expect(mocks.leaveGroup).toHaveBeenCalledWith({
      expectedMembershipVersion: 7,
      groupId: 'group-member',
    });
    expect(mocks.groupsQuery.refetch).toHaveBeenCalledOnce();
  });

  it('keeps invitation and group failures independently retryable', () => {
    Object.assign(mocks.invitationsQuery, { data: undefined, isError: true });
    Object.assign(mocks.groupsQuery, { data: undefined, isError: true });

    renderGroupInvitations();
    const retryButtons = screen.getAllByRole('button', { name: '重试' });
    expect(retryButtons).toHaveLength(2);

    fireEvent.click(retryButtons[0]);
    fireEvent.click(retryButtons[1]);
    expect(mocks.invitationsQuery.refetch).toHaveBeenCalledOnce();
    expect(mocks.groupsQuery.refetch).toHaveBeenCalledOnce();
  });
});
