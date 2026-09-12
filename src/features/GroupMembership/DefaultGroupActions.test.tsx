/** @vitest-environment happy-dom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import AddMemberMenu from './AddMemberMenu';
import DefaultGroupActions, { DefaultGroupSortPanel } from './DefaultGroupActions';
import { GroupLinkPanel } from './GroupShareButton';

const mocks = vi.hoisted(() => ({
  admin: true,
  createLink: vi.fn(),
  revokeLinks: vi.fn(),
  copy: vi.fn(),
  modal: vi.fn(),
  refresh: vi.fn(),
  save: vi.fn(),
  refetch: vi.fn(),
  openCreate: vi.fn(),
  navigate: vi.fn(),
  close: vi.fn(),
}));
vi.mock('@/features/HomeSidebar/Body/Agent/ModalProvider', () => ({
  AgentModalProvider: ({ children }: any) => children,
  useAgentModal: () => ({ openCreateModal: mocks.openCreate }),
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));
vi.mock('antd', () => ({ QRCode: ({ value }: any) => <div data-testid="qr">{value}</div> }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@lobehub/ui', () => ({
  copyToClipboard: mocks.copy,
  Input: (props: any) => <input {...props} />,
  Flexbox: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  ActionIcon: ({ onClick, disabled, 'aria-label': label }: any) => (
    <button aria-label={label} disabled={disabled} onClick={onClick} />
  ),
  Alert: ({ title }: any) => <p>{title}</p>,
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  DropdownMenu: ({ items, children }: any) => (
    <div>
      {children}
      {items.map((item: any) => (
        <button disabled={item.disabled} key={item.key} onClick={item.onClick}>
          {item.label}
        </button>
      ))}
    </div>
  ),
  Skeleton: () => null,
  confirmModal: ({ onOk }: any) => onOk(),
  createModal: mocks.modal,
  useModalContext: () => ({ close: mocks.close }),
}));
vi.mock('@/business/client/BusinessSettingPages/SuperGroupTemplateSection', () => ({
  default: () => null,
}));
vi.mock('@/store/agentGroup', () => ({
  useAgentGroupStore: { getState: () => ({ refreshGroupDetail: mocks.refresh }) },
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    groupMembership: {
      wechatShareConfig: { useQuery: () => ({ isError: true }) },
      listParticipants: { useQuery: () => ({ data: { viewerRole: 'owner' } }) },
      createInvitationLink: {
        useMutation: () => ({ mutateAsync: mocks.createLink, isPending: false }),
      },
      revokeInvitationLinks: {
        useMutation: () => ({ mutateAsync: mocks.revokeLinks, isPending: false }),
      },
    },
    platformAccess: { isPlatformAdmin: { useQuery: () => ({ data: mocks.admin }) } },
    platformOperations: {
      getSuperGroupTemplate: {
        useQuery: () => ({
          data: {
            members: [
              { key: 'a', title: '成员 A' },
              { key: 'b', title: '成员 B' },
            ],
          },
          refetch: mocks.refetch,
        }),
      },
      reorderSuperGroupTemplateMembers: {
        useMutation: () => ({ mutateAsync: mocks.save, isPending: false }),
      },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.admin = true;
  mocks.save.mockResolvedValue({ syncedGroupCount: 8 });
  mocks.copy.mockResolvedValue(undefined);
  mocks.createLink.mockResolvedValue({ token: 'a'.repeat(43) });
  mocks.revokeLinks.mockResolvedValue({ status: 'revoked' });
});
it('keeps both controls visible but prevents ordinary users from opening global editors', () => {
  mocks.admin = false;
  render(<DefaultGroupActions groupId="g1" />);
  expect(screen.getByRole('button', { name: '添加成员' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '成员排序' })).toBeDisabled();
});
it('sends the reordered full roster to the global publication endpoint', async () => {
  render(<DefaultGroupSortPanel groupId="g1" />);
  fireEvent.click(screen.getByRole('button', { name: '下移第 1 位成员' }));
  fireEvent.click(screen.getByRole('button', { name: '同步成员顺序' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已同步到 8 个默认群'));
  expect(mocks.save).toHaveBeenCalledWith({ keys: ['b', 'a'] });
  expect(mocks.refresh).toHaveBeenCalledWith('g1');
});
it('automatically generates one invitation in StrictMode and only shows the copy action', async () => {
  window.history.replaceState(null, '', '/lobehub/group/g1/profile');
  render(
    <StrictMode>
      <GroupLinkPanel groupId="g1" />
    </StrictMode>,
  );
  await screen.findByRole('button', { name: 'groupInvitation.copy' });
  fireEvent.click(screen.getByRole('button', { name: 'groupInvitation.copy' }));
  const expected = `${window.location.origin}/lobehub/group-invite?token=${'a'.repeat(43)}`;
  await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith(expected));
  expect(screen.getByTestId('qr')).toHaveTextContent(expected);
  expect(mocks.createLink).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'groupInvitation.createAnother' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'groupInvitation.revoke' })).toBeNull();
});

it('keeps invitation copying available if WeChat SDK configuration fails', async () => {
  const agent = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('MicroMessenger');
  try {
    render(<GroupLinkPanel groupId="g1" />);
    await screen.findByText('groupInvitation.wechatFailed');
    fireEvent.click(screen.getByRole('button', { name: 'groupInvitation.copy' }));
    await waitFor(() => expect(mocks.copy).toHaveBeenCalled());
    expect(screen.getByTestId('qr')).toBeInTheDocument();
  } finally {
    agent.mockRestore();
  }
});

it.each([true, false])(
  'keeps add-from-list behind the existing administrator gate (%s)',
  (admin) => {
    mocks.admin = admin;
    render(<DefaultGroupActions addAsMenu groupId="g1" />);
    const add = screen.getByRole('button', { name: '从助理列表添加' });
    fireEvent.click(add);
    if (admin)
      expect(mocks.modal).toHaveBeenCalledWith(expect.objectContaining({ title: '添加成员' }));
    else {
      expect(add).toBeDisabled();
      expect(mocks.modal).not.toHaveBeenCalled();
    }
  },
);

it('opens the existing assistant creation dialog without confusing a chat group with a sidebar folder', () => {
  render(<DefaultGroupActions addAsMenu groupId="g1" />);
  fireEvent.click(screen.getByRole('button', { name: '创建助理' }));
  expect(mocks.openCreate).toHaveBeenCalledWith('agent');
  expect(mocks.navigate).not.toHaveBeenCalled();
});

it('opens the local assistant market from the member menu', () => {
  render(<DefaultGroupActions addAsMenu groupId="g1" />);
  fireEvent.click(screen.getByRole('button', { name: '从市场添加助理' }));
  expect(mocks.navigate).toHaveBeenCalledWith('/community/agent');
  expect(mocks.close).toHaveBeenCalled();
});

it('keeps both new actions behind the existing administrator gate', () => {
  mocks.admin = false;
  render(<DefaultGroupActions addAsMenu groupId="g1" />);
  for (const name of ['创建助理', '从市场添加助理']) {
    const button = screen.getByRole('button', { name });
    expect(button).toBeDisabled();
    fireEvent.click(button);
  }
  expect(mocks.openCreate).not.toHaveBeenCalled();
  expect(mocks.navigate).not.toHaveBeenCalled();
});

it('opens a real-person invitation for the current group and creates its link only after clicking', async () => {
  render(<DefaultGroupActions addAsMenu groupId="g-current" />);
  expect(mocks.createLink).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '邀请真人成员' }));
  const options = mocks.modal.mock.calls[0][0];
  expect(options.title).toBe('邀请真人成员');
  render(options.content);
  await screen.findByRole('button', { name: 'groupInvitation.copy' });
  expect(mocks.createLink).toHaveBeenCalledWith({ groupId: 'g-current' });
  expect(mocks.save).not.toHaveBeenCalled();
});

it('does not allow the disabled member menu to create invitations', () => {
  mocks.admin = false;
  render(<DefaultGroupActions addAsMenu groupId="g-current" />);
  const invite = screen.getByRole('button', { name: '邀请真人成员' });
  expect(invite).toBeDisabled();
  fireEvent.click(invite);
  expect(mocks.modal).not.toHaveBeenCalled();
  expect(mocks.createLink).not.toHaveBeenCalled();
});

it('does not offer a group invitation in the global assistant template menu', () => {
  render(<AddMemberMenu canManage onAddFromList={vi.fn()} />);
  expect(screen.queryByRole('button', { name: '邀请真人成员' })).toBeNull();
});

it('shows only the labeled add menu in the member dialog header', () => {
  render(<DefaultGroupActions addAsMenu addOnly groupId="g1" />);
  expect(screen.getByRole('button', { name: '添加成员' })).toHaveTextContent('添加成员');
  expect(screen.queryByRole('button', { name: '成员排序' })).not.toBeInTheDocument();
});
