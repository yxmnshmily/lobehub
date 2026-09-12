/**
 * @vitest-environment happy-dom
 */
import type { UIChatMessage } from '@lobechat/types';
import { ModalHost } from '@lobehub/ui/base-ui';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { createElement, Fragment } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MemberConversation from './index';
import { useMemberConversation } from './useMemberConversation';

const mocks = vi.hoisted(() => ({
  mobileClient: false,
  narrowViewport: false,
  invalidateMessages: vi.fn(),
  invalidatePublished: vi.fn(),
  invalidateTopics: vi.fn(),
  fetchNextPage: vi.fn(),
  additionalPages: [] as Array<{
    items: Array<{
      authorKind: 'member';
      content: string;
      publicMessageId: string;
      topicId: string;
      visibleAt: Date;
    }>;
    nextCursor: null;
  }>,
  published: {
    data: [] as Array<{
      executionMessages?: UIChatMessage[];
      isGenerating?: boolean;
      id: string;
      kind: 'assistant';
      content: string;
      topicId: string;
      visibleAt: Date;
    }>,
    isError: false,
    error: undefined as unknown,
    isLoading: false,
    refetch: vi.fn(),
  },
  routeTopic: undefined as string | undefined,
  setSearchParams: vi.fn(),
  participants: {
    data: {
      assistants: [
        { id: 'writer-1', title: '文案助理', avatar: null, description: '旅游文案' },
        { id: 'designer-1', title: '美工助理', avatar: null, description: '旅游图片' },
      ],
    },
    isError: false,
  },
  participantsInput: undefined as unknown,
  createMessage: vi.fn(),
  updateMessage: vi.fn(),
  createTopic: vi.fn(),
  getHostedTravelGroupRunStatus: vi.fn(),
  interruptHostedTravelGroupRun: vi.fn(),
  startHostedTravelGroupTask: vi.fn(),
  messageInput: undefined as unknown,
  messages: {
    data: undefined as
      | {
          items: Array<{
            authorKind: 'member' | 'owner' | 'self';
            content: string;
            publicMessageId: string;
            topicId: string;
            visibleAt: Date;
          }>;
          nextCursor: { createdAt: Date; id: string } | null;
        }
      | undefined,
    error: undefined as unknown,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  },
  topicInput: undefined as unknown,
  topics: {
    data: undefined as
      | {
          items: Array<{ createdAt: Date; id: string; title: string | null }>;
          nextCursor: null;
        }
      | undefined,
    error: undefined as unknown,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  },
  uuid: vi.fn(),
}));

vi.mock('react-router', () => ({
  useLocation: () => ({ pathname: '/group/group-1', search: '', hash: '', key: 'current' }),
  useNavigate: () => mocks.setSearchParams,
  useParams: () => ({ topicId: mocks.routeTopic }),
  useSearchParams: () => [new URLSearchParams(), mocks.setSearchParams],
}));
vi.mock('@lobechat/utils', () => ({ uuid: mocks.uuid }));
vi.mock('@/features/Conversation', () => ({
  ConversationProvider: ({ children }: { children: React.ReactNode }) => children,
  ChatList: () => null,
  MessageItem: () => null,
}));
vi.mock('../Conversation/ConversationArea', () => ({
  GroupConversationBody: ({ runtimeProps }: any) =>
    createElement('div', {
      'data-testid': 'shared-group-conversation',
      'data-mentions': runtimeProps.mentionItems.length,
    }),
}));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mocks.narrowViewport }));
vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: { isMobile: boolean }) => unknown) =>
    selector({ isMobile: mocks.mobileClient }),
}));
vi.mock('@/hooks/useQueryRoute', () => ({
  useQueryRoute: () => ({
    replace: (path: string) => {
      mocks.setSearchParams(path);
      mocks.routeTopic = new URL(path, 'http://localhost').pathname.split('/')[3];
    },
  }),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    aiAgent: {
      getHostedTravelGroupRunStatus: {
        query: mocks.getHostedTravelGroupRunStatus,
      },
    },
  },
  lambdaQuery: {
    useUtils: () => ({
      groupConversation: {
        listTextMessages: { invalidate: mocks.invalidateMessages },
        listPublishedAssistantMessages: { invalidate: mocks.invalidatePublished },
        listTopics: { invalidate: mocks.invalidateTopics },
      },
    }),
    groupMembership: {
      listParticipants: {
        useQuery: (input: unknown) => {
          mocks.participantsInput = input;
          return mocks.participants;
        },
      },
    },
    aiAgent: {
      interruptHostedTravelGroupRun: {
        useMutation: () => ({ mutateAsync: mocks.interruptHostedTravelGroupRun }),
      },
      startHostedTravelGroupTask: {
        useMutation: () => ({ mutateAsync: mocks.startHostedTravelGroupTask }),
      },
    },
    groupConversation: {
      listPublishedAssistantMessages: { useQuery: () => mocks.published },
      createTextMessage: { useMutation: () => ({ mutateAsync: mocks.createMessage }) },
      updateTextMessage: { useMutation: () => ({ mutateAsync: mocks.updateMessage }) },
      createTopic: { useMutation: () => ({ mutateAsync: mocks.createTopic }) },
      listTextMessages: {
        useInfiniteQuery: (input: unknown) => {
          mocks.messageInput = input;
          return {
            ...mocks.messages,
            data: mocks.messages.data
              ? { pages: [mocks.messages.data, ...mocks.additionalPages] }
              : undefined,
            hasNextPage: Boolean(mocks.messages.data?.nextCursor),
            isFetchingNextPage: false,
            fetchNextPage: mocks.fetchNextPage,
          };
        },
      },
      listTopics: {
        useQuery: (input: unknown) => {
          mocks.topicInput = input;
          return mocks.topics;
        },
      },
    },
  },
}));

