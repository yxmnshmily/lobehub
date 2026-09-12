import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MemberPanel from './MemberPanel';

vi.mock('./DefaultGroupActions', () => ({
  default: ({ groupId, addOnly, onUpdated }: any) => (
    <button data-add-only={addOnly} data-group={groupId} onClick={onUpdated}>
      添加成员
    </button>
  ),
}));

vi.mock('./AssistantActions', () => ({
  default: ({ onUpdated }: any) => (
    <section aria-label="Member row actions">
      <button onClick={onUpdated}>Finish member sync</button>
    </section>
  ),
}));
vi.mock('@/store/agentGroup', () => ({
  useAgentGroupStore: { getState: () => ({ refreshGroupDetail: mocks.refreshDetail }) },
}));

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  confirm: vi.fn(),
  invite: vi.fn(),
  leave: vi.fn(),
  remove: vi.fn(),
  navigate: vi.fn(),
  refetch: vi.fn(),
  refreshDetail: vi.fn(),
  invalidateGroups: vi.fn(),
  data: {
    assistants: [
      {
        id: 'writer',
        title: 'Writer',
        subtitle: 'Travel copywriter',
        avatar: null,
        description: 'Writes travel content',
        isSupervisor: true,
      },
    ],
    viewerRole: 'owner',
    viewerMembershipVersion: 0,
    nextOffset: null as number | null,
    items: [
      {
        avatar: null,
        displayName: 'Owner',
        memberUserId: 'owner',
        membershipVersion: 0,
        role: 'owner',
      },
      {
        avatar: null,
        displayName: 'Visitor',
        memberUserId: 'visitor',
        membershipVersion: 7,
        role: 'member',
      },
    ],
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_: string, options: any) => options?.defaultValue || _ }),
}));
vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  confirmModal: mocks.confirm,
  useModalContext: () => ({ close: mocks.close }),
}));
vi.mock('@/hooks/useQueryRoute', () => ({ useQueryRoute: () => ({ push: mocks.navigate }) }));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    useUtils: () => ({ groupConversation: { listGroups: { invalidate: mocks.invalidateGroups } } }),
    groupMembership: {
      listParticipants: {
        useQuery: () => ({
          data: mocks.data,
          refetch: mocks.refetch,
          isLoading: false,
          isError: false,
        }),
      },
      createInvitation: { useMutation: () => ({ mutateAsync: mocks.invite }) },
      leaveGroup: { useMutation: () => ({ mutateAsync: mocks.leave }) },
      removeMember: { useMutation: () => ({ mutateAsync: mocks.remove }) },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.data.viewerRole = 'owner';
  mocks.data.viewerMembershipVersion = 0;
  mocks.invite.mockResolvedValue({ status: 'created' });
  mocks.remove.mockResolvedValue({ status: 'removed' });
  mocks.leave.mockResolvedValue({ status: 'left' });
});
afterEach(cleanup);

