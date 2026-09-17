// @vitest-environment node
import { readFile } from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GroupConversationAccessUnavailableError } from '@/server/services/groupConversationAccess/principal';

import { groupConversationRouter } from './groupConversation';

const repositoryMocks = vi.hoisted(() => ({
  createAccessibleTextMessage: vi.fn(),
  createAccessibleTopic: vi.fn(),
  listAccessibleGroupSummaries: vi.fn(),
  listAccessiblePublishedAssistantMessages: vi.fn(),
  listAccessibleTextMessages: vi.fn(),
  listAccessibleTopics: vi.fn(),
  listAccessibleTasks: vi.fn(),
}));

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: vi.fn((opts: { ctx: unknown; next: (input: { ctx: unknown }) => unknown }) =>
    opts.next({ ctx: opts.ctx }),
  ),
}));

vi.mock('@/server/services/groupConversationAccess/repository', () => {
  return {
    GroupConversationAccessRepository: vi.fn(function () {
      return {
        listAccessibleGroupSummaries: repositoryMocks.listAccessibleGroupSummaries,
      };
    }),
  };
});

vi.mock('@/server/services/groupConversationAccess/conversationRepository', () => {
  class InvalidInputError extends Error {}
  class IdempotencyConflictError extends Error {}

  return {
    GROUP_CONVERSATION_IDEMPOTENCY_CONFLICT: 'GROUP_CONVERSATION_IDEMPOTENCY_CONFLICT',
    GROUP_CONVERSATION_INVALID_INPUT: 'GROUP_CONVERSATION_INVALID_INPUT',
    GroupConversationAccessRepository: vi.fn(function () {
      return {
        createAccessibleTextMessage: repositoryMocks.createAccessibleTextMessage,
        createAccessibleTopic: repositoryMocks.createAccessibleTopic,
        listAccessiblePublishedAssistantMessages:
          repositoryMocks.listAccessiblePublishedAssistantMessages,
        listAccessibleTextMessages: repositoryMocks.listAccessibleTextMessages,
        listAccessibleTopics: repositoryMocks.listAccessibleTopics,
        listAccessibleTasks: repositoryMocks.listAccessibleTasks,
      };
    }),
    GroupConversationIdempotencyConflictError: IdempotencyConflictError,
    GroupConversationInvalidInputError: InvalidInputError,
  };
});

const ownerId = 'group-conversation-router-owner';
const memberId = 'group-conversation-router-member';
const groupId = 'group-conversation-router-group';
const otherGroupId = 'group-conversation-router-other-group';
const topicId = 'group-conversation-router-topic';
const createdAt = new Date('2026-09-04T08:00:00.000Z');
const publicAssistantId = 'a'.repeat(64);
const publicMessageId = 'b'.repeat(64);

const callerFor = (userId: string, workspaceId?: string | null) =>
  groupConversationRouter.createCaller({
    serverDB: { marker: 'test-database' },
    userId,
    workspaceId,
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
});

it('validates log filters and delegates the authorized actor and pagination', async () => {
  repositoryMocks.listAccessibleTasks.mockResolvedValue({ items: [], nextOffset: null });
  await callerFor(memberId).listTasks({ groupId, offset: 50, category: 'error' });
  expect(repositoryMocks.listAccessibleTasks).toHaveBeenCalledWith(memberId, groupId, 50, 'error');
  await expect(
    callerFor(memberId).listTasks({ groupId, category: 'invalid' as never }),
  ).rejects.toThrow();
});

it.each([undefined, false, true])(
  'reads the authorized group timeline with includeInProgress=%s',
  async (includeInProgress) => {
    repositoryMocks.listAccessibleTextMessages.mockResolvedValue({ items: [], nextCursor: null });
    repositoryMocks.listAccessiblePublishedAssistantMessages.mockResolvedValue([]);
    await callerFor(memberId).listTextMessages({ groupId });
    await callerFor(memberId).listPublishedAssistantMessages({ groupId, includeInProgress });
    expect(repositoryMocks.listAccessibleTextMessages).toHaveBeenCalledWith(
      memberId,
      groupId,
      undefined,
      expect.anything(),
    );
    expect(repositoryMocks.listAccessiblePublishedAssistantMessages).toHaveBeenCalledWith(
      memberId,
      groupId,
      undefined,
      undefined,
      includeInProgress,
      undefined,
    );
  },
);