const group = {
  avatar: '🏔️',
  groupId: 'group-1',
  joinedAt: new Date('2026-09-04T02:00:00.000Z'),
  kind: 'member' as const,
  membershipVersion: 2,
  title: '默认私人旅游群',
};

describe('useMemberConversation', () => {
  it('renders another member’s live steps but does not retry an unfinished publication', async () => {
    mocks.published.data = [
      {
        id: 'live',
        kind: 'assistant',
        content: '执行中',
        topicId: 'topic',
        visibleAt: new Date(),
        isGenerating: true,
        executionMessages: [
          {
            id: 'live-step',
            content: '正在调用工具',
            role: 'assistant',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
    ];
    const { result } = renderHook(() => useMemberConversation(group, vi.fn()));
    expect(result.current.messages[0]).toMatchObject({ executionMessages: [{ id: 'live-step' }] });
    expect(
      result.current.conversationHooks.canPerformMessageAction!('regenerate', 'live-step'),
    ).toBe(false);
    await act(async () => {
      await result.current.conversationHooks.onRegenerateMessage!('live-step');
    });
    expect(mocks.startHostedTravelGroupTask).not.toHaveBeenCalled();
  });
  it.each(['final', 'tool-step'])(
    'regenerates from %s by the original publication, not nearby chat',
    async (target) => {
      const id = 'a'.repeat(64);
      mocks.published.data = [
        {
          id,
          kind: 'assistant',
          content: '旧任务结果',
          topicId: 'topic',
          visibleAt: new Date(),
          executionMessages: [
            { id: 'tool-step', role: 'assistant', content: '', createdAt: 1, updatedAt: 1 },
          ],
        },
      ];
      mocks.startHostedTravelGroupTask.mockResolvedValue({
        accepted: true,
        runHandle: 'r'.repeat(43),
      });
      mocks.getHostedTravelGroupRunStatus.mockResolvedValue({ status: 'done' });
      const { result } = renderHook(() => useMemberConversation(group, vi.fn()));
      await act(async () => {
        await result.current.conversationHooks.onRegenerateMessage!(
          target === 'final' ? id : target,
        );
      });
      expect(mocks.startHostedTravelGroupTask).toHaveBeenCalledWith({
        billing: { idempotencyKey: 'request-1' },
        groupId: 'group-1',
        regenerateMessageId: id,
      });
    },
  );
  it('passes published AI attachments to the shared message renderer', () => {
    mocks.published.data = [
      Object.assign(
        {
          id: 'published-file',
          kind: 'assistant' as const,
          content: '已生成行程',
          topicId: 'topic',
          visibleAt: new Date(),
        },
        {
          fileList: [
            {
              id: 'file',
              name: '行程.pdf',
              size: 42,
              fileType: 'application/pdf',
              url: '/shared/file',
            },
          ],
          imageList: [{ id: 'image', url: '/shared/image', alt: '路线图' }],
        },
      ),
    ];
    const { result } = renderHook(() => useMemberConversation(group, vi.fn()));
    expect(result.current.messages[0]).toMatchObject({
      id: 'published-file',
      fileList: [{ id: 'file', name: '行程.pdf' }],
      imageList: [{ id: 'image', url: '/shared/image' }],
    });
  });
  it('routes the shared editor mentions and attachments through the authorized task API', async () => {
    mocks.startHostedTravelGroupTask.mockResolvedValue({
      accepted: true,
      runHandle: 'r'.repeat(43),
      resultTopicId: 'topic-1',
    });
    const { result } = renderHook(() => useMemberConversation(group, vi.fn()));
    await act(async () => {
      await result.current.conversationHooks.onSendMessage!({
        message: '@文案助理 写行程',
        files: [{ id: 'file-1' }] as any,
        editorData: {
          root: {
            children: [
              { type: 'mention', value: '文案助理', metadata: { type: 'agent', id: 'writer-1' } },
            ],
          },
        },
      });
    });
    expect(mocks.startHostedTravelGroupTask).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: 'group-1',
        mentionedAgentIds: ['writer-1'],
        fileIds: ['file-1'],
      }),
    );
  });

  it('allows shared mutation controls only on the current member own messages', async () => {
    mocks.messages.data = {
      items: [
        {
          authorKind: 'self',
          content: 'mine',
          publicMessageId: 'mine',
          topicId: 'topic-1',
          visibleAt: new Date(),
        },
        {
          authorKind: 'member',
          content: 'other',
          publicMessageId: 'other',
          topicId: 'topic-2',
          visibleAt: new Date(),
        },
      ],
      nextCursor: null,
    };
    const { result } = renderHook(() => useMemberConversation(group, vi.fn()));
    expect(result.current.conversationHooks.canPerformMessageAction?.('edit', 'mine')).toBe(true);
    expect(result.current.conversationHooks.canPerformMessageAction?.('edit', 'other')).toBe(false);
    expect(result.current.conversationHooks.canPerformMessageAction?.('copy', 'other')).toBe(true);
    expect(result.current.conversationHooks.canPerformMessageAction?.('download', 'other')).toBe(
      true,
    );
    await act(async () => {
      await result.current.conversationHooks.onUpdateMessageContent!('mine', 'edited');
    });
    expect(mocks.updateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ publicMessageId: 'mine', content: 'edited', groupId: 'group-1' }),
    );
    await expect(result.current.conversationHooks.onDeleteMessage!('other')).rejects.toThrow(
      '只能修改自己发送的消息',
    );
  });
  beforeEach(() => {
    mocks.mobileClient = false;
    mocks.narrowViewport = false;
    mocks.invalidateMessages.mockReset();
    mocks.invalidatePublished.mockReset();
    mocks.invalidateTopics.mockReset();
    mocks.fetchNextPage.mockReset();
    mocks.additionalPages = [];
    mocks.published.data = [];
    mocks.published.isError = false;
    mocks.published.error = undefined;
    mocks.routeTopic = undefined;
    mocks.setSearchParams.mockReset();
    mocks.participants.isError = false;
    mocks.createMessage.mockReset();
    mocks.createTopic.mockReset();
    mocks.getHostedTravelGroupRunStatus.mockReset();
    mocks.interruptHostedTravelGroupRun.mockReset();
    mocks.startHostedTravelGroupTask.mockReset();
    mocks.messages.data = undefined;
    mocks.messages.error = undefined;
    mocks.messages.isError = false;
    mocks.messages.isLoading = false;
    mocks.messages.refetch.mockReset();
    mocks.topics.data = undefined;
    mocks.topics.error = undefined;
    mocks.topics.isError = false;
    mocks.topics.isLoading = false;
    mocks.topics.refetch.mockReset();
    mocks.uuid.mockReset();
    mocks.uuid.mockReturnValueOnce('request-1').mockReturnValueOnce('request-2');
    vi.stubGlobal('crypto', { randomUUID: mocks.uuid });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shares the member panel first-page query key so a panel retry restores mention availability', () => {
    renderHook(() => useMemberConversation(group, vi.fn()));
    expect(mocks.participantsInput).toEqual({ groupId: 'group-1', limit: 50, offset: 0 });
  });

  it.each([
    [false, true],
    [true, false],
    [false, false],
  ])(
    'keeps one conversation for mobile client %s and narrow viewport %s',
    async (mobileClient, narrowViewport) => {
      mocks.mobileClient = mobileClient;
      mocks.narrowViewport = narrowViewport;
      render(
        createElement(
          Fragment,
          null,
          createElement(MemberConversation, { group, onUnavailable: vi.fn() }),
          createElement(ModalHost),
        ),
      );
      expect(screen.queryByRole('navigation', { name: '群聊话题' })).toBeNull();
      expect(screen.queryByRole('button', { name: /历史会话/ })).toBeNull();
      expect(screen.queryByRole('textbox', { name: '新话题标题' })).toBeNull();
      expect(screen.getByTestId('shared-group-conversation')).toHaveAttribute('data-mentions', '2');
    },
  );

  it('loads only the member-safe topic and pure-text message endpoints', async () => {
    mocks.topics.data = {
      items: [
        { createdAt: new Date('2026-09-04T03:00:00.000Z'), id: 'topic-1', title: '行程讨论' },
      ],
      nextCursor: null,
    };
    mocks.messages.data = {
      items: [
        {
          authorKind: 'owner',
          content: '欢迎入群',
          publicMessageId: 'b'.repeat(64),
          topicId: 'topic-1',
          visibleAt: new Date('2026-09-04T03:01:00.000Z'),
        },
      ],
      nextCursor: null,
    };

    const { result } = renderHook(() => useMemberConversation(group, vi.fn()));

    await waitFor(() => expect(result.current.activeTopicId).toBe('topic-1'));
    expect(result.current.messages).toEqual([expect.objectContaining({ content: '欢迎入群' })]);
    expect(mocks.topicInput).toEqual({ groupId: 'group-1', limit: 20, recent: true });
    expect(mocks.messageInput).toEqual({
      order: 'latest',
      groupId: 'group-1',
      limit: 50,
    });
  });

  it('locates an old URL topic while continuing to write in the existing conversation', async () => {
    mocks.routeTopic = 'old-topic';
    mocks.topics.data = {
      items: [{ id: 'new-topic', title: '最新话题', createdAt: new Date() }],
      nextCursor: null,
    };
    const { result } = renderHook(() => useMemberConversation(group, vi.fn()));
    await waitFor(() => expect(result.current.activeTopicId).toBe('new-topic'));
    expect(mocks.setSearchParams).not.toHaveBeenCalled();
    expect(result.current.historyTopicId).toBe('old-topic');
    expect(mocks.messageInput).toEqual({
      order: 'latest',
      groupId: 'group-1',
      limit: 50,
      topicId: 'old-topic',
    });
  });

  it('keeps a finite recent window but retains the selected topic history', async () => {
    mocks.topics.data = {
      items: [{ id: 'topic-1', title: '群聊', createdAt: new Date() }],
      nextCursor: null,
    };
    mocks.published.data = Array.from({ length: 205 }, (_, index) => ({
      id: `published-${index}`,
      kind: 'assistant' as const,
      content: `answer-${index}`,
      topicId: 'topic-1',
      visibleAt: new Date(index * 1000),
    }));
    const { result, rerender } = renderHook(() => useMemberConversation(group, vi.fn()));
    expect(result.current.messages).toHaveLength(200);
    expect(result.current.messages[0].id).toBe('published-5');
    mocks.routeTopic = 'topic-1';
    rerender();
    expect(result.current.messages).toHaveLength(205);
    expect(mocks.messageInput).toMatchObject({ topicId: 'topic-1' });
  });

  it('passes multiple safe assistant IDs separately from the prompt and clears selection on group change', async () => {
    mocks.startHostedTravelGroupTask.mockResolvedValue({
      accepted: true,
      runHandle: 'G'.repeat(43),
    });
    mocks.getHostedTravelGroupRunStatus.mockResolvedValue({ status: 'completed' });
    const onUnavailable = vi.fn();
    const { result, rerender } = renderHook(
      ({ currentGroup }) => useMemberConversation(currentGroup, onUnavailable),
      { initialProps: { currentGroup: group } },
    );
    act(() => {
      result.current.setMentionedAgentIds(['writer-1', 'designer-1']);
      result.current.setDraft('写旅游文案');
    });
    await act(() => result.current.handoffToTravelHostAi());
    expect(mocks.startHostedTravelGroupTask).toHaveBeenCalledWith(
      expect.objectContaining({
        mentionedAgentIds: ['writer-1', 'designer-1'],
        prompt: '写旅游文案',
      }),
    );
    rerender({ currentGroup: { ...group, groupId: 'group-2' } });
    expect(result.current.mentionedAgentIds).toEqual([]);
  });

  it('rejects an assistant selection that is not in the current safe roster', async () => {
    const { result } = renderHook(() => useMemberConversation(group, vi.fn()));
    act(() => {
      result.current.setMentionedAgentIds(['writer-1', 'other-group-agent']);
      result.current.setDraft('写旅游文案');
    });
    await act(() => result.current.handoffToTravelHostAi());
    expect(mocks.startHostedTravelGroupTask).not.toHaveBeenCalled();
    expect(result.current.draft).toBe('写旅游文案');
  });

  it('retains a message above the AI prompt limit without starting a task, but allows ordinary chat', async () => {
    mocks.routeTopic = 'topic-1';
    mocks.topics.data = {
      items: [{ id: 'topic-1', title: '群聊', createdAt: new Date() }],
      nextCursor: null,
    };
    mocks.createMessage.mockResolvedValue({ publicMessageId: 'message-1' });
    const { result } = renderHook(() => useMemberConversation(group, vi.fn()));
    act(() => result.current.setDraft('a'.repeat(4001)));
    await act(() => result.current.handoffToTravelHostAi());
    expect(mocks.startHostedTravelGroupTask).not.toHaveBeenCalled();
    expect(result.current.draft).toHaveLength(4001);
    expect(result.current.feedback).toContain('4000');
    await act(() => result.current.sendMessage());
    expect(mocks.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'a'.repeat(4001) }),
    );
  });

  it('locates an archived topic without changing the active send context', async () => {
    mocks.topics.data = {
      items: [{ id: 'latest-topic', title: '当前归档', createdAt: new Date() }],
      nextCursor: null,
    };
    const { result } = renderHook(() => useMemberConversation(group, vi.fn()));
    await waitFor(() => expect(result.current.activeTopicId).toBe('latest-topic'));
    act(() => result.current.setActiveTopicId('older-topic', 'latest-public-message'));
    expect(result.current.activeTopicId).toBe('latest-topic');
    expect(mocks.setSearchParams).toHaveBeenCalledWith(
      expect.stringContaining('#latest-public-message'),
    );
  });

  it('selects only the server-verified result topic without restarting the current route', async () => {
    mocks.startHostedTravelGroupTask.mockResolvedValue({
      accepted: true,
      runHandle: 'H'.repeat(43),
      resultTopicId: 'my-result-topic',
    });
    mocks.getHostedTravelGroupRunStatus.mockResolvedValue({
      status: 'done',
      resultTopicId: 'my-result-topic',
    });
    const { result } = renderHook(() => useMemberConversation(group, vi.fn()));
    act(() => result.current.setDraft('完成任务'));
    await act(() => result.current.handoffToTravelHostAi());
    expect(result.current.activeTopicId).toBe('my-result-topic');
    expect(mocks.setSearchParams).not.toHaveBeenCalled();
    expect(result.current.aiTaskStatus).toBe('completed');
    expect(mocks.invalidateMessages).toHaveBeenCalledWith({
      groupId: 'group-1',
    });
    expect(mocks.invalidatePublished).toHaveBeenCalledWith({
      groupId: 'group-1',
    });
  });

  it.each([
    ['error', 'failed', false],
    ['waiting_for_async_tool', 'running', true],
    ['waiting_for_human', 'waiting', true],
  ] as const)(
    'recognizes runtime %s and keeps the correct stop action',
    async (runtimeStatus, displayStatus, canStop) => {
      mocks.startHostedTravelGroupTask.mockResolvedValue({
        accepted: true,
        runHandle: 'J'.repeat(43),
      });
      mocks.getHostedTravelGroupRunStatus.mockResolvedValue({ status: runtimeStatus });
      mocks.interruptHostedTravelGroupRun.mockResolvedValue({ interrupted: true });
      const { result } = renderHook(() => useMemberConversation(group, vi.fn()));
      act(() => result.current.setDraft('处理群任务'));
      await act(() => result.current.handoffToTravelHostAi());
      expect(result.current.aiTaskStatus).toBe(displayStatus);
      expect(result.current.canInterruptAiTask).toBe(canStop);
      expect(result.current.feedback).not.toBe('任务状态暂时无法读取');
      if (canStop) {
        await act(() => result.current.interruptTravelHostAi());
        expect(mocks.interruptHostedTravelGroupRun).toHaveBeenCalledWith({
          groupId: 'group-1',
          runHandle: 'J'.repeat(43),
        });
      }
    },
  );

  it('merges only published assistant text with paginated human history', async () => {
    mocks.routeTopic = 'topic-1';
    mocks.messages.data = {
      items: [
        {
          authorKind: 'owner',
          content: '第一条',
          publicMessageId: 'human-1',
          topicId: 'topic-1',
          visibleAt: new Date('2026-09-05T01:00:00Z'),
        },
      ],
      nextCursor: { createdAt: new Date('2026-09-05T01:00:00Z'), id: 'cursor-1' },
    };
    mocks.published.data = [
      {
        id: 'published-1',
        kind: 'assistant',
        content: '已发布的最终回复',
        topicId: 'topic-1',
        visibleAt: new Date('2026-09-05T01:01:00Z'),
      },
    ];
    const { result, rerender } = renderHook(() => useMemberConversation(group, vi.fn()));
    expect(result.current.messages.map((message) => message.content)).toEqual([
      '第一条',
      '已发布的最终回复',
    ]);
    await act(() => result.current.messagesQuery.fetchNextPage());
    expect(mocks.fetchNextPage).toHaveBeenCalledOnce();
    mocks.additionalPages = [
      {
        items: [
          {
            authorKind: 'member',
            content: '第51条',
            publicMessageId: 'human-51',
            topicId: 'topic-1',
            visibleAt: new Date('2026-09-05T01:02:00Z'),
          },
        ],
        nextCursor: null,
      },
    ];
    rerender();
    expect(result.current.messages.map((message) => message.content)).toEqual([
      '第一条',
      '已发布的最终回复',
      '第51条',
    ]);
  });

  it('creates a topic with a trimmed title and a fresh idempotency key', async () => {
    mocks.topics.data = { items: [], nextCursor: null };
    mocks.createTopic.mockResolvedValue({
      createdAt: new Date('2026-09-04T03:00:00.000Z'),
      id: 'topic-new',
      title: '成员新话题',
    });
    const { result } = renderHook(() => useMemberConversation(group, vi.fn()));

    act(() => result.current.setTopicTitle('  成员新话题  '));
    await act(() => result.current.createTopic());

    expect(mocks.createTopic).toHaveBeenCalledWith({
      groupId: 'group-1',
      idempotencyKey: 'request-1',
      title: '成员新话题',
    });
    expect(mocks.topics.refetch).toHaveBeenCalledOnce();
    expect(result.current.topicTitle).toBe('');
  });

  it('preserves a failed message draft and clears it only after a successful retry', async () => {
    mocks.topics.data = {
      items: [
        { createdAt: new Date('2026-09-04T03:00:00.000Z'), id: 'topic-1', title: '行程讨论' },
      ],
      nextCursor: null,
    };
    mocks.messages.data = { items: [], nextCursor: null };
    mocks.createMessage.mockRejectedValueOnce(new Error('private server detail'));
    const { result } = renderHook(() => useMemberConversation(group, vi.fn()));
    await waitFor(() => expect(result.current.activeTopicId).toBe('topic-1'));

    act(() => result.current.setDraft('  我们几点出发？  '));
    await act(() => result.current.sendMessage());

    expect(result.current.draft).toBe('  我们几点出发？  ');
    expect(result.current.feedback).toBe('消息未发送，请重试');

    mocks.createMessage.mockResolvedValueOnce({ publicMessageId: 'c'.repeat(64) });
    await act(() => result.current.sendMessage());

    expect(mocks.createMessage).toHaveBeenLastCalledWith({
      content: '我们几点出发？',
      groupId: 'group-1',
      idempotencyKey: 'request-2',
      topicId: 'topic-1',
    });
    expect(mocks.invalidateMessages).toHaveBeenCalledWith({
      groupId: 'group-1',
    });
    expect(result.current.draft).toBe('');
  });

  it('sends the live original-editor value instead of a delayed draft mirror', async () => {
    mocks.topics.data = {
      items: [{ id: 'topic-1', title: '话题', createdAt: new Date() }],
      nextCursor: null,
    };
    mocks.createMessage.mockResolvedValue({ publicMessageId: 'message-live' });
    const { result } = renderHook(() => useMemberConversation(group, vi.fn()));
    await waitFor(() => expect(result.current.activeTopicId).toBe('topic-1'));
    await act(async () => {
      await result.current.sendMessage('原版编辑器即时内容');
    });
    expect(mocks.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: 'group-1',
        topicId: 'topic-1',
        content: '原版编辑器即时内容',
      }),
    );
  });

  it('returns from history to the recent window only after a successful send', async () => {
    mocks.routeTopic = 'old-topic';
    mocks.topics.data = {
      items: [{ id: 'topic-1', title: '近期话题', createdAt: new Date() }],
      nextCursor: null,
    };
    mocks.createMessage.mockRejectedValueOnce(new Error('发送失败'));
    const { result } = renderHook(() => useMemberConversation(group, vi.fn()));
    await waitFor(() => expect(result.current.activeTopicId).toBe('topic-1'));
    await act(() => result.current.sendMessage('测试消息'));
    expect(mocks.setSearchParams).not.toHaveBeenCalled();
    mocks.createMessage.mockResolvedValue({ publicMessageId: 'new-message' });
    await act(() => result.current.sendMessage('测试消息'));
    expect(mocks.createMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ topicId: 'topic-1' }),
    );
    expect(mocks.setSearchParams).toHaveBeenCalledWith('/group/group-1');
  });

  it('creates the first topic in the real joined group before sending, without a separate new-topic form', async () => {
    mocks.createTopic.mockResolvedValue({ id: 'first-topic' });
    mocks.createMessage.mockResolvedValue({ publicMessageId: 'first-message' });
    const { result } = renderHook(() => useMemberConversation(group, vi.fn()));
    await act(async () => {
      await result.current.sendMessage('第一条群消息');
    });
    expect(mocks.createTopic).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 'group-1', title: '第一条群消息' }),
    );
    expect(mocks.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: 'group-1',
        topicId: 'first-topic',
        content: '第一条群消息',
      }),
    );
  });

  it('ignores a message response after switching groups without clearing the new draft', async () => {
    mocks.topics.data = {
      items: [{ id: 'topic-1', title: '话题', createdAt: new Date() }],
      nextCursor: null,
    };
    let finish!: () => void;
    mocks.createMessage.mockReturnValue(
      new Promise<unknown>((resolve) => {
        finish = () => resolve(undefined);
      }),
    );
    const onUnavailable = vi.fn();
    const { result, rerender } = renderHook(
      ({ currentGroup }) => useMemberConversation(currentGroup, onUnavailable),
      { initialProps: { currentGroup: group } },
    );
    await waitFor(() => expect(result.current.activeTopicId).toBe('topic-1'));
    act(() => result.current.setDraft('旧群消息'));
    let pending!: ReturnType<typeof result.current.sendMessage>;
    act(() => {
      pending = result.current.sendMessage();
    });
    rerender({ currentGroup: { ...group, groupId: 'group-2' } });
    act(() => result.current.setDraft('新群草稿'));
    await act(async () => {
      finish();
      await pending;
    });
    expect(result.current.draft).toBe('新群草稿');
    expect(result.current.isSending).toBe(false);
    expect(mocks.messages.refetch).not.toHaveBeenCalled();
  });

  it('hands a trimmed request to the server-authorized travel host AI without privileged fields', async () => {
    mocks.topics.data = {
      items: [
        { createdAt: new Date('2026-09-04T03:00:00.000Z'), id: 'topic-1', title: '行程讨论' },
      ],
      nextCursor: null,
    };
    mocks.messages.data = { items: [], nextCursor: null };
    mocks.startHostedTravelGroupTask.mockResolvedValue({
      accepted: true,
      runHandle: 'A'.repeat(43),
    });
    mocks.getHostedTravelGroupRunStatus.mockResolvedValue({
      completedAt: null,
      errorSummary: null,
      startedAt: null,
      status: 'queued',
      updatedAt: '2026-09-04T03:10:00.000Z',
    });
    const { result } = renderHook(() => useMemberConversation(group, vi.fn()));
    await waitFor(() => expect(result.current.activeTopicId).toBe('topic-1'));

    act(() => result.current.setDraft('  帮我写一篇西藏旅游文案  '));
    await act(() => result.current.handoffToTravelHostAi());

    expect(mocks.startHostedTravelGroupTask).toHaveBeenCalledWith({
      billing: { idempotencyKey: 'request-1' },
      groupId: 'group-1',
      prompt: '帮我写一篇西藏旅游文案',
    });
    expect(Object.keys(mocks.startHostedTravelGroupTask.mock.calls[0][0]).sort()).toEqual([
      'billing',
      'groupId',
      'prompt',
    ]);
    expect(mocks.getHostedTravelGroupRunStatus).toHaveBeenCalledWith({
      groupId: 'group-1',
      runHandle: 'A'.repeat(43),
    });
    expect(result.current.aiTaskStatus).toBe('queued');
    expect(result.current.draft).toBe('');
  });

  it('runs only one host-AI request at a time and keeps the draft when admission fails', async () => {
    mocks.topics.data = {
      items: [
        { createdAt: new Date('2026-09-04T03:00:00.000Z'), id: 'topic-1', title: '行程讨论' },
      ],
      nextCursor: null,
    };
    mocks.messages.data = { items: [], nextCursor: null };
    let rejectRequest: (reason?: unknown) => void = () => {};
    mocks.startHostedTravelGroupTask.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRequest = reject;
      }),
    );
    const { result } = renderHook(() => useMemberConversation(group, vi.fn()));
    await waitFor(() => expect(result.current.activeTopicId).toBe('topic-1'));
    act(() => result.current.setDraft('帮我做一张西藏封面图'));

    let firstRequest!: Promise<unknown>;
    act(() => {
      firstRequest = result.current.handoffToTravelHostAi();
      void result.current.handoffToTravelHostAi();
    });
    expect(result.current.aiTaskStatus).toBe('submitting');
    expect(mocks.startHostedTravelGroupTask).toHaveBeenCalledOnce();

    await act(async () => {
      rejectRequest(new Error('private server detail'));
      await firstRequest;
    });
    expect(result.current.aiTaskStatus).toBe('idle');
    expect(result.current.feedback).toBe('旅游群主AI未受理，请重试');
    expect(result.current.draft).toBe('帮我做一张西藏封面图');
  });

  it('explains group-owner 积分 admission failure and still allows a plain group message', async () => {
    mocks.startHostedTravelGroupTask.mockRejectedValueOnce(
      new Error('[GROUP_OWNER_CREDITS_EMPTY] private detail'),
    );
    mocks.createTopic.mockResolvedValueOnce({ id: 'plain-topic' });
    mocks.createMessage.mockResolvedValueOnce({ publicMessageId: 'plain-message' });
    const { result } = renderHook(() => useMemberConversation(group, vi.fn()));
    act(() => result.current.setDraft('群里讨论一下'));
    await act(() => result.current.handoffToTravelHostAi());
    expect(result.current.feedback).toBe(
      '该群主余额不足，AI 任务未启动。请联系群主补充积分；仍可选择“仅发送群消息，不调用 AI”。',
    );
    expect(result.current.aiTaskStatus).toBe('idle');
    expect(result.current.draft).toBe('群里讨论一下');
    expect(mocks.createMessage).not.toHaveBeenCalled();
    expect(mocks.getHostedTravelGroupRunStatus).not.toHaveBeenCalled();
    await act(() => result.current.sendMessage());
    expect(mocks.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 'group-1', content: '群里讨论一下' }),
    );
    expect(result.current.draft).toBe('');
  });

  it('explains the 50k 积分 floor and preserves the draft when the task is not started', async () => {
    mocks.startHostedTravelGroupTask.mockRejectedValueOnce(
      new Error('[PLATFORM_CREDITS_FLOOR] private detail'),
    );
    const { result } = renderHook(() => useMemberConversation(group, vi.fn()));
    act(() => result.current.setDraft('继续生成旅游文案'));

    await act(() => result.current.handoffToTravelHostAi());

    expect(result.current.feedback).toBe(
      '积分预算不足：余额低于 5 万，AI 任务未启动。充值后可继续，当前输入已保留。',
    );
    expect(result.current.aiTaskStatus).toBe('idle');
    expect(result.current.draft).toBe('继续生成旅游文案');
    expect(mocks.createMessage).not.toHaveBeenCalled();
    expect(mocks.getHostedTravelGroupRunStatus).not.toHaveBeenCalled();
  });

  it('ignores a hosted-task admission that resolves after the member changes groups', async () => {
    mocks.topics.data = { items: [], nextCursor: null };
    let resolveRequest: (value: { accepted: true; runHandle: string }) => void = () => {};
    mocks.startHostedTravelGroupTask.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const onUnavailable = vi.fn();
    const { rerender, result } = renderHook(
      ({ currentGroup }) => useMemberConversation(currentGroup, onUnavailable),
      { initialProps: { currentGroup: group } },
    );
    act(() => result.current.setDraft('生成旅游文案'));
    let request!: Promise<unknown>;
    act(() => {
      request = result.current.handoffToTravelHostAi();
    });

    rerender({ currentGroup: { ...group, groupId: 'group-2' } });
    await act(async () => {
      resolveRequest({ accepted: true, runHandle: 'F'.repeat(43) });
      await request;
    });

    expect(mocks.getHostedTravelGroupRunStatus).not.toHaveBeenCalled();
    expect(result.current.aiTaskStatus).toBe('idle');
    expect(result.current.canInterruptAiTask).toBe(false);
  });

  it('ignores an old group status rejection after switching to another group', async () => {
    mocks.topics.data = { items: [], nextCursor: null };
    mocks.startHostedTravelGroupTask.mockResolvedValue({
      accepted: true,
      runHandle: 'F'.repeat(43),
    });
    let rejectStatus!: (error: unknown) => void;
    mocks.getHostedTravelGroupRunStatus.mockReturnValue(
      new Promise((_, reject) => {
        rejectStatus = reject;
      }),
    );
    const onUnavailable = vi.fn();
    const { rerender, result } = renderHook(
      ({ currentGroup }) => useMemberConversation(currentGroup, onUnavailable),
      { initialProps: { currentGroup: group } },
    );
    act(() => result.current.setDraft('生成旅游文案'));
    let request!: Promise<unknown>;
    await act(async () => {
      request = result.current.handoffToTravelHostAi();
    });
    rerender({ currentGroup: { ...group, groupId: 'group-2' } });
    act(() => result.current.setDraft('另一个群的新草稿'));
    await act(async () => {
      rejectStatus({ data: { code: 'NOT_FOUND' } });
      await request;
    });
    expect(result.current.aiTaskStatus).toBe('idle');
    expect(result.current.feedback).toBeUndefined();
    expect(result.current.draft).toBe('另一个群的新草稿');
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it('polls the opaque run handle through real safe statuses until completion', async () => {
    mocks.topics.data = {
      items: [
        { createdAt: new Date('2026-09-04T03:00:00.000Z'), id: 'topic-1', title: '行程讨论' },
      ],
      nextCursor: null,
    };
    mocks.messages.data = { items: [], nextCursor: null };
    mocks.startHostedTravelGroupTask.mockResolvedValue({
      accepted: true,
      runHandle: 'B'.repeat(43),
    });
    mocks.getHostedTravelGroupRunStatus
      .mockResolvedValueOnce({
        completedAt: null,
        errorSummary: null,
        startedAt: '2026-09-04T03:10:00.000Z',
        status: 'running',
        updatedAt: '2026-09-04T03:10:00.000Z',
      })
      .mockResolvedValueOnce({
        completedAt: '2026-09-04T03:10:02.000Z',
        errorSummary: null,
        startedAt: '2026-09-04T03:10:00.000Z',
        status: 'completed',
        updatedAt: '2026-09-04T03:10:02.000Z',
      });
    const { result } = renderHook(() => useMemberConversation(group, vi.fn()));
    await waitFor(() => expect(result.current.activeTopicId).toBe('topic-1'));
    vi.useFakeTimers();

    act(() => result.current.setDraft('写一篇西藏文案'));
    await act(() => result.current.handoffToTravelHostAi());

    expect(result.current.aiTaskStatus).toBe('running');
    expect(result.current.canInterruptAiTask).toBe(true);

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(result.current.aiTaskStatus).toBe('completed');
    expect(result.current.canInterruptAiTask).toBe(false);
    expect(mocks.getHostedTravelGroupRunStatus).toHaveBeenNthCalledWith(2, {
      groupId: 'group-1',
      runHandle: 'B'.repeat(43),
    });
    vi.useRealTimers();
  });

  it('stops a queued hosted task with the opaque handle and no internal identifiers', async () => {
    mocks.topics.data = { items: [], nextCursor: null };
    mocks.startHostedTravelGroupTask.mockResolvedValue({
      accepted: true,
      runHandle: 'C'.repeat(43),
    });
    mocks.getHostedTravelGroupRunStatus.mockResolvedValue({
      completedAt: null,
      errorSummary: null,
      startedAt: null,
      status: 'queued',
      updatedAt: '2026-09-04T03:10:00.000Z',
    });
    mocks.interruptHostedTravelGroupRun.mockResolvedValue({ interrupted: true });
    const { result } = renderHook(() => useMemberConversation(group, vi.fn()));
    vi.useFakeTimers();

    act(() => result.current.setDraft('生成一张封面图'));
    await act(() => result.current.handoffToTravelHostAi());
    await act(() => result.current.interruptTravelHostAi());

    expect(mocks.interruptHostedTravelGroupRun).toHaveBeenCalledWith({
      groupId: 'group-1',
      runHandle: 'C'.repeat(43),
    });
    expect(Object.keys(mocks.interruptHostedTravelGroupRun.mock.calls[0][0]).sort()).toEqual([
      'groupId',
      'runHandle',
    ]);
    expect(result.current.aiTaskStatus).toBe('interrupted');
    expect(result.current.canInterruptAiTask).toBe(false);
    vi.useRealTimers();
  });

  it('clears a hosted handle and reports unavailable when status access is revoked', async () => {
    const onUnavailable = vi.fn();
    mocks.topics.data = { items: [], nextCursor: null };
    mocks.startHostedTravelGroupTask.mockResolvedValue({
      accepted: true,
      runHandle: 'D'.repeat(43),
    });
    mocks.getHostedTravelGroupRunStatus.mockRejectedValue({ data: { code: 'NOT_FOUND' } });
    const { result } = renderHook(() => useMemberConversation(group, onUnavailable));

    act(() => result.current.setDraft('生成旅游文案'));
    await act(() => result.current.handoffToTravelHostAi());

    expect(onUnavailable).toHaveBeenCalledOnce();
    expect(result.current.canInterruptAiTask).toBe(false);
    expect(result.current.feedback).toBe('任务状态已不可用');
  });

  it('keeps checking a long task until completion and stops after unmount', async () => {
    mocks.topics.data = { items: [], nextCursor: null };
    mocks.startHostedTravelGroupTask.mockResolvedValue({
      accepted: true,
      runHandle: 'E'.repeat(43),
    });
    mocks.getHostedTravelGroupRunStatus.mockResolvedValue({
      completedAt: null,
      errorSummary: null,
      startedAt: '2026-09-04T03:10:00.000Z',
      status: 'running',
      updatedAt: '2026-09-04T03:10:00.000Z',
    });
    const { result, unmount } = renderHook(() => useMemberConversation(group, vi.fn()));
    vi.useFakeTimers();
    act(() => result.current.setDraft('long task'));
    await act(() => result.current.handoffToTravelHostAi());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(mocks.getHostedTravelGroupRunStatus.mock.calls.length).toBeGreaterThan(20);
    expect(result.current.aiTaskStatus).toBe('running');
    unmount();
    const calls = mocks.getHostedTravelGroupRunStatus.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mocks.getHostedTravelGroupRunStatus).toHaveBeenCalledTimes(calls);
    vi.useRealTimers();
  });

  it('clears local member content and reports unavailable after membership removal', async () => {
    const onUnavailable = vi.fn();
    mocks.topics.data = {
      items: [
        { createdAt: new Date('2026-09-04T03:00:00.000Z'), id: 'topic-1', title: '行程讨论' },
      ],
      nextCursor: null,
    };
    mocks.messages.data = { items: [], nextCursor: null };
    mocks.messages.error = { data: { code: 'NOT_FOUND' } };
    mocks.messages.isError = true;

    const { result } = renderHook(() => useMemberConversation(group, onUnavailable));

    await waitFor(() => expect(onUnavailable).toHaveBeenCalledOnce());
    expect(result.current.accessUnavailable).toBe(true);
    expect(result.current.activeTopicId).toBeUndefined();
    expect(result.current.draft).toBe('');
  });
});