describe('super group members', () => {
  it('shows and searches the occupation independently of the member name', () => {
    render(<MemberPanel groupId="group-1" />);
    expect(screen.getByRole('button', { name: 'Writer' })).toHaveTextContent('Travel copywriter');
    fireEvent.change(screen.getByPlaceholderText('Search assistants'), {
      target: { value: 'copywriter' },
    });
    expect(screen.getByRole('button', { name: 'Writer' })).toBeVisible();
  });
  it.each([false, true])(
    'shows the supervisor badge in member and management views (%s)',
    (manageDefaultGroup) => {
      render(<MemberPanel groupId="group-1" manageDefaultGroup={manageDefaultGroup} />);
      expect(screen.getByRole('button', { name: 'Writer' })).toHaveTextContent('主管');
    },
  );
  it('refreshes both the member panel and active group after a published change', async () => {
    render(<MemberPanel manageDefaultGroup groupId="group-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Finish member sync' }));
    await waitFor(() => expect(mocks.refetch).toHaveBeenCalled());
  });
  it('only mounts default group management in an explicit default-group context', () => {
    const view = render(<MemberPanel groupId="group-1" />);
    expect(screen.queryByRole('region', { name: 'Member row actions' })).toBeNull();
    view.rerender(<MemberPanel manageDefaultGroup groupId="group-1" />);
    expect(screen.getByRole('region', { name: 'Member row actions' })).toBeTruthy();
  });
  it('shows assistant information without a private chat or assistant management action', () => {
    render(<MemberPanel groupId="group-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Writer' }));
    expect(screen.getByText('Writes travel content')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText('Add assistant')).toBeNull();
    expect(screen.queryByText('Leave group')).toBeNull();
  });
  it('uses the existing default assistant avatar when the roster has no custom image', () => {
    render(<MemberPanel groupId="group-1" />);
    expect(screen.getByRole('button', { name: 'Writer' }).querySelector('img')).toHaveAttribute(
      'src',
      '/avatars/agent-default.png',
    );
  });
  it.each(['guest@example.com', 'user_invitation_test'])(
    'invites by %s but does not automatically add the invited person',
    async (contact) => {
      render(<MemberPanel groupId="group-1" />);
      fireEvent.change(screen.getByRole('textbox', { name: 'User ID, phone number or email' }), {
        target: { value: contact },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
      await waitFor(() =>
        expect(mocks.invite).toHaveBeenCalledWith({ contact, groupId: 'group-1' }),
      );
      expect(
        await screen.findByText('Invitation sent. They will join after accepting.'),
      ).toBeTruthy();
    },
  );
  it('accepts a phone number directly and blocks duplicate submissions while pending', async () => {
    mocks.invite.mockReturnValue(new Promise(() => {}));
    render(<MemberPanel groupId="group-1" />);
    const input = screen.getByRole('textbox', { name: 'User ID, phone number or email' });
    fireEvent.change(input, { target: { value: '+86 13800138000' } });
    fireEvent.submit(input.closest('form')!);
    fireEvent.submit(input.closest('form')!);
    expect(mocks.invite).toHaveBeenCalledTimes(1);
    expect(mocks.invite).toHaveBeenCalledWith({ contact: '+86 13800138000', groupId: 'group-1' });
  });
  it('only lets the owner remove human members, using the current membership version', async () => {
    render(<MemberPanel groupId="group-1" />);
    expect(screen.getAllByRole('button', { name: 'Remove member' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Remove member' }));
    await act(mocks.confirm.mock.calls[0][0].onOk);
    expect(mocks.remove).toHaveBeenCalledWith({
      expectedMembershipVersion: 7,
      groupId: 'group-1',
      memberUserId: 'visitor',
    });
  });
  it('lets a visitor leave with explicit personal history cleanup and no owner controls', async () => {
    mocks.data.viewerRole = 'member';
    mocks.data.viewerMembershipVersion = 7;
    render(<MemberPanel groupId="group-1" />);
    expect(screen.queryByRole('button', { name: 'Remove member' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'User ID, phone number or email' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Leave group' }));
    expect(mocks.confirm.mock.calls[0][0].content).toContain('Other members');
    await act(mocks.confirm.mock.calls[0][0].onOk);
    expect(mocks.leave).toHaveBeenCalledWith({ groupId: 'group-1', expectedMembershipVersion: 7 });
    expect(mocks.invalidateGroups).toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith('/group/default', { replace: true });
  });
});

it('adds the member menu beside AI members and refreshes the same group after completion', async () => {
  render(<MemberPanel manageDefaultGroup groupId="group-1" />);
  const button = screen.getByRole('button', { name: '添加成员' });
  expect(button).toHaveAttribute('data-group', 'group-1');
  expect(button).toHaveAttribute('data-add-only', 'true');
  fireEvent.click(button);
  await waitFor(() => expect(mocks.refetch).toHaveBeenCalled());
});