describe('groupConversationRouter', () => {
  it('preserves published AI attachment cards through the same safe projection', async () => {
    repositoryMocks.listAccessiblePublishedAssistantMessages.mockResolvedValueOnce([
      {
        id: publicAssistantId,
        kind: 'assistant',
        content: '生成结果',
        topicId,
        visibleAt: createdAt,
        fileList: [
          {
            id: 'file-a',
            name: '结果.pdf',
            fileType: 'application/pdf',
            size: 8,
            url: '/f/file-a',
            userId: ownerId,
          },
        ],
      },
    ]);
    const result = await callerFor(memberId).listPublishedAssistantMessages({ groupId });
    expect(result[0].fileList).toEqual([
      { id: 'file-a', name: '结果.pdf', fileType: 'application/pdf', size: 8, url: '/f/file-a' },
    ]);
    expect(JSON.stringify(result)).not.toContain(ownerId);
  });
  it('returns the shared sender display fields without copying private profile data', async () => {
    repositoryMocks.listAccessibleTextMessages.mockResolvedValueOnce({
      items: [
        {
          authorKind: 'owner',
          content: '你好',
          publicMessageId,
          topicId,
          visibleAt: createdAt,
          sender: {
            id: 'c'.repeat(64),
            fullName: '群主',
            avatar: 'avatar.png',
            email: 'private@example.test',
          },
        },
      ],
      nextCursor: null,
    });
    const result = await callerFor(memberId).listTextMessages({ groupId });
    expect(result.items[0].sender).toEqual({
      id: 'c'.repeat(64),
      fullName: '群主',
      avatar: 'avatar.png',
    });
  });
  it('preserves common message attachment shapes without exposing file ownership or storage keys', async () => {
    repositoryMocks.listAccessibleTextMessages.mockResolvedValueOnce({
      items: [
        {
          authorKind: 'self',
          content: '附件',
          publicMessageId,
          topicId,
          visibleAt: createdAt,
          fileList: [
            {
              id: 'file-a',
              name: '行程.pdf',
              size: 4,
              fileType: 'application/pdf',
              url: '/f/file-a',
              downloadUrl: '/f/file-a?download=1',
              userId: ownerId,
              storageKey: 'private-key',
            },
          ],
          imageList: [{ id: 'image-a', alt: '照片', url: '/f/image-a', userId: ownerId }],
        },
      ],
      nextCursor: null,
    });
    const result = await callerFor(memberId).listTextMessages({ groupId });
    expect(result.items[0].fileList).toEqual([
      {
        id: 'file-a',
        name: '行程.pdf',
        size: 4,
        fileType: 'application/pdf',
        url: '/f/file-a',
        downloadUrl: '/f/file-a?download=1',
      },
    ]);
    expect(result.items[0].imageList).toEqual([{ id: 'image-a', alt: '照片', url: '/f/image-a' }]);
    expect(JSON.stringify(result)).not.toContain('private-key');
  });
  it('is registered once on the lambda root without replacing existing routers', async () => {
    const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');

    expect(
      source.match(/import \{ groupConversationRouter \} from '\.\/groupConversation';/gu),
    ).toHaveLength(1);
    expect(source.match(/groupConversation: groupConversationRouter,/gu)).toHaveLength(1);
  });

  it('derives the owner identity from auth context and returns only safe group fields', async () => {
    repositoryMocks.listAccessibleGroupSummaries.mockResolvedValueOnce([
      {
        avatar: '🏔️',
        config: { provider: 'secret-provider' },
        groupId,
        joinedAt: null,
        kind: 'owner',
        membershipVersion: 0,
        resourceOwnerUserId: ownerId,
        ownerDisplayName: '旅游策划师',
        title: '默认私人旅游群',
        usage: { credits: 99 },
      },
    ]);

    const groups = await callerFor(ownerId).listGroups();
    expect(groups).toEqual([
      {
        avatar: '🏔️',
        groupId,
        joinedAt: null,
        kind: 'owner',
        membershipVersion: 0,
        title: '默认私人旅游群',
        ownerDisplayName: '旅游策划师',
        isDefaultGroup: true,
      },
    ]);
    expect(JSON.stringify(groups)).not.toContain(ownerId);
    expect(repositoryMocks.listAccessibleGroupSummaries).toHaveBeenCalledWith(ownerId);
  });

  it('accepts the infinite-query transport direction separately from topic sort order', async () => {
    repositoryMocks.listAccessibleTopics.mockResolvedValueOnce({ items: [], nextCursor: null });
    await expect(
      callerFor(memberId).listTopics({
        groupId,
        limit: 50,
        order: 'latest',
        direction: 'forward',
      } as any),
    ).resolves.toEqual({ items: [], nextCursor: null });
    expect(repositoryMocks.listAccessibleTopics).toHaveBeenCalledWith(
      memberId,
      groupId,
      expect.objectContaining({ direction: 'latest' }),
    );
  });

  it('lets an active member read joined-history topics and pure-text messages', async () => {
    repositoryMocks.listAccessibleTopics.mockResolvedValueOnce({
      items: [{ createdAt, id: topicId, model: 'must-not-leak', title: '行程讨论' }],
      nextCursor: { createdAt, id: topicId },
    });
    repositoryMocks.listAccessibleTextMessages.mockResolvedValueOnce({
      items: [
        {
          authorKind: 'owner',
          content: '欢迎入群',
          provider: 'must-not-leak',
          publicMessageId,
          topicId,
          visibleAt: createdAt,
        },
      ],
      nextCursor: null,
    });

    await expect(callerFor(memberId).listTopics({ groupId, limit: 20 })).resolves.toEqual({
      items: [{ createdAt, id: topicId, title: '行程讨论' }],
      nextCursor: { createdAt, id: topicId },
    });
    await expect(
      callerFor(memberId).listTextMessages({ groupId, limit: 20, topicId }),
    ).resolves.toEqual({
      items: [
        {
          authorKind: 'owner',
          content: '欢迎入群',
          publicMessageId,
          topicId,
          visibleAt: createdAt,
        },
      ],
      nextCursor: null,
    });
    expect(repositoryMocks.listAccessibleTopics).toHaveBeenCalledWith(memberId, groupId, {
      cursor: undefined,
      limit: 20,
    });
    expect(repositoryMocks.listAccessibleTextMessages).toHaveBeenCalledWith(
      memberId,
      groupId,
      topicId,
      { cursor: undefined, direction: 'oldest', limit: 20 },
    );
  });

  it('preserves authorized topic associations and cost through the response allowlist', async () => {
    repositoryMocks.listAccessibleTopics.mockResolvedValueOnce({
      items: [
        {
          id: topicId,
          title: '行程',
          createdAt,
          cost: 0.015301,
          businessAssociations: [{ id: 't1', kind: 'task', title: '写文案', secret: 'hidden' }],
          model: 'private',
        },
      ],
      nextCursor: null,
    });
    const result = await callerFor(memberId).listTopics({ groupId });
    expect(result.items[0]).toEqual({
      id: topicId,
      title: '行程',
      createdAt,
      cost: 0.015301,
      businessAssociations: [{ id: 't1', kind: 'task', title: '写文案' }],
    });
  });

  it('passes only the topic page status and dates, without private model metadata', async () => {
    repositoryMocks.listAccessibleTopics.mockResolvedValueOnce({
      items: [
        {
          id: topicId,
          title: '行程',
          createdAt,
          updatedAt: createdAt,
          status: 'completed',
          trigger: 'chat',
          model: 'private',
        },
      ],
      nextCursor: null,
    });
    await expect(callerFor(memberId).listTopics({ groupId })).resolves.toEqual({
      items: [
        {
          id: topicId,
          title: '行程',
          createdAt,
          updatedAt: createdAt,
          status: 'completed',
          trigger: 'chat',
        },
      ],
      nextCursor: null,
    });
  });

  it('returns only the published assistant text projection for the authenticated member', async () => {
    repositoryMocks.listAccessiblePublishedAssistantMessages.mockResolvedValueOnce([
      {
        agentId: 'authorized-group-assistant',
        actorUserId: 'must-not-leak',
        content: '西藏旅游文案',
        id: publicAssistantId,
        kind: 'assistant',
        model: 'must-not-leak',
        operationId: 'must-not-leak',
        ownerUserId: 'must-not-leak',
        provider: 'must-not-leak',
        reasoning: 'must-not-leak',
        topicId,
        visibleAt: createdAt,
      },
    ]);

    await expect(
      callerFor(memberId).listPublishedAssistantMessages({ groupId, topicId }),
    ).resolves.toEqual([
      {
        agentId: 'authorized-group-assistant',
        content: '西藏旅游文案',
        id: publicAssistantId,
        kind: 'assistant',
        topicId,
        visibleAt: createdAt,
      },
    ]);
    expect(repositoryMocks.listAccessiblePublishedAssistantMessages).toHaveBeenCalledWith(
      memberId,
      groupId,
      topicId,
      undefined,
      undefined,
      undefined,
    );

    await expect(
      callerFor(memberId).listPublishedAssistantMessages({
        groupId,
        operationId: 'forged-operation',
        ownerUserId: ownerId,
        topicId,
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('attributes member-created topics to the authenticated member without accepting owner fields', async () => {
    repositoryMocks.createAccessibleTopic.mockResolvedValueOnce({
      createdAt,
      id: topicId,
      title: '成员新话题',
    });

    await expect(
      callerFor(memberId).createTopic({
        groupId,
        idempotencyKey: 'member-topic-request-1',
        title: '成员新话题',
      }),
    ).resolves.toEqual({ createdAt, id: topicId, title: '成员新话题' });
    expect(repositoryMocks.createAccessibleTopic).toHaveBeenCalledWith(memberId, {
      groupId,
      idempotencyKey: 'member-topic-request-1',
      title: '成员新话题',
    });

    await expect(
      callerFor(memberId).createTopic({
        actorUserId: ownerId,
        groupId,
        idempotencyKey: 'forged-topic-request',
        resourceOwnerUserId: ownerId,
        title: '伪造话题',
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('stores a member text message under the authenticated author and never exposes AI controls', async () => {
    repositoryMocks.createAccessibleTextMessage.mockResolvedValueOnce({
      authorKind: 'self',
      content: '成员纯文本留言',
      internalToken: 'must-not-leak',
      publicMessageId,
      topicId,
      visibleAt: createdAt,
    });

    await expect(
      callerFor(memberId).createTextMessage({
        content: '成员纯文本留言',
        groupId,
        idempotencyKey: 'member-message-request-1',
        topicId,
      }),
    ).resolves.toEqual({
      authorKind: 'self',
      content: '成员纯文本留言',
      publicMessageId,
      topicId,
      visibleAt: createdAt,
    });
    expect(repositoryMocks.createAccessibleTextMessage).toHaveBeenCalledWith(memberId, {
      content: '成员纯文本留言',
      groupId,
      idempotencyKey: 'member-message-request-1',
      topicId,
    });

    const source = await readFile(new URL('./groupConversation.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(
      /aiAgent|sharedBudget|platformUsageBilling|billing|provider|model/iu,
    );
  });

  it('strictly rejects caller-supplied identities, workspace, AI, billing, and attachment fields', async () => {
    const forgedFields = [
      { actorUserId: ownerId },
      { resourceOwnerUserId: ownerId },
      { payerUserId: ownerId },
      { workspaceId: 'workspace-1' },
      { agentId: 'agent-1' },
      { model: 'model-1' },
      { provider: 'provider-1' },
      { billing: { maxCredits: 1 } },
      { files: ['file-1'] },
    ];

    for (const forged of forgedFields) {
      await expect(
        callerFor(memberId).createTextMessage({
          content: '不应通过',
          groupId,
          idempotencyKey: 'strict-input-request',
          topicId,
          ...forged,
        } as never),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    expect(repositoryMocks.createAccessibleTextMessage).not.toHaveBeenCalled();
  });

  it('enforces bounded cursors, page sizes, content, titles, and printable idempotency keys', async () => {
    const caller = callerFor(ownerId);

    await expect(caller.listTopics({ groupId, limit: 51 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      caller.listTextMessages({
        cursor: { createdAt: new Date('invalid'), id: 'cursor' },
        groupId,
        topicId,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.createTopic({ groupId, idempotencyKey: 'bad\nkey', title: '新话题' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.createTextMessage({
        content: ' '.repeat(10),
        groupId,
        idempotencyKey: 'blank-content',
        topicId,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('maps outsider, cross-group, and removed-member failures to one unavailable response', async () => {
    for (const actorUserId of [ownerId, memberId]) {
      repositoryMocks.listAccessibleTopics.mockRejectedValueOnce(
        new GroupConversationAccessUnavailableError(),
      );
      await expect(
        callerFor(actorUserId).listTopics({ groupId: otherGroupId }),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'GROUP_CONVERSATION_ACCESS_UNAVAILABLE',
      });
    }
  });

  it('fails closed for workspace-scoped and unauthenticated callers', async () => {
    await expect(callerFor(ownerId, 'workspace-1').listGroups()).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'GROUP_CONVERSATION_ACCESS_UNAVAILABLE',
    });
    await expect(callerFor('').listGroups()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(repositoryMocks.listAccessibleGroupSummaries).not.toHaveBeenCalled();
  });
});

it('keeps newest-first order separate from tRPC infinite-query direction', async () => {
  repositoryMocks.listAccessibleTextMessages.mockResolvedValue({ items: [], nextCursor: null });
  await callerFor(memberId).listTextMessages({ groupId, order: 'latest', direction: 'forward' });
  expect(repositoryMocks.listAccessibleTextMessages).toHaveBeenCalledWith(
    memberId,
    groupId,
    undefined,
    expect.objectContaining({ direction: 'latest' }),
  );
});
