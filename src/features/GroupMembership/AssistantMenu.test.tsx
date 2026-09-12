import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AssistantMenu, { RenameMember } from './AssistantMenu';

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  createModal: vi.fn(),
  update: vi.fn(),
  refresh: vi.fn(),
  originalDelete: vi.fn(),
  duplicate: vi.fn(),
  visible: true,
  show: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@lobehub/ui', () => ({
  Input: ({ onPressEnter, ...props }: any) => <input {...props} />,
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  ActionIcon: ({ icon, title, size, ...props }: any) => <button {...props}>{title}</button>,
  Button: ({ loading, type, ...props }: any) => <button {...props} />,
  DropdownMenu: ({ items, children }: any) => (
    <>
      {children}
      {items()
        .filter((item: any) => item.type !== 'divider')
        .map((item: any) => (
          <button
            key={item.key}
            onClick={() => item.onClick?.({ domEvent: { stopPropagation() {} } })}
          >
            {item.key}
          </button>
        ))}
    </>
  ),
  ModalFooter: ({ children }: any) => children,
  createModal: mocks.createModal,
  toast: { error: mocks.error },
  useModalContext: () => ({ close: mocks.close }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/features/HomeSidebar/Body/Agent/List/AgentItem/useDropdownMenu', () => ({
  useAgentDropdownMenu:
    ({ labelsEnabled, labels }: any) =>
    () =>
      [
        'pin',
        ...(mocks.visible ? ['hideFromSidebar'] : []),
        'openInNewWindow',
        'manage',
        'rename',
        'duplicate',
        'moveGroup',
        ...(labelsEnabled && labels?.some((label: any) => label.id === 'label-copy')
          ? ['labels']
          : []),
        'delete',
        'publishToWorkspace',
      ].map((key) => ({
        key,
        label: key,
        onClick:
          key === 'delete' ? mocks.originalDelete : key === 'duplicate' ? mocks.duplicate : vi.fn(),
      })),
}));
vi.mock('@/features/HomeSidebar/Body/Agent/Modals/CreateGroupModal', () => ({
  openCreateGroupModal: vi.fn(),
}));
vi.mock('@/features/HomeSidebar/Body/Agent/useSidebarItemVisibility', () => ({
  useSidebarItemVisibility: () => ({
    isSidebarItemVisible: () => mocks.visible,
    setSidebarItemVisible: mocks.show,
  }),
}));
vi.mock('@/services/agent', () => ({ agentService: { updateAgentConfig: mocks.update } }));
vi.mock('@/hooks/useFetchAgentLabels', () => ({ useFetchAgentLabels: vi.fn() }));
vi.mock('@/hooks/useFetchAgentList', () => ({ useFetchAgentList: vi.fn() }));
vi.mock('@/store/home', () => ({
  useHomeStore: Object.assign(
    (selector: any) => selector({ agentGroups: [], privateAgentGroups: [] }),
    { getState: () => ({ refreshAgentList: mocks.refresh }) },
  ),
}));
vi.mock('@/store/home/selectors', () => ({
  homeAgentListSelectors: {
    getAgentById: () => () => ({ pinned: false, labels: [{ id: 'label-copy', name: '文案' }] }),
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.visible = true;
});

describe('member menu', () => {
  it.each([false, true])(
    'retains the assigned-label menu in member actions (compact=%s)',
    (compact) => {
      render(
        <AssistantMenu
          agentId="writer"
          canConfigure
          compact={compact}
          title="Writer"
          onUpdated={mocks.refresh}
        />,
      );
      expect(screen.getByRole('button', { name: 'labels', exact: true })).toBeVisible();
    },
  );
  it('keeps the built-in supervisor name fixed', () => {
    render(
      <AssistantMenu
        agentId="supervisor"
        canConfigure
        canRename={false}
        title="旅游群"
        onUpdated={mocks.refresh}
      />,
    );
    expect(screen.queryByRole('button', { name: 'rename', exact: true })).toBeNull();
    expect(screen.getByRole('button', { name: 'manage', exact: true })).toBeVisible();
  });
  it('reuses the full list menu but only invokes group-specific deletion', () => {
    const remove = vi.fn();
    render(
      <AssistantMenu
        agentId="writer"
        canConfigure
        title="Writer"
        onRemove={remove}
        onUpdated={mocks.refresh}
      />,
    );
    for (const key of [
      'pin',
      'hideFromSidebar',
      'openInNewWindow',
      'manage',
      'rename',
      'duplicate',
      'moveGroup',
      'delete',
    ])
      expect(screen.getByRole('button', { name: key, exact: true })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'delete', exact: true }));
    expect(remove).toHaveBeenCalledOnce();
    expect(mocks.originalDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'publishToWorkspace' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'duplicate', exact: true }));
    expect(mocks.duplicate).toHaveBeenCalledOnce();
  });
  it('keeps configuration and deletion unavailable without template permission', () => {
    render(
      <AssistantMenu
        agentId="writer"
        canConfigure={false}
        title="Writer"
        onRemove={vi.fn()}
        onUpdated={mocks.refresh}
      />,
    );
    for (const name of ['manage', 'rename', 'delete', 'labels'])
      expect(screen.queryByRole('button', { name, exact: true })).toBeNull();
    expect(screen.queryByRole('button', { name: 'duplicate', exact: true })).toBeNull();
  });
  it('can restore a hidden member from the complete member list', async () => {
    mocks.visible = false;
    render(
      <AssistantMenu agentId="writer" canConfigure title="Writer" onUpdated={mocks.refresh} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'showInSidebar' }));
    await waitFor(() => expect(mocks.show).toHaveBeenCalledWith('writer', true));
  });
  it('renames the name without overwriting the professional role', async () => {
    render(<RenameMember agentId="writer" title="Writer" onUpdated={mocks.refresh} />);
    fireEvent.change(screen.getByRole('textbox', { name: '成员姓名' }), {
      target: { value: ' 新姓名 ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('writer', { name: '新姓名' }));
    await waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
  });
  it('does not close the rename form on a rejected template update', async () => {
    mocks.update.mockRejectedValueOnce(new Error('模板自动同步失败'));
    render(<RenameMember agentId="writer" title="Writer" onUpdated={mocks.refresh} />);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('模板自动同步失败'));
    expect(mocks.close).not.toHaveBeenCalled();
  });
});
