/**
 * @vitest-environment happy-dom
 */
import type { ConversationContext, TaskDetailActivity } from '@lobechat/types';
import { fireEvent, render } from '@testing-library/react';
import type { CSSProperties, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GroupWorkScopeContext } from '@/features/SuperGroup/GroupWorkScope';
import { useGatewayReconnect } from '@/hooks/useGatewayReconnect';

import TopicChatDrawer, { TopicChatDrawerBody } from './index';

const mocks = vi.hoisted(() => ({
  agentState: {
    useHydrateAgentConfig: vi.fn(),
  },
  chatState: {
    dbMessagesMap: {} as Record<string, unknown[]>,
    operations: {} as Record<
      string,
      { context: ConversationContext; metadata: { serverOperationId: string }; status: string }
    >,
    replaceMessages: vi.fn(),
    useFetchTopicDetail: vi.fn(),
  },
  permission: {
    allowed: true,
    reason: 'requires member',
  },
  navigate: vi.fn(),
  shareOptions: vi.fn(),
  providerOptions: vi.fn(),
  serverConfigState: {
    serverConfig: {
      enableBusinessFeatures: false,
    },
  },
  taskState: {
    activeTaskId: 'T-1',
    activeTopicDrawerTopicId: 'topic-1',
    closeTopicDrawer: vi.fn(),
    useFetchTaskDetail: vi.fn(),
    taskDetailMap: {
      'T-1': {
        activities: [
          {
            id: 'topic-1',
            status: 'completed',
            time: '2026-04-29T00:00:00.000Z',
            title: 'Topic 1',
            type: 'topic',
          },
        ] as TaskDetailActivity[],
        agentId: 'agt_assignee',
        identifier: 'T-1',
        instruction: 'Do the task',
        status: 'completed',
      },
    },
  },
  userState: {
    isSignedIn: true,
  },
}));

const serializeSize = (size: unknown) =>
  size === undefined ? '' : typeof size === 'string' ? size : JSON.stringify(size);

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  copyToClipboard: vi.fn(),
  DropdownMenu: ({
    children,
    items,
  }: {
    children?: ReactNode;
    items?: { key: string; label?: ReactNode; onClick?: () => void; type?: string }[];
  }) => (
    <>
      {children}
      {items?.map((item) =>
        item.type === 'divider' ? null : (
          <button key={item.key} onClick={item.onClick}>
            {item.label}
          </button>
        ),
      )}
    </>
  ),
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ActionIcon: ({
    disabled,
    icon,
    onClick,
    size,
    title,
  }: {
    disabled?: boolean;
    icon?: { name?: string };
    onClick?: () => void;
    size?: unknown;
    title?: string;
  }) => (
    <button
      data-icon={icon?.name}
      data-size={serializeSize(size)}
      data-testid="header-action-icon"
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {title}
    </button>
  ),
  FloatingPanel: ({
    actions,
    children,
    height,
    minHeight,
    minWidth,
    open,
    placement,
    resizable = true,
    styles,
    title,
    width,
  }: {
    actions?: ReactNode;
    children?: ReactNode;
    height?: unknown;
    minHeight?: number;
    minWidth?: number;
    open?: boolean;
    placement?: string;
    resizable?: boolean;
    styles?: { body?: CSSProperties; panel?: CSSProperties; title?: CSSProperties };
    title?: ReactNode;
    width?: unknown;
  }) =>
    open ? (
      <div
        data-height={serializeSize(height)}
        data-min-height={serializeSize(minHeight)}
        data-min-width={serializeSize(minWidth)}
        data-panel-background={serializeSize(styles?.panel?.background)}
        data-placement={placement}
        data-resizable={String(resizable)}
        data-testid="topic-panel"
        data-width={serializeSize(width)}
        style={styles?.panel}
      >
        <div data-testid="panel-title-slot" style={styles?.title}>
          {title}
        </div>
        <div data-testid="panel-actions-slot">{actions}</div>
        <button data-testid="panel-close-icon" />
        <div data-testid="panel-body-slot" style={styles?.body}>
          {children}
        </div>
      </div>
    ) : null,
}));

vi.mock('next/dynamic', () => ({
  default: () =>
    function DynamicComponent({ children }: { children?: ReactNode }) {
      return <>{children}</>;
    },
}));

