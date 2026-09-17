import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import GroupInfoPanel from './GroupInfoPanel';

const mocks = vi.hoisted(() => ({
  info: {
    name: '测试群',
    announcement: '全群公告',
    remark: '私人备注',
    nickname: '账号昵称',
    canEditAnnouncement: false,
  },
  saveAnnouncement: vi.fn(),
  saveRemark: vi.fn(),
  refetch: vi.fn(),
  leave: vi.fn(),
  confirm: vi.fn(),
  modal: vi.fn(),
  invalidate: vi.fn(),
  push: vi.fn(),
  share: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    useUtils: () => ({ groupConversation: { listGroups: { invalidate: mocks.invalidate } } }),
    groupInfo: {
      get: { useQuery: () => ({ data: mocks.info, refetch: mocks.refetch }) },
      updateAnnouncement: { useMutation: () => ({ mutateAsync: mocks.saveAnnouncement }) },
      updateRemark: { useMutation: () => ({ mutateAsync: mocks.saveRemark }) },
    },
    groupMembership: {
      leaveGroup: { useMutation: () => ({ mutateAsync: mocks.leave }) },
      listParticipants: {
        useQuery: () => ({
          data: {
            items: Array.from({ length: 11 }, (_, i) => ({
              memberUserId: `u${i}`,
              displayName: `成员${i}`,
              role: i === 1 ? 'owner' : 'member',
            })),
            assistants: [
              {
                id: 'ai-1',
                title: '攻略助手',
                subtitle: '旅行规划师',
                isSupervisor: false,
                description: '提供群内旅游攻略',
                model: 'test-model',
                provider: 'test',
              },
              { id: 'supervisor', title: '旅游群', isSupervisor: true },
              { id: 'unconfigured', title: '未配置职业助手', isSupervisor: false },
            ],
            nextOffset: null,
            viewerRole: 'member',
            viewerMembershipVersion: 7,
          },
        }),
      },
    },
  },
}));
vi.mock('@/features/GroupMembership/MemberPanel', () => ({ default: () => null }));
vi.mock('@/hooks/useQueryRoute', () => ({
  useQueryRoute: () => ({ replace: vi.fn(), push: mocks.push }),
}));
vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmModal: mocks.confirm,
  createModal: mocks.modal,
}));
vi.mock('@/features/ShareModal', () => ({ openShareModal: mocks.share }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/features/ResourcePermission/useResourceAccess', () => ({
  useResourceAccess: () => ({ canEditResource: false, isAccessResolved: true }),
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('./GroupLogs', () => ({ default: () => null }));
vi.mock('./RecentTopicLinks', () => ({ default: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.info.canEditAnnouncement = false;
});

it.each([false, true])(
  'shows the corresponding role or occupation below every member name (management=%s)',
  (manageDefaultGroup) => {
    render(
      <GroupInfoPanel groupId="g" manageDefaultGroup={manageDefaultGroup} onClose={() => {}} />,
    );
    const members = screen.getByLabelText('群成员列表');
    expect(
      within(within(members).getByRole('button', { name: /成员0/ })).getByText('群成员'),
    ).toBeVisible();
    expect(
      within(within(members).getByRole('button', { name: /成员1$/ })).getByText('群主'),
    ).toBeVisible();
    expect(
      within(within(members).getByRole('button', { name: /攻略助手/ })).getByText('旅行规划师'),
    ).toBeVisible();
    expect(
      within(within(members).getByRole('button', { name: /旅游群/ })).getByText('主管'),
    ).toBeVisible();
    expect(
      within(within(members).getByRole('button', { name: '未配置职业助手' })).queryByText('群成员'),
    ).not.toBeInTheDocument();
  },
);

it('opens the selected human profile instead of the member-management dialog', async () => {
  render(<GroupInfoPanel groupId="g" onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /成员0/ }));
  const card = await screen.findByRole('dialog');
  expect(within(card).getByText('成员0')).toBeInTheDocument();
  expect(within(card).getByText('群成员')).toBeInTheDocument();
  expect(mocks.modal).not.toHaveBeenCalled();
});

it('opens the existing assistant profile with the authorized description and read-only model', async () => {
  render(<GroupInfoPanel groupId="g" onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /攻略助手/ }));
  expect(await screen.findByText('提供群内旅游攻略')).toBeInTheDocument();
  expect(screen.getByText('test-model')).toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(mocks.modal).not.toHaveBeenCalled();
});

it('renders all shared rows and eleven members, with a read-only nickname', () => {
  render(<GroupInfoPanel groupId="g" onClose={() => {}} />);
  for (const name of ['群名称', '群日志', '群历史记录', '群公告', '备注', '我在本群的昵称'])
    expect(screen.getByText(name)).toBeInTheDocument();
  expect(screen.getByText('成员10')).toBeInTheDocument();
  expect(screen.getByText('账号昵称')).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

it('does not offer announcement editing to members, but saves their own remark', async () => {
  render(<GroupInfoPanel groupId="g" onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /群公告/ }));
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '返回群信息' }));
  fireEvent.click(screen.getByRole('button', { name: /备注/ }));
  fireEvent.change(screen.getByRole('textbox', { name: '备注' }), {
    target: { value: '更新的备注' },
  });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() =>
    expect(mocks.saveRemark).toHaveBeenCalledWith({ groupId: 'g', remark: '更新的备注' }),
  );
  expect(mocks.saveAnnouncement).not.toHaveBeenCalled();
});

it('lets the owner edit announcements and keeps errors visible without discarding the draft', async () => {
  mocks.info.canEditAnnouncement = true;
  mocks.saveAnnouncement.mockRejectedValueOnce(new Error('offline'));
  render(<GroupInfoPanel groupId="g" onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /群公告/ }));
  fireEvent.change(screen.getByRole('textbox', { name: '群公告' }), {
    target: { value: '新公告' },
  });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(screen.getByText('保存失败，请重试')).toBeInTheDocument());
  expect(screen.getByRole('textbox', { name: '群公告' })).toHaveValue('新公告');
});

it.each([
  { context: { agentId: 'supervisor', groupId: 'g', topicId: 'topic' } },
  {
    snapshot: {
      context: { agentId: '', groupId: 'g', topicId: 'topic' },
      messages: [],
      title: '加入的群',
    },
  },
])('opens the same chat share page with the current group data: %j', async (shareOptions) => {
  const close = vi.fn();
  render(<GroupInfoPanel groupId="g" shareOptions={shareOptions} onClose={close} />);
  fireEvent.click(screen.getByRole('button', { name: '群文件' }));
  await waitFor(() =>
    expect(mocks.share).toHaveBeenCalledWith({ ...shareOptions, title: '群文件' }),
  );
  expect(close).toHaveBeenCalled();
  expect(mocks.modal).not.toHaveBeenCalled();
});

it('confirms before leaving', async () => {
  const close = vi.fn();
  render(<GroupInfoPanel groupId="g" onClose={close} />);
  fireEvent.click(screen.getByRole('button', { name: '退出群' }));
  expect(mocks.leave).not.toHaveBeenCalled();
  await act(async () => {
    await mocks.confirm.mock.calls[0][0].onOk();
  });
  expect(mocks.leave).toHaveBeenCalledWith({ groupId: 'g', expectedMembershipVersion: 7 });
  expect(mocks.push).toHaveBeenCalledWith('/group/default', { replace: true });
});

it('does not let the owner leave their own group', () => {
  mocks.info.canEditAnnouncement = true;
  render(<GroupInfoPanel groupId="g" onClose={() => {}} />);
  expect(screen.getByRole('button', { name: '退出群' })).toBeDisabled();
});
