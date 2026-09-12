import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SuperGroupTemplateSection from './SuperGroupTemplateSection';

vi.mock('react-i18next', async (importOriginal) => {
  const { createInstance } = await import('i18next');
  const i18n = createInstance();
  await i18n.init({ lng: 'zh-CN', resources: {} });
  const t = i18n.t.bind(i18n);
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ i18n, t }),
  };
});

vi.mock('@/features/HomeSidebar/Body/Agent/ModalProvider', () => ({
  AgentModalProvider: ({ children }: any) => children,
  useAgentModal: () => ({ openCreateModal: mock.openCreate }),
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mock.navigate,
}));

vi.mock('react-router', () => ({
  Link: ({ to, children, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
const mock = vi.hoisted(() => ({
  admin: true as boolean | undefined,
  openCreate: vi.fn(),
  navigate: vi.fn(),
  publish: vi.fn(),
  remove: vi.fn(),
  confirm: vi.fn(),
  refetch: vi.fn(),
  query: vi.fn(),
  deleteAgent: vi.fn(),
  candidates: [] as { id: string; name?: string; title: string | null; avatar: null }[],
}));
vi.mock('@/store/home', () => ({
  useHomeStore: (selector: any) => selector({ removeAgent: mock.deleteAgent }),
}));
vi.mock('@lobehub/ui/base-ui', async (original) => ({
  ...(await original<any>()),
  confirmModal: mock.confirm,
  DropdownMenu: ({ children, items }: any) => (
    <div>
      {children}
      {items.map((item: any) => (
        <button disabled={item.disabled} key={item.key} onClick={item.onClick}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    platformAccess: { isPlatformAdmin: { useQuery: () => ({ data: mock.admin }) } },
    agent: {
      queryAgents: {
        useQuery: () => ({
          data: mock.candidates,
          refetch: mock.refetch,
        }),
      },
    },
    platformOperations: {
      upsertSuperGroupTemplateMember: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      getSuperGroupTemplate: {
        useQuery: () => {
          mock.query();
          return {
            data: {
              members: [
                {
                  key: 'copy',
                  sourceAgentId: 'codex',
                  title: 'Codex',
                  model: 'gpt-5',
                  provider: 'openai',
                },
              ],
            },
            refetch: mock.refetch,
          };
        },
      },
      importSuperGroupTemplateMember: { useMutation: () => ({ mutateAsync: mock.publish }) },
      removeSuperGroupTemplateMember: { useMutation: () => ({ mutateAsync: mock.remove }) },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mock.admin = true;
  mock.candidates = [
    { id: 'codex', title: 'Codex', avatar: null },
    { id: 'deepseek', name: '邱岁琪', title: null, avatar: null },
  ];
  mock.deleteAgent.mockImplementation(async (id: string) => {
    mock.candidates = mock.candidates.filter((agent) => agent.id !== id);
  });
  mock.publish.mockResolvedValue({ syncedGroupCount: 2 });
  mock.remove.mockResolvedValue({ syncedGroupCount: 2 });
});
afterEach(cleanup);
describe('group member publishing', () => {
  it('deletes a candidate only after confirmation and refreshes the candidate list', async () => {
    render(<SuperGroupTemplateSection />);
    fireEvent.click(screen.getByRole('button', { name: '删除 邱岁琪' }));
    expect(mock.deleteAgent).not.toHaveBeenCalled();
    expect(mock.confirm.mock.calls[0][0].okButtonProps).toEqual({ danger: true });
    await act(mock.confirm.mock.calls[0][0].onOk);
    expect(mock.deleteAgent).toHaveBeenCalledExactlyOnceWith('deepseek');
    expect(mock.refetch).toHaveBeenCalled();
    expect(screen.queryByText('邱岁琪')).toBeNull();
    expect(mock.remove).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '删除 Codex' })).toBeTruthy();
  });

  it('keeps the candidate and allows retry when deletion is refused', async () => {
    mock.deleteAgent.mockRejectedValueOnce(new Error('private backend details'));
    render(<SuperGroupTemplateSection />);
    fireEvent.click(screen.getByRole('button', { name: '删除 邱岁琪' }));
    await act(mock.confirm.mock.calls[0][0].onOk);
    expect(screen.getByText('邱岁琪')).toBeTruthy();
    expect(screen.getByRole('button', { name: '删除 邱岁琪' }).hasAttribute('disabled')).toBe(
      false,
    );
    expect(screen.queryByText('private backend details')).toBeNull();
    expect(mock.refetch).not.toHaveBeenCalled();
  });

  it('explains server-model restrictions without exposing arbitrary server errors', async () => {
    mock.publish.mockRejectedValueOnce(
      new Error('设备或本地 CLI 成员不能同步给所有用户，请先配置服务器模型。'),
    );
    render(<SuperGroupTemplateSection />);
    fireEvent.click(screen.getByRole('button', { name: '同步 Codex' }));
    await act(mock.confirm.mock.calls[0][0].onOk);
    expect(
      screen.getByText('此成员绑定了设备或本地 CLI，请先在原成员档案中配置服务器模型，再同步。'),
    ).toBeTruthy();
  });
  it('adds an existing configured member without synthesizing model or tool defaults', async () => {
    render(<SuperGroupTemplateSection />);
    expect(screen.getByText('邱岁琪')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '添加成员' }));
    expect(mock.publish).not.toHaveBeenCalled();
    await act(mock.confirm.mock.calls[0][0].onOk);
    expect(mock.publish).toHaveBeenCalledWith({ agentId: 'deepseek', allowPending: true });
  });
  it('fails closed before querying private configuration', () => {
    mock.admin = undefined;
    render(<SuperGroupTemplateSection />);
    expect(mock.query).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /删除/ })).toBeNull();
  });
  it('offers original profile editing and publishes only after confirmation', async () => {
    render(<SuperGroupTemplateSection />);
    expect(screen.getByRole('link', { name: '编辑 Codex' }).getAttribute('href')).toContain(
      '/agent/codex/profile',
    );
    fireEvent.click(screen.getByRole('button', { name: '同步 Codex' }));
    expect(mock.publish).not.toHaveBeenCalled();
    await act(mock.confirm.mock.calls[0][0].onOk);
    expect(mock.publish).toHaveBeenCalledWith({
      agentId: 'codex',
      key: 'copy',
      allowPending: true,
    });
    await screen.findByText('已同步到 2 个默认群');
  });
  it('removes only the template binding after explicit confirmation', async () => {
    render(<SuperGroupTemplateSection />);
    fireEvent.click(screen.getByRole('button', { name: '删除 Codex' }));
    expect(mock.remove).not.toHaveBeenCalled();
    expect(mock.confirm.mock.calls[0][0].content).toContain('历史消息');
    await act(mock.confirm.mock.calls[0][0].onOk);
    expect(mock.remove).toHaveBeenCalledWith({ key: 'copy' });
  });
});

it('offers creation and market entry from the add-member card', () => {
  render(<SuperGroupTemplateSection />);
  expect(screen.getByRole('button', { name: '添加成员菜单' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '创建助理' }));
  expect(mock.openCreate).toHaveBeenCalledWith('agent');
  fireEvent.click(screen.getByRole('button', { name: '从市场添加助理' }));
  expect(mock.navigate).toHaveBeenCalledWith('/community/agent');
});

it('focuses and refreshes the existing candidate list from the add-member card', () => {
  const scroll = vi.fn();
  const previous = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scroll;
  try {
    render(<SuperGroupTemplateSection />);
    fireEvent.click(screen.getByRole('button', { name: '从助理列表添加' }));
    expect(screen.getByRole('textbox', { name: '搜索已配置成员' })).toHaveFocus();
    expect(mock.refetch).toHaveBeenCalled();
    expect(scroll).toHaveBeenCalled();
  } finally {
    HTMLElement.prototype.scrollIntoView = previous;
  }
});