vi.mock('@/features/Conversation/ChatList', () => ({
  default: () => <div data-testid="chat-list" />,
}));

vi.mock('@/features/Conversation/ConversationProvider', () => ({
  ConversationProvider: ({
    children,
    context,
    messages,
    skipFetch,
    onMessagesChange,
  }: {
    children?: ReactNode;
    context: ConversationContext;
    messages?: unknown[];
    skipFetch?: boolean;
    onMessagesChange?: unknown;
  }) => {
    mocks.providerOptions({ onMessagesChange, context });
    return (
      <div
        data-context={JSON.stringify(context)}
        data-messages={JSON.stringify(messages)}
        data-skip-fetch={String(!!skipFetch)}
        data-testid="conversation-context"
        data-writes-back={String(!!onMessagesChange)}
      >
        {children}
      </div>
    );
  },
}));

vi.mock('@/features/Conversation/Messages', () => ({
  default: ({ id }: { id: string }) => <div data-testid="message-item">{id}</div>,
}));

vi.mock('@/features/Conversation/Markdown/plugins/Task', () => ({
  TaskCardScopeProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/ShareModal', () => ({
  useShareModal: (options: unknown) => {
    mocks.shareOptions(options);
    return { openShareModal: vi.fn() };
  },
}));

vi.mock('@/components/AsyncError', () => ({ default: () => <div data-testid="topic-error" /> }));
vi.mock('@/components/404', () => ({ default: () => <div data-testid="topic-not-found" /> }));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('@/hooks/useGatewayReconnect', () => ({
  useGatewayReconnect: vi.fn(),
}));

vi.mock('@/hooks/useOperationState', () => ({
  useOperationState: () => undefined,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: mocks.permission.allowed, reason: mocks.permission.reason }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: typeof mocks.agentState) => unknown) =>
    selector(mocks.agentState),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: typeof mocks.chatState) => unknown) => selector(mocks.chatState),
}));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: typeof mocks.serverConfigState) => unknown) =>
    selector(mocks.serverConfigState),
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: (state: typeof mocks.taskState) => unknown) => selector(mocks.taskState),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: typeof mocks.userState) => unknown) => selector(mocks.userState),
}));

vi.mock('../../features/AssigneeAvatar', () => ({
  default: ({ agentId, size }: { agentId?: string; size?: number }) => (
    <span data-agent-id={agentId} data-size={size} data-testid="assignee-avatar" />
  ),
}));

vi.mock('./FeedbackInput', () => ({
  default: ({
    defaultExpanded,
    disableCollapse,
  }: {
    defaultExpanded?: boolean;
    disableCollapse?: boolean;
  }) => (
    <div
      data-default-expanded={String(Boolean(defaultExpanded))}
      data-disable-collapse={String(Boolean(disableCollapse))}
      data-testid="feedback-input"
    />
  ),
}));

