// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import {
  chatGroups,
  chatGroupUserMemberships,
  files,
  messages,
  messagesFiles,
  topics,
  users,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@/server/services/user/travelServiceGroup';

import {
  GROUP_CONVERSATION_IDEMPOTENCY_CONFLICT,
  GROUP_CONVERSATION_INVALID_INPUT,
  GROUP_CONVERSATION_PAGE_SIZE_MAX,
  GroupConversationAccessRepository,
} from './conversationRepository';
import { GROUP_CONVERSATION_ACCESS_UNAVAILABLE } from './principal';

const db: LobeChatDatabase = await getTestDB();

const ownerId = 'conversation-repository-owner';
const memberId = 'conversation-repository-member';
const rejoinedMemberId = 'conversation-repository-rejoined';
const removedMemberId = 'conversation-repository-removed';
const outsiderId = 'conversation-repository-outsider';
const otherOwnerId = 'conversation-repository-other-owner';
const publicOwnerId = 'conversation-repository-public-owner';
const customOwnerId = 'conversation-repository-custom-owner';
const paginationOwnerId = 'conversation-repository-pagination-owner';
const writerOwnerId = 'conversation-repository-writer-owner';
const writerMemberId = 'conversation-repository-writer-member';
const writerRemovedMemberId = 'conversation-repository-writer-removed';
const userIds = [
  ownerId,
  memberId,
  rejoinedMemberId,
  removedMemberId,
  outsiderId,
  otherOwnerId,
  publicOwnerId,
  customOwnerId,
  paginationOwnerId,
  writerOwnerId,
  writerMemberId,
  writerRemovedMemberId,
];

const groupId = 'conversation-repository-default-group';
const otherGroupId = 'conversation-repository-other-group';
const publicGroupId = 'conversation-repository-public-group';
const customGroupId = 'conversation-repository-custom-group';
const paginationGroupId = 'conversation-repository-pagination-group';
const writerGroupId = 'conversation-repository-writer-group';
const groupIds = [
  groupId,
  otherGroupId,
  publicGroupId,
  customGroupId,
  paginationGroupId,
  writerGroupId,
];

const beforeJoinTopicId = 'conversation-repository-topic-before-join';
const afterJoinTopicId = 'conversation-repository-topic-after-join';
const laterTopicId = 'conversation-repository-topic-later';
const otherGroupTopicId = 'conversation-repository-topic-other-group';
const writerBeforeJoinTopicId = 'conversation-repository-writer-before-join';
const writerAccessibleTopicId = 'conversation-repository-writer-accessible';
const topicIds = [
  beforeJoinTopicId,
  afterJoinTopicId,
  laterTopicId,
  otherGroupTopicId,
  writerBeforeJoinTopicId,
  writerAccessibleTopicId,
];

const ownerMessageId = 'conversation-repository-message-owner';
const memberMessageId = 'conversation-repository-message-member';
const beforeJoinMessageId = 'conversation-repository-message-before-join';
const assistantMessageId = 'conversation-repository-message-assistant';
const attachedMessageId = 'conversation-repository-message-attached';
const otherGroupMessageId = 'conversation-repository-message-other-group';
const messageIds = [
  ownerMessageId,
  memberMessageId,
  beforeJoinMessageId,
  assistantMessageId,
  attachedMessageId,
  otherGroupMessageId,
];
const attachmentId = 'conversation-repository-attachment';

const joinedAt = new Date('2026-09-04T02:00:00.000Z');
const rejoinedAt = new Date('2026-09-04T04:00:00.000Z');
const beforeJoinedAt = new Date('2026-09-04T01:00:00.000Z');
const afterJoinedAt = new Date('2026-09-04T03:00:00.000Z');
const laterAt = new Date('2026-09-04T05:00:00.000Z');
const writerJoinedAt = new Date('2025-09-04T06:00:00.000Z');
const writerBeforeJoinAt = new Date('2025-09-04T05:30:00.000Z');
const writerAccessibleAt = new Date('2025-09-04T06:30:00.000Z');

const paginationTopicIds = Array.from(
  { length: GROUP_CONVERSATION_PAGE_SIZE_MAX + 2 },
  (_, index) => `conversation-repository-page-${String(index).padStart(2, '0')}`,
);

