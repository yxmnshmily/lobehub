/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMemberConversation } from './useMemberConversation';

const mocks = vi.hoisted(() => ({
  createMessage: vi.fn(),
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
          nextCursor: null;
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

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    aiAgent: {
      getHostedTravelGroupRunStatus: {
        query: mocks.getHostedTravelGroupRunStatus,
      },
    },
  },
  lambdaQuery: {
    aiAgent: {
      interruptHostedTravelGroupRun: {
        useMutation: () => ({ mutateAsync: mocks.interruptHostedTravelGroupRun }),
      },
      startHostedTravelGroupTask: {
        useMutation: () => ({ mutateAsync: mocks.startHostedTravelGroupTask }),
      },
    },
    groupConversation: {
      createTextMessage: { useMutation: () => ({ mutateAsync: mocks.createMessage }) },
      createTopic: { useMutation: () => ({ mutateAsync: mocks.createTopic }) },
      listTextMessages: {
        useQuery: (input: unknown) => {
          mocks.messageInput = input;
          return mocks.messages;
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
  beforeEach(() => {
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
    expect(result.current.messagesQuery.data?.items).toEqual([
      expect.objectContaining({ content: '欢迎入群', topicId: 'topic-1' }),
    ]);
    expect(mocks.topicInput).toEqual({ groupId: 'group-1', limit: 50 });
    expect(mocks.messageInput).toEqual({ groupId: 'group-1', limit: 50, topicId: 'topic-1' });
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
    expect(mocks.messages.refetch).toHaveBeenCalledOnce();
    expect(result.current.draft).toBe('');
  });

  it('hands a trimmed request to the server-authorized travel host AI without privileged fields', async () => {
    mocks.topics.data = {
      items: [
        { createdAt: new Date('2026-09-04T03:00:00.000Z'), id: 'topic-1', title: '行程讨论' },
      ],
      nextCursor: null,
    };
    mocks.messages.data = { items: [], nextCursor: null };
    mocks.startHostedTravelGroupTask.mockResolvedValue({ accepted: true, runHandle: 'A'.repeat(43) });
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
      billing: { idempotencyKey: 'request-1', maxCredits: 1000 },
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
    expect(result.current.aiMaxCredits).toBe(1000);
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

    let firstRequest!: Promise<void>;
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
    expect(result.current.aiTaskStatus).toBe('failed');
    expect(result.current.feedback).toBe('旅游群主AI未受理，请重试');
    expect(result.current.draft).toBe('帮我做一张西藏封面图');
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
    let request!: Promise<void>;
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

  it('polls the opaque run handle through real safe statuses until completion', async () => {
    mocks.topics.data = {
      items: [
        { createdAt: new Date('2026-09-04T03:00:00.000Z'), id: 'topic-1', title: '行程讨论' },
      ],
      nextCursor: null,
    };
    mocks.messages.data = { items: [], nextCursor: null };
    mocks.startHostedTravelGroupTask.mockResolvedValue({ accepted: true, runHandle: 'B'.repeat(43) });
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
    mocks.startHostedTravelGroupTask.mockResolvedValue({ accepted: true, runHandle: 'C'.repeat(43) });
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
    mocks.startHostedTravelGroupTask.mockResolvedValue({ accepted: true, runHandle: 'D'.repeat(43) });
    mocks.getHostedTravelGroupRunStatus.mockRejectedValue({ data: { code: 'NOT_FOUND' } });
    const { result } = renderHook(() => useMemberConversation(group, onUnavailable));

    act(() => result.current.setDraft('生成旅游文案'));
    await act(() => result.current.handoffToTravelHostAi());

    expect(onUnavailable).toHaveBeenCalledOnce();
    expect(result.current.canInterruptAiTask).toBe(false);
    expect(result.current.feedback).toBe('任务状态已不可用');
  });

  it('bounds status polling when a hosted task remains running', async () => {
    mocks.topics.data = { items: [], nextCursor: null };
    mocks.startHostedTravelGroupTask.mockResolvedValue({ accepted: true, runHandle: 'E'.repeat(43) });
    mocks.getHostedTravelGroupRunStatus.mockResolvedValue({
      completedAt: null,
      errorSummary: null,
      startedAt: '2026-09-04T03:10:00.000Z',
      status: 'running',
      updatedAt: '2026-09-04T03:10:00.000Z',
    });
    const { result } = renderHook(() => useMemberConversation(group, vi.fn()));
    vi.useFakeTimers();

    act(() => result.current.setDraft('生成旅游文案'));
    await act(() => result.current.handoffToTravelHostAi());
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    const boundedCallCount = mocks.getHostedTravelGroupRunStatus.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(boundedCallCount).toBeGreaterThan(1);
    expect(boundedCallCount).toBeLessThanOrEqual(25);
    expect(mocks.getHostedTravelGroupRunStatus).toHaveBeenCalledTimes(boundedCallCount);
    expect(result.current.aiTaskStatus).toBe('running');
    expect(result.current.feedback).toBe('任务仍在运行，自动状态更新已暂停');
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
