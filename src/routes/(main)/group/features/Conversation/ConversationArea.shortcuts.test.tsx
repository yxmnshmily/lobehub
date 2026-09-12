import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as ReactRouter from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useGroupWorkRequest } from '@/features/SuperGroup/useGroupWorkRequest';

import ConversationArea, { GroupConversationBody } from './ConversationArea';

const historyMocks = vi.hoisted(() => ({
  topicId: undefined as string | undefined,
  refetch: vi.fn(),
  fetchNextPage: vi.fn(),
}));
vi.mock('react-router', async (original) => ({
  ...(await original<typeof ReactRouter>()),
  useParams: () => ({ topicId: historyMocks.topicId }),
}));
vi.mock('@/hooks/useQueryRoute', () => ({ useQueryRoute: () => ({ push: vi.fn() }) }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    message: {
      getMessages: {
        useInfiniteQuery: () => ({
          hasNextPage: true,
          refetch: historyMocks.refetch,
          fetchNextPage: historyMocks.fetchNextPage,
        }),
      },
    },
  },
}));

vi.mock('@/features/AgentTransferMigration', () => ({
  useTopicMigrationPending: () => ({ topicPending: false }),
}));
vi.mock('@/features/Conversation', () => ({
  ChatList: ({ headerSlot, initialPosition }: any) => (
    <div data-testid="chat-scroll" data-initial-position={initialPosition}>
      {headerSlot}
    </div>
  ),
  ConversationProvider: ({ children }: any) => children,
}));
vi.mock('@/features/Conversation/ChatList/hooks/useMessageDeepLink', () => ({
  useMessageDeepLink: () => undefined,
}));
vi.mock('@/features/Conversation/MessageForward', () => ({
  ForwardMessageDispatcher: () => null,
  MessageForwardFooter: ({ children }: any) => children,
}));
vi.mock('@/features/SuperGroup/GroupWorkPanel', () => ({ default: () => null }));
vi.mock('@/features/SuperGroup/GroupWorkPage', () => ({
  default: ({ kind }: { kind: string }) => (
    <div>{kind === 'goals' ? '完整目标页' : '完整任务页'}</div>
  ),
}));
vi.mock('@/features/ChatMiniMap', () => ({ default: () => null }));
vi.mock('@/hooks/useOperationState', () => ({ useOperationState: () => ({}) }));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: any) => selector({ replaceMessages: vi.fn() }),
}));
vi.mock('./AgentWelcome', () => ({ default: () => null }));
vi.mock('./ChatHydration', () => ({ default: () => null }));
vi.mock('./ThreadHydration', () => ({ default: () => null }));
vi.mock('./MainChatInput', () => ({ default: () => <div>群输入框</div> }));
vi.mock('./MainChatInput/MessageFromUrl', () => ({ default: () => null }));
vi.mock('./useActionsBarConfig', () => ({ useActionsBarConfig: () => ({}) }));
vi.mock('./useGroupContext', () => ({
  useGroupContext: () => ({ groupId: 'group', topicId: 'existing-topic' }),
}));
vi.mock('./useGroupConversationMessages', () => ({
  useGroupConversationMessages: () => [{ id: 'existing-message' }],
}));

describe('Group composer shortcuts', () => {
  it('opens work details alongside chat and closes the view without stopping work', () => {
    useGroupWorkRequest.setState({
      request: { groupId: 'group', kind: 'tasks', detail: { id: 'task-1' } },
    });
    render(<GroupConversationBody groupId="group" listContent={<p>群消息</p>} />);
    expect(screen.getByText('群消息')).toBeVisible();
    expect(screen.getByRole('button', { name: '展开完整页面' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }));
    expect(useGroupWorkRequest.getState().request).toBeNull();
    expect(screen.getByText('群消息')).toBeVisible();
  });
  it('starts explicit history topics at the top, while the live group retains scroll restoration', () => {
    const view = render(<ConversationArea />);
    expect(screen.getByTestId('chat-scroll').dataset.initialPosition).toBe('restore');
    view.unmount();
    historyMocks.topicId = 'archive-topic';
    render(<ConversationArea />);
    expect(screen.getByTestId('chat-scroll').dataset.initialPosition).toBe('start');
  });
  afterEach(() => {
    useGroupWorkRequest.setState({ request: null });
    historyMocks.topicId = undefined;
    historyMocks.refetch.mockReset();
    historyMocks.fetchNextPage.mockReset();
  });
  it('refreshes edited/deleted history pages before extending their offset window', async () => {
    historyMocks.topicId = 'history-topic';
    const order: string[] = [];
    historyMocks.refetch.mockImplementation(async () => {
      order.push('refresh');
      return {
        isError: false,
        data: { pages: [Array.from({ length: 200 }, (_, i) => ({ id: String(i) }))] },
      };
    });
    historyMocks.fetchNextPage.mockImplementation(async () => {
      order.push('extend');
    });
    render(<ConversationArea />);
    fireEvent.click(screen.getByRole('button', { name: '加载该话题更早消息' }));
    await waitFor(() => expect(order).toEqual(['refresh', 'extend']));
  });
  it('does not append stale cached history after a failed refresh', async () => {
    historyMocks.topicId = 'history-topic';
    historyMocks.refetch.mockResolvedValue({ isError: true, hasNextPage: true });
    render(<ConversationArea />);
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: '加载该话题更早消息' })),
    );
    expect(historyMocks.fetchNextPage).not.toHaveBeenCalled();
  });
  it('switches the right pane without a dialog and preserves the mounted composer', () => {
    render(
      <GroupConversationBody
        composer={<input aria-label="聊天草稿" defaultValue="保留这段草稿" />}
        groupId="group"
      />,
    );
    const composer = screen.getByRole('textbox', { name: '聊天草稿' });
    act(() => useGroupWorkRequest.setState({ request: { groupId: 'group', kind: 'goals' } }));
    expect(screen.getByText('完整目标页')).toBeVisible();
    expect(screen.queryByRole('button', { name: '返回群聊' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(composer).not.toBeVisible();
    act(() => useGroupWorkRequest.setState({ request: { groupId: 'group', kind: 'tasks' } }));
    expect(screen.getByText('完整任务页')).toBeVisible();
    expect(screen.queryByRole('button', { name: '返回群聊' })).not.toBeInTheDocument();
    act(() => useGroupWorkRequest.setState({ request: null }));
    expect(composer).toBeVisible();
    expect(composer).toHaveValue('保留这段草稿');
  });
  it('does not display another group’s selected page', () => {
    useGroupWorkRequest.setState({ request: { groupId: 'other', kind: 'tasks' } });
    render(<GroupConversationBody groupId="group" />);
    expect(screen.getByText('群输入框')).toBeVisible();
    expect(screen.queryByText('完整任务页')).not.toBeInTheDocument();
  });
  it('uses the administrator conversation body for an externally authorized group', () => {
    render(<GroupConversationBody groupId="joined" mobile={false} />);
    expect(screen.getByText('群输入框')).toBeInTheDocument();
  });
  it.each([false, true])(
    'keeps the composer visible with existing messages (mobile=%s)',
    (mobile) => {
      render(<ConversationArea mobile={mobile} />);
      expect(screen.getByText('群输入框')).toBeInTheDocument();
    },
  );
});