const cleanup = async () => {
  await db.delete(messagesFiles).where(inArray(messagesFiles.messageId, messageIds));
  await db.delete(files).where(inArray(files.id, [attachmentId]));
  await db.delete(messages).where(inArray(messages.id, messageIds));
  await db.delete(topics).where(inArray(topics.id, [...topicIds, ...paginationTopicIds]));
  await db
    .delete(chatGroupUserMemberships)
    .where(inArray(chatGroupUserMemberships.chatGroupId, groupIds));
  await db.delete(chatGroups).where(inArray(chatGroups.id, groupIds));
  await db.delete(users).where(inArray(users.id, userIds));
};

beforeAll(async () => {
  await db.execute(
    sql.raw(`
    CREATE TABLE IF NOT EXISTS chat_group_user_memberships (
      chat_group_id text NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invited_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
      role text NOT NULL DEFAULT 'member',
      can_use_paid_ai boolean NOT NULL DEFAULT false,
      max_credits_per_request bigint,
      max_credits_per_period bigint,
      membership_version integer NOT NULL DEFAULT 1,
      joined_at timestamptz NOT NULL DEFAULT now(),
      removed_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (chat_group_id, user_id),
      CONSTRAINT chat_group_user_memberships_role_check CHECK (role = 'member'),
      CONSTRAINT chat_group_user_memberships_paid_ai_limits_check CHECK (
        (
          can_use_paid_ai = false
          AND max_credits_per_request IS NULL
          AND max_credits_per_period IS NULL
        ) OR (
          can_use_paid_ai = true
          AND max_credits_per_request IS NOT NULL
          AND max_credits_per_period IS NOT NULL
          AND max_credits_per_request > 0
          AND max_credits_per_period > 0
          AND max_credits_per_request <= max_credits_per_period
          AND max_credits_per_period <= 9007199254740991
        )
      ),
      CONSTRAINT chat_group_user_memberships_version_check CHECK (membership_version > 0)
    )
  `),
  );
  await cleanup();

  await db.insert(users).values(userIds.map((id) => ({ email: `${id}@example.test`, id })));
  await db.insert(chatGroups).values([
    {
      clientId: DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
      id: groupId,
      title: '默认私人旅游群',
      userId: ownerId,
      visibility: 'private',
    },
    {
      clientId: DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
      id: otherGroupId,
      title: '其他私人旅游群',
      userId: otherOwnerId,
      visibility: 'private',
    },
    {
      clientId: DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
      id: publicGroupId,
      title: '公开旅游群',
      userId: publicOwnerId,
      visibility: 'public',
    },
    {
      clientId: 'custom-group',
      id: customGroupId,
      title: '自定义群',
      userId: customOwnerId,
      visibility: 'private',
    },
    {
      clientId: DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
      id: paginationGroupId,
      title: '分页旅游群',
      userId: paginationOwnerId,
      visibility: 'private',
    },
    {
      clientId: DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
      id: writerGroupId,
      title: '写入测试旅游群',
      userId: writerOwnerId,
      visibility: 'private',
    },
  ]);
  await db.insert(chatGroupUserMemberships).values([
    {
      chatGroupId: groupId,
      invitedByUserId: ownerId,
      joinedAt,
      membershipVersion: 2,
      userId: memberId,
    },
    {
      chatGroupId: groupId,
      invitedByUserId: ownerId,
      joinedAt: rejoinedAt,
      membershipVersion: 4,
      userId: rejoinedMemberId,
    },
    {
      chatGroupId: groupId,
      invitedByUserId: ownerId,
      joinedAt,
      membershipVersion: 3,
      removedAt: afterJoinedAt,
      userId: removedMemberId,
    },
    {
      chatGroupId: writerGroupId,
      invitedByUserId: writerOwnerId,
      joinedAt: writerJoinedAt,
      membershipVersion: 5,
      userId: writerMemberId,
    },
    {
      chatGroupId: writerGroupId,
      invitedByUserId: writerOwnerId,
      joinedAt: writerJoinedAt,
      membershipVersion: 6,
      removedAt: writerAccessibleAt,
      userId: writerRemovedMemberId,
    },
  ]);
  await db.insert(topics).values([
    {
      createdAt: beforeJoinedAt,
      groupId,
      id: beforeJoinTopicId,
      title: '入群前话题',
      userId: ownerId,
    },
    {
      createdAt: afterJoinedAt,
      groupId,
      id: afterJoinTopicId,
      title: '入群后话题',
      userId: ownerId,
    },
    {
      createdAt: laterAt,
      groupId,
      id: laterTopicId,
      title: '再次入群后话题',
      userId: ownerId,
    },
    {
      createdAt: afterJoinedAt,
      groupId: otherGroupId,
      id: otherGroupTopicId,
      title: '其他群话题',
      userId: otherOwnerId,
    },
    {
      createdAt: writerBeforeJoinAt,
      groupId: writerGroupId,
      id: writerBeforeJoinTopicId,
      title: '写入成员入群前话题',
      userId: writerOwnerId,
    },
    {
      createdAt: writerAccessibleAt,
      groupId: writerGroupId,
      id: writerAccessibleTopicId,
      title: '写入成员可访问话题',
      userId: writerOwnerId,
    },
    ...paginationTopicIds.map((id) => ({
      createdAt: laterAt,
      groupId: paginationGroupId,
      id,
      title: id,
      userId: paginationOwnerId,
    })),
  ]);
  await db.insert(messages).values([
    {
      content: '入群前的消息',
      createdAt: beforeJoinedAt,
      groupId,
      id: beforeJoinMessageId,
      role: 'user',
      topicId: beforeJoinTopicId,
      userId: ownerId,
    },
    {
      content: '群主发布的文字',
      createdAt: afterJoinedAt,
      groupId,
      id: ownerMessageId,
      metadata: { private: 'must not be returned' },
      role: 'user',
      topicId: afterJoinTopicId,
      userId: ownerId,
    },
    {
      content: '成员发布的文字',
      createdAt: laterAt,
      groupId,
      id: memberMessageId,
      role: 'user',
      topicId: afterJoinTopicId,
      userId: memberId,
    },
    {
      content: '不应通过纯文本成员通道返回的 AI 内容',
      createdAt: laterAt,
      groupId,
      id: assistantMessageId,
      model: 'internal-model',
      provider: 'internal-provider',
      role: 'assistant',
      tools: [{ id: 'private-tool' }],
      topicId: afterJoinTopicId,
      userId: ownerId,
    },
    {
      content: '附件说明',
      createdAt: laterAt,
      groupId,
      id: attachedMessageId,
      role: 'user',
      topicId: afterJoinTopicId,
      userId: memberId,
    },
    {
      content: '其他群消息',
      createdAt: laterAt,
      groupId: otherGroupId,
      id: otherGroupMessageId,
      role: 'user',
      topicId: otherGroupTopicId,
      userId: otherOwnerId,
    },
  ]);
  await db.insert(files).values({
    fileType: 'text/plain',
    id: attachmentId,
    name: 'private.txt',
    size: 10,
    url: 'https://example.test/private.txt',
    userId: memberId,
  });
  await db.insert(messagesFiles).values({
    fileId: attachmentId,
    messageId: attachedMessageId,
    userId: memberId,
  });
});