describe('TopicChatDrawer', () => {
  beforeEach(() => {
    mocks.chatState.operations = {};
    mocks.chatState.dbMessagesMap = {};
    mocks.chatState.useFetchTopicDetail.mockImplementation((id: string) => ({
      data: { id, groupId: null },
    }));
    mocks.agentState.useHydrateAgentConfig.mockClear();
    mocks.chatState.replaceMessages.mockClear();
    mocks.navigate.mockClear();
    mocks.taskState.closeTopicDrawer.mockClear();
    mocks.taskState.activeTopicDrawerTopicId = 'topic-1';
    mocks.taskState.taskDetailMap['T-1'].activities[0] = {
      id: 'topic-1',
      status: 'completed',
      time: '2026-04-29T00:00:00.000Z',
      title: 'Topic 1',
      type: 'topic',
    };
    mocks.permission.allowed = true;
    mocks.serverConfigState.serverConfig.enableBusinessFeatures = false;
    vi.mocked(useGatewayReconnect).mockClear();
  });

  // The run drawer also mounts on the home inbox, where the chat store has no
  // active agent — reconnecting against it would stream the run into a bucket
  // this panel never reads, so the run's own agent has to be passed down.
  it('reconnects a running topic against the drawer agent', () => {
    mocks.taskState.taskDetailMap['T-1'].activities[0] = {
      id: 'topic-1',
      runningOperation: {
        assistantMessageId: 'ast-1',
        heteroType: 'claude-code',
        operationId: 'op-1',
      },
      status: 'running',
      time: '2026-04-29T00:00:00.000Z',
      title: 'Topic 1',
      type: 'topic',
    };

    render(<TopicChatDrawer />);

    expect(useGatewayReconnect).toHaveBeenCalledWith(
      'topic-1',
      expect.objectContaining({ heteroType: 'claude-code', operationId: 'op-1' }),
      'agt_assignee',
      undefined,
      expect.objectContaining({
        agentId: 'agt_assignee',
        isolatedTopic: true,
        scope: 'main',
        topicId: 'topic-1',
      }),
    );
  });

  it('hydrates the task assignee agent config for drawer messages', () => {
    render(<TopicChatDrawer />);

    expect(mocks.agentState.useHydrateAgentConfig).toHaveBeenCalledWith(true, 'agt_assignee');
  });

  it('keeps the floating drawer reply input collapsed by default', () => {
    const { getByTestId } = render(<TopicChatDrawer />);

    expect(getByTestId('feedback-input')).toHaveAttribute('data-default-expanded', 'false');
    expect(getByTestId('feedback-input')).toHaveAttribute('data-disable-collapse', 'false');
  });

  it('disables topic sharing for workspace viewers', () => {
    mocks.permission.allowed = false;
    mocks.serverConfigState.serverConfig.enableBusinessFeatures = true;

    const { getByTitle } = render(<TopicChatDrawer />);

    expect(getByTitle('requires member')).toBeDisabled();
  });

  it('constrains long panel titles before the header actions', () => {
    const { getByTestId, getByText } = render(<TopicChatDrawer />);

    const title = getByText('Topic 1');

    expect(title).toHaveStyle({ flex: '0 1 auto', minWidth: '0' });
    expect(title.parentElement).toHaveStyle({ maxWidth: '100%', overflow: 'hidden' });
    expect(getByTestId('panel-title-slot')).toHaveStyle({
      boxSizing: 'border-box',
      maxWidth: '100%',
      overflow: 'hidden',
    });
  });

  it('shows the assignee avatar in the topic header', () => {
    const { getByTestId } = render(<TopicChatDrawer />);

    expect(getByTestId('assignee-avatar')).toHaveAttribute('data-agent-id', 'agt_assignee');
    expect(getByTestId('assignee-avatar')).toHaveAttribute('data-size', '20');
  });

  it('uses the container background for the conversation panel', () => {
    const { getByTestId } = render(<TopicChatDrawer />);

    expect(getByTestId('topic-panel')).toHaveAttribute(
      'data-panel-background',
      'var(--ant-color-bg-container)',
    );
  });

  it('renders the share button in the floating panel actions slot', () => {
    const { getAllByTestId, getByTestId } = render(<TopicChatDrawer />);

    const icons = getAllByTestId('header-action-icon');
    const moreIcon = icons.find((icon) => !icon.getAttribute('title'));
    const expandIcon = icons.find(
      (icon) => icon.getAttribute('title') === 'taskDetail.topicDrawer.expand',
    );
    const shareIcon = icons.find((icon) => icon.getAttribute('title') === 'share');

    expect(moreIcon).toBeDefined();
    expect(expandIcon).toBeDefined();
    expect(shareIcon).toBeDefined();
    expect(moreIcon!).toHaveAttribute('data-size', 'small');
    expect(shareIcon!).toHaveAttribute('data-size', JSON.stringify({ blockSize: 32, size: 16 }));
    expect(getByTestId('panel-actions-slot')).toContainElement(shareIcon!);
    expect(getByTestId('panel-close-icon')).toBeInTheDocument();
  });

  it('expands the conversation into a full-height reading panel', () => {
    const { getByTestId, getByTitle } = render(<TopicChatDrawer />);

    fireEvent.click(getByTitle('taskDetail.topicDrawer.expand'));

    expect(getByTestId('topic-panel')).toHaveAttribute(
      'data-width',
      'min(960px, calc(100vw - 16px))',
    );
    expect(getByTestId('topic-panel')).toHaveAttribute('data-height', 'calc(100dvh - 16px)');
    expect(getByTitle('taskDetail.topicDrawer.collapse')).toBeInTheDocument();
  });

  it('opens the run in its Agent conversation', () => {
    const { getByText } = render(<TopicChatDrawer />);

    fireEvent.click(getByText('taskDetail.topicMenu.openAgentTopic'));

    expect(mocks.taskState.closeTopicDrawer).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledWith('/agent/agt_assignee/topic-1');
  });

  it('keeps a group run in the group when opening its conversation', () => {
    mocks.chatState.useFetchTopicDetail.mockReturnValue({
      data: { id: 'topic-1', groupId: 'cg_team' },
    });
    const { getByText } = render(
      <GroupWorkScopeContext value={{ groupId: 'cg_team' }}>
        <TopicChatDrawer />
      </GroupWorkScopeContext>,
    );
    fireEvent.click(getByText('taskDetail.topicMenu.openGroupTopic'));
    expect(mocks.navigate).toHaveBeenCalledWith('/group/cg_team/topic-1');
    expect(mocks.taskState.closeTopicDrawer).toHaveBeenCalledOnce();
  });

  it('binds run replies to the containing group without changing the selected member', () => {
    mocks.chatState.useFetchTopicDetail.mockReturnValue({
      data: { id: 'topic-1', groupId: 'cg_team' },
    });
    const { getByTestId } = render(
      <GroupWorkScopeContext value={{ groupId: 'cg_team' }}>
        <TopicChatDrawer />
      </GroupWorkScopeContext>,
    );
    expect(
      JSON.parse(getByTestId('conversation-context').getAttribute('data-context')!),
    ).toMatchObject({
      agentId: 'agt_assignee',
      groupId: 'cg_team',
      isolatedTopic: true,
      scope: 'group',
      topicId: 'topic-1',
    });
  });

  it('keeps the reused acceptance conversation body in its group', () => {
    mocks.chatState.useFetchTopicDetail.mockImplementation((id: string) => ({
      data: { id, groupId: id === 'review-topic' ? 'cg_team' : null },
    }));
    const { getByTestId, rerender } = render(
      <GroupWorkScopeContext value={{ groupId: 'cg_team' }}>
        <TopicChatDrawerBody agentId="agt_reviewer" topicId="review-topic" />
      </GroupWorkScopeContext>,
    );
    expect(
      JSON.parse(getByTestId('conversation-context').getAttribute('data-context')!),
    ).toMatchObject({
      agentId: 'agt_reviewer',
      groupId: 'cg_team',
      scope: 'group',
      topicId: 'review-topic',
    });
    rerender(<TopicChatDrawerBody agentId="agt_reviewer" topicId="personal-topic" />);
    const context = JSON.parse(getByTestId('conversation-context').getAttribute('data-context')!);
    expect(context).toMatchObject({ scope: 'main', topicId: 'personal-topic' });
    expect(context.groupId).toBeUndefined();
  });

  it('uses a resizable bottom-right floating panel', () => {
    const { getByTestId } = render(<TopicChatDrawer />);

    expect(getByTestId('topic-panel')).toHaveAttribute('data-placement', 'bottomRight');
    expect(getByTestId('topic-panel')).toHaveAttribute('data-resizable', 'true');
    expect(getByTestId('topic-panel')).toHaveAttribute('data-width', '640');
    expect(getByTestId('topic-panel')).toHaveAttribute(
      'data-height',
      'min(640px, calc(100dvh - 16px))',
    );
  });

  it('preserves a legacy personal run even when its task was moved into a group', () => {
    const { getByTestId, getByText } = render(
      <GroupWorkScopeContext value={{ groupId: 'cg_team' }}>
        <TopicChatDrawer />
      </GroupWorkScopeContext>,
    );
    const context = JSON.parse(getByTestId('conversation-context').getAttribute('data-context')!);
    expect(context.groupId).toBeUndefined();
    expect(context.scope).toBe('main');
    fireEvent.click(getByText('taskDetail.topicMenu.openAgentTopic'));
    expect(mocks.navigate).toHaveBeenCalledWith('/agent/agt_assignee/topic-1');
  });

  it('does not open a personal conversation before the topic ownership is resolved', () => {
    mocks.chatState.useFetchTopicDetail.mockReturnValue({ data: undefined });
    const { getByText, queryByTestId } = render(<TopicChatDrawer />);
    fireEvent.click(getByText('taskDetail.topicMenu.openAgentTopic'));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(queryByTestId('conversation-context')).not.toBeInTheDocument();
  });

  it.each([
    [{ data: null }, 'topic-not-found'],
    [{ data: undefined, error: new Error('forbidden') }, 'topic-error'],
  ])(
    'does not mount a conversation for missing or forbidden topic detail %#',
    (response, testId) => {
      mocks.chatState.useFetchTopicDetail.mockReturnValue(response);
      const { getByTestId, getByText, queryByTestId } = render(<TopicChatDrawer />);
      expect(getByTestId(testId)).toBeInTheDocument();
      expect(queryByTestId('conversation-context')).not.toBeInTheDocument();
      fireEvent.click(getByText('taskDetail.topicMenu.openAgentTopic'));
      expect(mocks.navigate).not.toHaveBeenCalled();
    },
  );

  it('uses actual group ownership outside a group page for sharing and reconnect', () => {
    mocks.chatState.useFetchTopicDetail.mockReturnValue({
      data: { id: 'topic-1', groupId: 'cg_actual' },
    });
    const { getByText } = render(<TopicChatDrawer />);
    fireEvent.click(getByText('taskDetail.topicMenu.openGroupTopic'));
    expect(mocks.navigate).toHaveBeenCalledWith('/group/cg_actual/topic-1');
    expect(mocks.shareOptions).toHaveBeenLastCalledWith({
      context: {
        agentId: 'agt_assignee',
        groupId: 'cg_actual',
        isolatedTopic: true,
        threadId: null,
        topicId: 'topic-1',
      },
    });
    expect(useGatewayReconnect).toHaveBeenLastCalledWith(
      'topic-1',
      undefined,
      'agt_assignee',
      undefined,
      expect.objectContaining({ groupId: 'cg_actual', isolatedTopic: true, scope: 'group' }),
    );
  });

  it.each([true, false])(
    'follows an already-connected run without overwriting its bucket (task drawer active: %s)',
    (taskDrawerActive) => {
      mocks.chatState.useFetchTopicDetail.mockReturnValue({
        data: { id: 'topic-1', groupId: 'cg_actual' },
      });
      mocks.taskState.taskDetailMap['T-1'].activities[0].runningOperation = {
        assistantMessageId: 'ast',
        operationId: 'server-op',
      };
      mocks.chatState.operations.live = {
        context: {
          agentId: 'agt_assignee',
          groupId: 'cg_actual',
          scope: 'group',
          topicId: 'topic-1',
        },
        metadata: { serverOperationId: 'server-op' },
        status: 'running',
      };
      if (!taskDrawerActive) {
        mocks.taskState.activeTopicDrawerTopicId = '';
        mocks.chatState.useFetchTopicDetail.mockReturnValue({
          data: {
            id: 'topic-1',
            groupId: 'cg_actual',
            metadata: { runningOperation: { assistantMessageId: 'ast', operationId: 'server-op' } },
          },
        });
      }
      mocks.chatState.dbMessagesMap['group_cg_actual_topic-1'] = [
        { id: 'ast', topicId: 'topic-1', content: 'draft' },
        { id: 'other', topicId: 'topic-other', content: 'unrelated' },
      ];
      const { getByTestId, rerender } = render(
        <TopicChatDrawerBody agentId="agt_assignee" topicId="topic-1" />,
      );
      const panel = getByTestId('conversation-context');
      expect(panel).toHaveAttribute('data-skip-fetch', 'true');
      const provider = mocks.providerOptions.mock.lastCall![0];
      provider.onMessagesChange(
        [{ id: 'ast', topicId: 'topic-1', content: 'filtered' }],
        provider.context,
      );
      expect(mocks.chatState.replaceMessages).not.toHaveBeenCalled();
      expect(JSON.parse(panel.getAttribute('data-context')!).isolatedTopic).not.toBe(true);
      expect(JSON.parse(panel.getAttribute('data-messages')!)).toEqual([
        { id: 'ast', topicId: 'topic-1', content: 'draft' },
      ]);
      mocks.chatState.dbMessagesMap['group_cg_actual_topic-1'] = [
        { id: 'ast', topicId: 'topic-1', content: 'finished' },
      ];
      mocks.chatState.operations.live.status = 'completed';
      rerender(
        <TopicChatDrawerBody disableInputCollapse agentId="agt_assignee" topicId="topic-1" />,
      );
      expect(
        JSON.parse(getByTestId('conversation-context').getAttribute('data-messages')!)[0].content,
      ).toBe('finished');
    },
  );
});
