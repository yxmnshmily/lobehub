/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MobileSidebarContext } from '@/features/SuperGroup/useMobileGroupSidebar';

import Header from './index';

const mocks = vi.hoisted(() => ({
  isMobile: true,
  narrowViewport: false,
  clientId: 'default-travel-service-group',
  workspaceId: null as string | null,
  push: vi.fn(),
  toggleMobileTopic: vi.fn(),
  createModal: vi.fn(),
  searchMessages: vi.fn(),
  closeModal: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => {
  const { useState } = await import('react');
  return {
    ...(await importOriginal<object>()),
    createModal: mocks.createModal,
    ActionIcon: ({
      'aria-label': ariaLabel,
      onClick,
      title,
    }: {
      'aria-label'?: string;
      'onClick'?: () => void;
      'title'?: string;
    }) => (
      <button aria-label={ariaLabel} type="button" onClick={onClick}>
        {title}
      </button>
    ),
    Popover: ({
      children,
      content,
      onOpenChange,
    }: {
      children: ReactNode;
      content: ReactNode;
      onOpenChange?: (open: boolean) => void;
    }) => {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <div
            onClick={() => {
              setOpen(true);
              onOpenChange?.(true);
            }}
          >
            {children}
          </div>
          {open && content}
        </div>
      );
    },
  };
});

vi.mock('@lobehub/ui/mobile', () => ({
  ChatHeader: Object.assign(
    ({ center, left, right }: { center?: ReactNode; left?: ReactNode; right?: ReactNode }) => (
      <header>
        {left}
        {center}
        {right}
      </header>
    ),
    {
      Title: ({ title }: { title?: ReactNode }) => <h1>{title}</h1>,
    },
  ),
}));

vi.mock('@/features/AgentTransferMigration', () => ({ AgentMigrationBadge: () => null }));
vi.mock('@/features/SuperGroup/GroupInfoPanel', () => ({
  default: ({ groupId }: { groupId: string }) => (
    <button data-group-id={groupId} type="button">
      群成员
    </button>
  ),
}));
vi.mock('@/features/NavHeader', () => ({
  default: ({ children, right }: { children?: ReactNode; right?: ReactNode }) => (
    <header data-testid="desktop-header">
      {children}
      {right}
    </header>
  ),
}));
vi.mock('@/features/WideScreenContainer/WideScreenButton', () => ({ default: () => null }));
vi.mock('@/hooks/useQueryRoute', () => ({ useQueryRoute: () => ({ push: mocks.push }) }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mocks.narrowViewport }));
vi.mock('@/store/agentGroup', () => ({
  useAgentGroupStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      activeGroupId: 'group-1',
      groupMap: {
        'group-1': {
          title: '旅游服务超级群组',
          clientId: mocks.clientId,
          workspaceId: mocks.workspaceId,
        },
      },
    }),
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: (
    selector: (state: { toggleMobileTopic: typeof mocks.toggleMobileTopic }) => unknown,
  ) => selector({ toggleMobileTopic: mocks.toggleMobileTopic }),
}));
vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: { isMobile: boolean }) => unknown) =>
    selector({ isMobile: mocks.isMobile }),
}));
vi.mock('./ShareButton', () => ({ default: () => null }));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { message: { searchMessages: { query: mocks.searchMessages } } },
}));

describe('Group conversation header', () => {
  beforeEach(() => {
    mocks.isMobile = true;
    mocks.narrowViewport = false;
    mocks.clientId = 'default-travel-service-group';
    mocks.workspaceId = null;
    mocks.push.mockReset();
    mocks.toggleMobileTopic.mockReset();
    mocks.createModal.mockReset().mockReturnValue({ close: mocks.closeModal });
    mocks.closeModal.mockReset();
    mocks.searchMessages.mockReset();
  });

  it('replaces the mobile back button with the sidebar toggle without navigating', () => {
    const toggle = vi.fn();
    const { rerender } = render(
      <MobileSidebarContext value={{ open: false, toggle }}>
        <Header />
      </MobileSidebarContext>,
    );

    expect(screen.getByRole('heading', { name: /旅游服务超级群组/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '返回' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开侧栏' }));
    expect(toggle).toHaveBeenCalledOnce();
    expect(mocks.push).not.toHaveBeenCalled();
    rerender(
      <MobileSidebarContext value={{ open: true, toggle }}>
        <Header />
      </MobileSidebarContext>,
    );
    fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }));
    expect(toggle).toHaveBeenCalledTimes(2);
  });

  it('opens the historical topic list for an ordinary group', () => {
    mocks.clientId = 'ordinary-group';
    render(<Header />);

    fireEvent.click(screen.getByRole('button', { name: '历史会话' }));

    expect(mocks.toggleMobileTopic).toHaveBeenCalledWith(true);
  });

  it('exposes the current group member panel on mobile', () => {
    render(<Header />);
    fireEvent.click(screen.getByRole('button', { name: '群聊更多操作' }));
    expect(screen.getByRole('button', { name: '群成员' })).toHaveAttribute(
      'data-group-id',
      'group-1',
    );
  });

  it.each(['ordinary-group', 'workspace'])(
    'does not offer supergroup membership on %s groups',
    (kind) => {
      if (kind === 'workspace') mocks.workspaceId = 'workspace-1';
      else mocks.clientId = 'ordinary-group';
      render(<Header />);
      fireEvent.click(screen.getByRole('button', { name: '群聊更多操作' }));
      expect(screen.queryByRole('button', { name: '群成员' })).toBeNull();
    },
  );

  it('keeps the existing desktop header outside mobile mode', () => {
    mocks.isMobile = false;

    render(<Header />);

    expect(screen.getByTestId('desktop-header')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /旅游服务超级群组/ })).toBeInTheDocument();
  });

  it('restores history alongside back and members in a narrow desktop viewport', () => {
    mocks.isMobile = false;
    mocks.narrowViewport = true;
    render(<Header />);
    expect(screen.getByRole('button', { name: /backToHome|返回/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '群聊更多操作' }));
    expect(screen.getByRole('button', { name: '群成员' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '历史会话' }));
    expect(mocks.toggleMobileTopic).toHaveBeenCalledWith(true);
  });

  it.each([true, false])(
    'searches only the active group and opens a matching message (mobile=%s)',
    async (mobile) => {
      mocks.isMobile = mobile;
      mocks.searchMessages.mockImplementation(async (input) => {
        if (input.groupId !== 'group-1') throw new Error('Missing current group scope');
        return [{ id: 'message-1', topicId: 'topic-1', content: '验收：旅行计划' }];
      });
      render(<Header />);
      if (mobile) fireEvent.click(screen.getByRole('button', { name: '群聊更多操作' }));
      fireEvent.click(screen.getByRole('button', { name: '搜索群内容' }));
      render(mocks.createModal.mock.calls[0][0].content);
      fireEvent.change(screen.getByRole('textbox', { name: '搜索群内容' }), {
        target: { value: mobile ? '旅行计划' : '旅行' },
      });
      fireEvent.submit(screen.getByRole('textbox', { name: '搜索群内容' }).closest('form')!);
      fireEvent.click(await screen.findByRole('button', { name: '跳转聊天位置' }));
      expect(mocks.push).toHaveBeenCalledWith('/group/group-1/topic-1#message-1');
      expect(mocks.closeModal).toHaveBeenCalledOnce();
    },
  );
});