afterAll(cleanup);

describe('GroupConversationAccessRepository conversation reads', () => {
  const repository = new GroupConversationAccessRepository(db);

  it('lets the owner read all owner-owned group topics while returning only safe fields', async () => {
    const result = await repository.listAccessibleTopics(ownerId, groupId);

    expect(result.items).toEqual([
      { createdAt: beforeJoinedAt, id: beforeJoinTopicId, title: '入群前话题' },
      { createdAt: afterJoinedAt, id: afterJoinTopicId, title: '入群后话题' },
      { createdAt: laterAt, id: laterTopicId, title: '再次入群后话题' },
    ]);
    expect(result.nextCursor).toBeNull();
  });

  it('limits an active member to topics created during the current membership period', async () => {
    await expect(repository.listAccessibleTopics(memberId, groupId)).resolves.toEqual({
      items: [
        { createdAt: afterJoinedAt, id: afterJoinTopicId, title: '入群后话题' },
        { createdAt: laterAt, id: laterTopicId, title: '再次入群后话题' },
      ],
      nextCursor: null,
    });
    await expect(repository.listAccessibleTopics(rejoinedMemberId, groupId)).resolves.toEqual({
      items: [{ createdAt: laterAt, id: laterTopicId, title: '再次入群后话题' }],
      nextCursor: null,
    });
  });

  it('returns mixed real human authors and excludes AI, attachments, and internal fields', async () => {
    await expect(
      repository.listAccessibleTextMessages(memberId, groupId, afterJoinTopicId),
    ).resolves.toEqual({
      items: [
        {
          authorKind: 'owner',
          content: '群主发布的文字',
          publicMessageId: expect.stringMatching(/^[a-f\d]{64}$/),
          topicId: afterJoinTopicId,
          visibleAt: afterJoinedAt,
        },
        {
          authorKind: 'self',
          content: '成员发布的文字',
          publicMessageId: expect.stringMatching(/^[a-f\d]{64}$/),
          topicId: afterJoinTopicId,
          visibleAt: laterAt,
        },
      ],
      nextCursor: null,
    });
  });

  it('returns only member-authored plain text to the authorized private travel-group owner', async () => {
    const repository = new GroupConversationAccessRepository(db);

    await expect(
      repository.listOwnerSupplementalTextMessages(ownerId, groupId, afterJoinTopicId),
    ).resolves.toEqual([
      {
        content: '成员发布的文字',
        createdAt: laterAt,
        groupId,
        id: memberMessageId,
        role: 'user',
        sender: {
          avatar: null,
          fullName: null,
          id: memberId,
          username: null,
        },
        topicId: afterJoinTopicId,
        updatedAt: expect.any(Date),
      },
    ]);

    await expect(
      repository.listOwnerSupplementalTextMessages(memberId, groupId, afterJoinTopicId),
    ).resolves.toEqual([]);
    await expect(
      repository.listOwnerSupplementalTextMessages(ownerId, otherGroupId, otherGroupTopicId),
    ).resolves.toEqual([]);
    await expect(
      repository.listOwnerSupplementalTextMessages(publicOwnerId, publicGroupId, afterJoinTopicId),
    ).resolves.toEqual([]);
    await expect(
      repository.listOwnerSupplementalTextMessages(customOwnerId, customGroupId, afterJoinTopicId),
    ).resolves.toEqual([]);
  });

  it('does not expose a topic or its messages from before the member joined', async () => {
    await expect(
      repository.listAccessibleTextMessages(memberId, groupId, beforeJoinTopicId),
    ).rejects.toMatchObject({ code: GROUP_CONVERSATION_ACCESS_UNAVAILABLE });
  });

  it.each([
    ['outsider', outsiderId, groupId],
    ['removed member', removedMemberId, groupId],
    ['cross group', memberId, otherGroupId],
    ['public group', publicOwnerId, publicGroupId],
    ['non-default group', customOwnerId, customGroupId],
  ])(
    'uses one unavailable error for %s topic reads',
    async (_label, actorUserId, targetGroupId) => {
      await expect(
        repository.listAccessibleTopics(actorUserId, targetGroupId),
      ).rejects.toMatchObject({
        code: GROUP_CONVERSATION_ACCESS_UNAVAILABLE,
        message: GROUP_CONVERSATION_ACCESS_UNAVAILABLE,
      });
    },
  );

  it('rejects a topic that does not belong to the requested group without leaking either resource', async () => {
    await expect(
      repository.listAccessibleTextMessages(ownerId, groupId, otherGroupTopicId),
    ).rejects.toMatchObject({ code: GROUP_CONVERSATION_ACCESS_UNAVAILABLE });
  });

  it('paginates text messages with the same stable cursor contract', async () => {
    const first = await repository.listAccessibleTextMessages(memberId, groupId, afterJoinTopicId, {
      limit: 1,
    });

    expect(first.items).toEqual([
      expect.objectContaining({
        authorKind: 'owner',
        content: '群主发布的文字',
        publicMessageId: expect.stringMatching(/^[a-f\d]{64}$/),
      }),
    ]);
    expect(first.nextCursor).toEqual({
      createdAt: afterJoinedAt,
      id: first.items[0].publicMessageId,
    });
    expect(first.nextCursor?.id).not.toBe(ownerMessageId);

    const second = await repository.listAccessibleTextMessages(
      memberId,
      groupId,
      afterJoinTopicId,
      { cursor: first.nextCursor!, limit: 1 },
    );
    expect(second.items).toEqual([
      expect.objectContaining({
        authorKind: 'self',
        content: '成员发布的文字',
        publicMessageId: expect.stringMatching(/^[a-f\d]{64}$/),
      }),
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it('caps pages and uses createdAt plus id as a stable cursor', async () => {
    const first = await repository.listAccessibleTopics(paginationOwnerId, paginationGroupId, {
      limit: 1000,
    });

    expect(first.items).toHaveLength(GROUP_CONVERSATION_PAGE_SIZE_MAX);
    expect(first.nextCursor).toEqual({
      createdAt: laterAt,
      id: paginationTopicIds[GROUP_CONVERSATION_PAGE_SIZE_MAX - 1],
    });

    const second = await repository.listAccessibleTopics(paginationOwnerId, paginationGroupId, {
      cursor: first.nextCursor!,
      limit: 1000,
    });
    expect(second.items.map(({ id }) => id)).toEqual(
      paginationTopicIds.slice(GROUP_CONVERSATION_PAGE_SIZE_MAX),
    );
    expect(second.nextCursor).toBeNull();
  });

  it('creates owner-owned topics for both the owner and an active member', async () => {
    const ownerTopic = await repository.createAccessibleTopic(writerOwnerId, {
      groupId: writerGroupId,
      idempotencyKey: 'shared-topic-key',
      title: '群主新话题',
    });
    const memberTopic = await repository.createAccessibleTopic(writerMemberId, {
      groupId: writerGroupId,
      idempotencyKey: 'shared-topic-key',
      title: '成员新话题',
    });

    const stored = await db
      .select({
        groupId: topics.groupId,
        id: topics.id,
        title: topics.title,
        userId: topics.userId,
      })
      .from(topics)
      .where(inArray(topics.id, [ownerTopic.id, memberTopic.id]));
    expect(stored).toEqual(
      expect.arrayContaining([
        { groupId: writerGroupId, id: ownerTopic.id, title: '群主新话题', userId: writerOwnerId },
        { groupId: writerGroupId, id: memberTopic.id, title: '成员新话题', userId: writerOwnerId },
      ]),
    );
  });

  it('replays the same topic request and rejects the same key with a different title', async () => {
    const input = {
      groupId: writerGroupId,
      idempotencyKey: 'member-topic-replay',
      title: '幂等的成员话题',
    };
    const first = await repository.createAccessibleTopic(writerMemberId, input);

    await expect(repository.createAccessibleTopic(writerMemberId, input)).resolves.toEqual(first);
    await expect(
      repository.createAccessibleTopic(writerMemberId, {
        ...input,
        title: '重用 key 但更换了标题',
      }),
    ).rejects.toMatchObject({ code: GROUP_CONVERSATION_IDEMPOTENCY_CONFLICT });
  });

  it('stores pure text messages with the real actor as author and a fixed user role', async () => {
    const ownerMessage = await repository.createAccessibleTextMessage(writerOwnerId, {
      content: '群主的纯文字',
      groupId: writerGroupId,
      idempotencyKey: 'owner-message-1',
      topicId: writerAccessibleTopicId,
    });
    const memberMessage = await repository.createAccessibleTextMessage(writerMemberId, {
      content: '成员的纯文字',
      groupId: writerGroupId,
      idempotencyKey: 'member-message-1',
      topicId: writerAccessibleTopicId,
    });

    const stored = await db
      .select({
        content: messages.content,
        groupId: messages.groupId,
        id: messages.id,
        model: messages.model,
        provider: messages.provider,
        role: messages.role,
        tools: messages.tools,
        topicId: messages.topicId,
        userId: messages.userId,
      })
      .from(messages)
      .where(
        and(
          eq(messages.groupId, writerGroupId),
          inArray(messages.content, ['群主的纯文字', '成员的纯文字']),
        ),
      );
    expect(stored).toEqual(
      expect.arrayContaining([
        {
          content: '群主的纯文字',
          groupId: writerGroupId,
          id: expect.any(String),
          model: null,
          provider: null,
          role: 'user',
          tools: null,
          topicId: writerAccessibleTopicId,
          userId: writerOwnerId,
        },
        {
          content: '成员的纯文字',
          groupId: writerGroupId,
          id: expect.any(String),
          model: null,
          provider: null,
          role: 'user',
          tools: null,
          topicId: writerAccessibleTopicId,
          userId: writerMemberId,
        },
      ]),
    );
    expect(ownerMessage).toMatchObject({
      authorKind: 'self',
      publicMessageId: expect.stringMatching(/^[a-f\d]{64}$/),
    });
    expect(memberMessage).toMatchObject({
      authorKind: 'self',
      publicMessageId: expect.stringMatching(/^[a-f\d]{64}$/),
    });
  });

  it('returns one result for concurrent replay and rejects reuse with different content', async () => {
    const input = {
      content: '只能写入一次',
      groupId: writerGroupId,
      idempotencyKey: 'member-message-replay',
      topicId: writerAccessibleTopicId,
    };
    const [first, replay] = await Promise.all([
      repository.createAccessibleTextMessage(writerMemberId, input),
      repository.createAccessibleTextMessage(writerMemberId, input),
    ]);

    expect(replay).toEqual(first);
    await expect(
      repository.createAccessibleTextMessage(writerMemberId, {
        ...input,
        content: '重用 key 但更换了内容',
      }),
    ).rejects.toMatchObject({ code: GROUP_CONVERSATION_IDEMPOTENCY_CONFLICT });

    const stored = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.groupId, writerGroupId),
          eq(messages.topicId, writerAccessibleTopicId),
          eq(messages.userId, writerMemberId),
          eq(messages.content, input.content),
        ),
      );
    expect(stored).toHaveLength(1);
    expect(first.publicMessageId).toMatch(/^[a-f\d]{64}$/);
    expect(first.publicMessageId).not.toBe(stored[0]?.id);
  });

  it('rejects members removed from the group or topics created before the current joinedAt', async () => {
    await expect(
      repository.createAccessibleTextMessage(writerMemberId, {
        content: '不能写入旧话题',
        groupId: writerGroupId,
        idempotencyKey: 'member-old-topic',
        topicId: writerBeforeJoinTopicId,
      }),
    ).rejects.toMatchObject({ code: GROUP_CONVERSATION_ACCESS_UNAVAILABLE });
    await expect(
      repository.createAccessibleTopic(writerRemovedMemberId, {
        groupId: writerGroupId,
        idempotencyKey: 'removed-member-topic',
        title: '已移除成员的话题',
      }),
    ).rejects.toMatchObject({ code: GROUP_CONVERSATION_ACCESS_UNAVAILABLE });
  });

  it.each([
    ['outsider', outsiderId, writerGroupId],
    ['member of another group', writerMemberId, otherGroupId],
    ['public group owner', publicOwnerId, publicGroupId],
    ['non-default group owner', customOwnerId, customGroupId],
  ])('does not create topics for %s', async (_label, actorUserId, targetGroupId) => {
    await expect(
      repository.createAccessibleTopic(actorUserId, {
        groupId: targetGroupId,
        idempotencyKey: `forbidden-${_label}`,
        title: '不应创建的话题',
      }),
    ).rejects.toMatchObject({ code: GROUP_CONVERSATION_ACCESS_UNAVAILABLE });
  });

  it.each([
    ['blank content', { content: '   ' }],
    ['oversized content', { content: 'x'.repeat(8001) }],
    ['AI role', { role: 'assistant' }],
    ['attachment', { attachment: { id: 'private-file' } }],
    ['files', { files: ['private-file'] }],
    ['tools', { tools: [{ name: 'private-tool' }] }],
    ['model', { model: 'private-model' }],
    ['invalid idempotency key', { idempotencyKey: 'contains\nnewline' }],
  ])('rejects %s from the dedicated text write input', async (_label, override) => {
    const input = {
      content: '安全的纯文字',
      groupId: writerGroupId,
      idempotencyKey: `invalid-${_label}`,
      topicId: writerAccessibleTopicId,
      ...override,
    } as Parameters<typeof repository.createAccessibleTextMessage>[1];

    await expect(
      repository.createAccessibleTextMessage(writerMemberId, input),
    ).rejects.toMatchObject({ code: GROUP_CONVERSATION_INVALID_INPUT });
  });
});
