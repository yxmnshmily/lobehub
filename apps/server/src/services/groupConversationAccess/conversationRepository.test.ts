// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import {
  agentOperations,
  chatGroups,
  chatGroupUserMemberships,
  files,
  goalNodes,
  goals,
  messages,
  messagesFiles,
  projects,
  tasks,
  taskTopics,
  topics,
  users,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { ProjectModel } from '@/database/models/project';
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
  it('does not let empty or nonmatching topics hide search hits before pagination', async () => {
    const messageId = 'search-among-empty-topics';
    await db.insert(messages).values({
      id: messageId,
      userId: paginationOwnerId,
      groupId: paginationGroupId,
      topicId: paginationTopicIds[0],
      role: 'user',
      content: '唯一匹配行程',
    });
    try {
      const repository = new GroupConversationAccessRepository(db);
      const result = await repository.listAccessibleTextMessages(
        paginationOwnerId,
        paginationGroupId,
        undefined,
        {
          direction: 'latest',
          keywords: '唯一',
          limit: 1,
        },
      );
      expect(result.items.map((item) => item.content)).toEqual(['唯一匹配行程']);
    } finally {
      await db.delete(messages).where(eq(messages.id, messageId));
    }
  });
  it('preserves a named author without exposing their account identity', async () => {
    await db
      .update(users)
      .set({ fullName: '旅行群主', avatar: 'https://example.test/avatar.png' })
      .where(eq(users.id, ownerId));
    try {
      const repository = new GroupConversationAccessRepository(db);
      const result = await repository.listAccessibleTextMessages(memberId, groupId, undefined);
      const ownerMessage = result.items.find((item) => item.authorKind === 'owner');
      expect(ownerMessage?.sender).toEqual({
        id: expect.stringMatching(/^[a-f\d]{64}$/),
        fullName: '旅行群主',
        avatar: 'https://example.test/avatar.png',
      });
      expect(JSON.stringify(ownerMessage)).not.toContain(ownerId);
    } finally {
      await db.update(users).set({ fullName: null, avatar: null }).where(eq(users.id, ownerId));
    }
  });
  it('searches only matching authorized group text and treats wildcard characters literally', async () => {
    const repository = new GroupConversationAccessRepository(db);
    const result = await repository.listAccessibleTextMessages(memberId, groupId, undefined, {
      keywords: '群主发布',
      direction: 'latest',
    });
    expect(result.items.map((item) => item.content)).toEqual(['群主发布的文字']);
    const noMatch = await repository.listAccessibleTextMessages(memberId, groupId, undefined, {
      keywords: '%',
    });
    expect(noMatch.items).toEqual([]);
    await expect(
      repository.listAccessibleTextMessages(outsiderId, groupId, undefined, { keywords: '文字' }),
    ).rejects.toThrow(GROUP_CONVERSATION_ACCESS_UNAVAILABLE);
  });
  it('bounds the recent owner window without deleting archived topic messages', async () => {
    const timeline = await new MessageModel(db, ownerId).query(
      { groupId, pageSize: 1 },
      { groupTimeline: true },
    );
    const ids = timeline.map((message) => message.id);
    expect(ids).toHaveLength(1);
    expect(ids).not.toContain(otherGroupMessageId);
    expect(ids).not.toContain(memberMessageId);
    const times = timeline.map((message) => Number(message.createdAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    const archived = await new MessageModel(db, ownerId).query({
      groupId,
      topicId: beforeJoinTopicId,
    });
    expect(archived.map((message) => message.id)).toContain(beforeJoinMessageId);
  });

  it('merges member timeline topics while preserving membership visibility', async () => {
    const owner = await repository.listAccessibleTextMessages(ownerId, groupId, undefined);
    expect(owner.items.map((message) => message.topicId)).toContain(beforeJoinTopicId);
    const member = await repository.listAccessibleTextMessages(memberId, groupId, undefined);
    expect(member.items.map((message) => message.content)).toEqual([
      '群主发布的文字',
      '成员发布的文字',
    ]);
  });

  it('refreshes topic activity after a new member message but not an idempotent replay', async () => {
    const repository = new GroupConversationAccessRepository(db);
    const oldActivity = new Date('2026-09-01T00:00:00.000Z');
    await db
      .update(topics)
      .set({ updatedAt: oldActivity })
      .where(eq(topics.id, writerAccessibleTopicId));
    const input = {
      groupId: writerGroupId,
      topicId: writerAccessibleTopicId,
      content: '继续讨论，让话题进入最近活跃列表',
      idempotencyKey: 'refresh-topic-activity',
    };
    await repository.createAccessibleTextMessage(writerMemberId, input);
    const [first] = await db
      .select({ updatedAt: topics.updatedAt })
      .from(topics)
      .where(eq(topics.id, writerAccessibleTopicId));
    expect(first.updatedAt.getTime()).toBeGreaterThan(oldActivity.getTime());
    await repository.createAccessibleTextMessage(writerMemberId, input);
    const [replayed] = await db
      .select({ updatedAt: topics.updatedAt })
      .from(topics)
      .where(eq(topics.id, writerAccessibleTopicId));
    expect(replayed.updatedAt).toEqual(first.updatedAt);
  });
  it('returns business associations and only this topic cost without exposing another group', async () => {
    const project = await new ProjectModel(db, ownerId).create({
      identifier: 'P99001',
      name: '旅行项目',
    });
    const [task] = await db
      .insert(tasks)
      .values({
        id: 'topic-assoc-task',
        identifier: 'T-assoc',
        seq: 900001,
        name: '写文案',
        instruction: '写文案',
        createdByUserId: ownerId,
        config: { groupId },
        context: { origin: { topicId: laterTopicId } },
        projectId: project.id,
      })
      .returning();
    const [goal] = await db
      .insert(goals)
      .values({
        id: 'topic-assoc-goal',
        title: '宣传目标',
        userId: ownerId,
        config: { groupId },
        projectId: project.id,
      })
      .returning();
    await db.insert(goalNodes).values({
      goalId: goal.id,
      kind: 'task',
      taskId: task.id,
      title: '执行',
      createdByUserId: ownerId,
    });
    await db
      .insert(taskTopics)
      .values({ taskId: task.id, topicId: afterJoinTopicId, userId: ownerId, seq: 1 });
    await db.insert(tasks).values({
      id: 'topic-assoc-hidden',
      identifier: 'T-hidden',
      seq: 900002,
      name: '其他群秘密',
      instruction: 'secret',
      createdByUserId: ownerId,
      config: { groupId: otherGroupId },
      context: { origin: { topicId: laterTopicId } },
    });
    await db.update(topics).set({ totalCost: 0.015301 }).where(eq(topics.id, afterJoinTopicId));
    try {
      for (const actor of [ownerId, memberId]) {
        const result = await repository.listAccessibleTopics(actor, groupId);
        const topic = result.items.find((row) => row.id === afterJoinTopicId)!;
        expect(topic.cost).toBe(0.015301);
        expect(topic.businessAssociations).toEqual(
          expect.arrayContaining([
            { id: task.id, kind: 'task', title: '写文案' },
            { id: goal.id, kind: 'goal', title: '宣传目标' },
            { id: project.id, kind: 'project', title: '旅行项目' },
          ]),
        );
        expect(topic.businessAssociations).toHaveLength(3);
        expect(result.items.find((row) => row.id === laterTopicId)?.businessAssociations).toEqual(
          topic.businessAssociations,
        );
      }
    } finally {
      await db.update(topics).set({ totalCost: null }).where(eq(topics.id, afterJoinTopicId));
      await db.delete(goals).where(eq(goals.id, goal.id));
      await db.delete(tasks).where(inArray(tasks.id, [task.id, 'topic-assoc-hidden']));
      await db.delete(projects).where(eq(projects.id, project.id));
    }
  });
  it('paginates newest topics without truncating history to ten', async () => {
    const first = await repository.listAccessibleTopics(ownerId, groupId, {
      direction: 'latest',
      limit: 2,
    });
    expect(first.items.map((item) => item.id)).toEqual([laterTopicId, afterJoinTopicId]);
    expect(first.nextCursor).not.toBeNull();
    const second = await repository.listAccessibleTopics(ownerId, groupId, {
      direction: 'latest',
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.items.map((item) => item.id)).toEqual([beforeJoinTopicId]);
    expect(second.nextCursor).toBeNull();
  });

  it('does not choose a deleted topic when continuing the group conversation', async () => {
    await db.update(topics).set({ deletedAt: new Date() }).where(eq(topics.id, laterTopicId));
    try {
      const result = await repository.listAccessibleTopics(ownerId, groupId, { recent: true });
      expect(result.items.map((item) => item.id)).not.toContain(laterTopicId);
    } finally {
      await db.update(topics).set({ deletedAt: null }).where(eq(topics.id, laterTopicId));
    }
  });

  it('previews the latest visible top-level request and sorts by its activity', async () => {
    const ids = ['recent-preview-request', 'recent-preview-thread', 'recent-preview-foreign'];
    try {
      await db.insert(messages).values([
        {
          id: ids[0],
          groupId,
          topicId: afterJoinTopicId,
          userId: ownerId,
          role: 'user',
          content: '出个短视频文案吧',
          createdAt: new Date('2099-01-01'),
        },
        {
          id: ids[1],
          groupId,
          topicId: afterJoinTopicId,
          userId: ownerId,
          role: 'assistant',
          content: '内部回复',
          createdAt: new Date('2099-01-02'),
        },
        {
          id: ids[2],
          groupId: otherGroupId,
          topicId: afterJoinTopicId,
          userId: otherOwnerId,
          role: 'user',
          content: '其他群内容',
          createdAt: new Date('2099-01-03'),
        },
      ]);
      for (const actor of [ownerId, memberId]) {
        const result = await repository.listAccessibleTopics(actor, groupId, { recent: true });
        expect(result.items[0]).toMatchObject({
          id: afterJoinTopicId,
          title: '入群后话题',
          latestMessage: '出个短视频文案吧',
        });
        const transcript = await repository.listAccessibleTextMessages(
          actor,
          groupId,
          afterJoinTopicId,
          { direction: 'latest' },
        );
        const anchor =
          actor === ownerId
            ? ids[0]
            : transcript.items.find((item) => item.content === '出个短视频文案吧')?.publicMessageId;
        expect(result.items[0].latestMessageId).toBe(anchor);
      }
      const rejoined = await repository.listAccessibleTopics(rejoinedMemberId, groupId, {
        recent: true,
      });
      expect(rejoined.items.map((item) => item.id)).not.toContain(afterJoinTopicId);
    } finally {
      await db.delete(messages).where(inArray(messages.id, ids));
    }
  });

  it('returns only twenty recent topics and no continuation without deleting earlier history', async () => {
    const repository = new GroupConversationAccessRepository(db);
    const baseline = await repository.listAccessibleTopics(ownerId, groupId, { recent: true });
    const recentIds = Array.from({ length: 25 }, (_, index) => `recent-topic-${index}`);
    try {
      await db.insert(topics).values(
        recentIds.map((id, index) => ({
          id,
          groupId,
          userId: ownerId,
          createdAt: new Date('2026-09-05T00:00:00.000Z'),
          updatedAt: new Date(Date.UTC(2099, 8, 6, 0, index)),
        })),
      );
      const recent = await repository.listAccessibleTopics(ownerId, groupId, {
        limit: 50,
        recent: true,
      });
      expect(recent.items).toHaveLength(20);
      expect(recent.totalCount).toBe(baseline.totalCount! + 25);
      expect(recent.items[0].id).toBe('recent-topic-24');
      expect(recent.items.at(-1)?.id).toBe('recent-topic-5');
      expect(recent.nextCursor).toBeNull();
      const persisted = await db
        .select({ id: topics.id })
        .from(topics)
        .where(inArray(topics.id, recentIds));
      expect(persisted).toHaveLength(25);
    } finally {
      await db.delete(topics).where(inArray(topics.id, recentIds));
    }
  });
  const repository = new GroupConversationAccessRepository(db);

  it('searches topic titles within the current membership visibility boundary', async () => {
    const owner = await repository.listAccessibleTopics(ownerId, groupId, { keywords: '入群前' });
    expect(owner.items.map((item) => item.id)).toEqual([beforeJoinTopicId]);
    const member = await repository.listAccessibleTopics(memberId, groupId, { keywords: '入群前' });
    expect(member.items).toEqual([]);
    const recent = await repository.listAccessibleTopics(memberId, groupId, { keywords: '再次' });
    expect(recent.items.map((item) => item.id)).toEqual([laterTopicId]);
  });

  it('finds a topic by a visible request even when its title stayed generic', async () => {
    const result = await repository.listAccessibleTopics(ownerId, groupId, {
      keywords: '群主发布',
    });
    expect(result.items.map((item) => item.id)).toEqual([afterJoinTopicId]);
    const member = await repository.listAccessibleTopics(memberId, groupId, {
      keywords: '群主发布',
    });
    expect(member.items.map((item) => item.id)).toEqual([afterJoinTopicId]);
    for (const keywords of ['其他群消息', '附件说明', '内部私聊', '%']) {
      expect(
        (await repository.listAccessibleTopics(memberId, groupId, { keywords })).items,
      ).toEqual([]);
    }
    expect(
      (await repository.listAccessibleTopics(rejoinedMemberId, groupId, { keywords: '群主发布' }))
        .items,
    ).toEqual([]);
  });

  it('lets the owner read all owner-owned group topics while returning only safe fields', async () => {
    const result = await repository.listAccessibleTopics(ownerId, groupId);

    expect(result.items).toEqual([
      {
        businessAssociations: [],
        cost: null,
        createdAt: beforeJoinedAt,
        id: beforeJoinTopicId,
        title: '入群前话题',
        favorite: false,
        status: null,
        trigger: null,
        updatedAt: expect.any(Date),
      },
      {
        businessAssociations: [],
        cost: null,
        createdAt: afterJoinedAt,
        id: afterJoinTopicId,
        title: '入群后话题',
        favorite: false,
        status: null,
        trigger: null,
        updatedAt: expect.any(Date),
      },
      {
        businessAssociations: [],
        cost: null,
        createdAt: laterAt,
        id: laterTopicId,
        title: '再次入群后话题',
        favorite: false,
        status: null,
        trigger: null,
        updatedAt: expect.any(Date),
      },
    ]);
    expect(result.nextCursor).toBeNull();
  });

  it('returns favorite topics only to their owner', async () => {
    await db.update(topics).set({ favorite: true }).where(eq(topics.id, laterTopicId));
    try {
      const owner = await repository.listAccessibleTopics(ownerId, groupId);
      expect(owner.items.find((topic) => topic.id === laterTopicId)?.favorite).toBe(true);
      const member = await repository.listAccessibleTopics(memberId, groupId);
      expect(member.items.every((topic) => !('favorite' in topic))).toBe(true);
    } finally {
      await db.update(topics).set({ favorite: false }).where(eq(topics.id, laterTopicId));
    }
  });

  it('limits an active member to topics created during the current membership period', async () => {
    await expect(repository.listAccessibleTopics(memberId, groupId)).resolves.toEqual({
      items: [
        {
          businessAssociations: [],
          cost: null,
          createdAt: afterJoinedAt,
          id: afterJoinTopicId,
          title: '入群后话题',
          status: null,
          trigger: null,
          updatedAt: expect.any(Date),
        },
        {
          businessAssociations: [],
          cost: null,
          createdAt: laterAt,
          id: laterTopicId,
          title: '再次入群后话题',
          status: null,
          trigger: null,
          updatedAt: expect.any(Date),
        },
      ],
      nextCursor: null,
    });
    await expect(repository.listAccessibleTopics(rejoinedMemberId, groupId)).resolves.toEqual({
      items: [
        {
          businessAssociations: [],
          cost: null,
          createdAt: laterAt,
          id: laterTopicId,
          title: '再次入群后话题',
          status: null,
          trigger: null,
          updatedAt: expect.any(Date),
        },
      ],
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

  it('preserves a former member transcript for the owner when the author rejoins', async () => {
    const repository = new GroupConversationAccessRepository(db);
    const memberWhere = and(
      eq(chatGroupUserMemberships.chatGroupId, groupId),
      eq(chatGroupUserMemberships.userId, memberId),
    );
    try {
      await db
        .update(chatGroupUserMemberships)
        .set({
          joinedAt: new Date('2026-09-05T04:00:00.000Z'),
          membershipVersion: 4,
        })
        .where(memberWhere);

      const ownerTranscript = await repository.listOwnerSupplementalTextMessages(
        ownerId,
        groupId,
        afterJoinTopicId,
      );
      expect(ownerTranscript).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: memberMessageId, content: '成员发布的文字' }),
        ]),
      );
      await expect(
        repository.listAccessibleTextMessages(memberId, groupId, afterJoinTopicId),
      ).rejects.toMatchObject({ code: GROUP_CONVERSATION_ACCESS_UNAVAILABLE });
      const [persisted] = await db
        .select({ content: messages.content })
        .from(messages)
        .where(eq(messages.id, memberMessageId));
      expect(persisted.content).toBe('成员发布的文字');
    } finally {
      await db
        .update(chatGroupUserMemberships)
        .set({ joinedAt, membershipVersion: 2 })
        .where(memberWhere);
    }
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

  it('loads the newest text page first and paginates backward without gaps', async () => {
    const first = await repository.listAccessibleTextMessages(memberId, groupId, afterJoinTopicId, {
      direction: 'latest',
      limit: 1,
    });

    expect(first.items).toEqual([
      expect.objectContaining({
        authorKind: 'self',
        content: '成员发布的文字',
      }),
    ]);
    expect(first.nextCursor).toEqual({
      createdAt: laterAt,
      id: first.items[0].publicMessageId,
    });

    const second = await repository.listAccessibleTextMessages(
      memberId,
      groupId,
      afterJoinTopicId,
      { cursor: first.nextCursor!, direction: 'latest', limit: 1 },
    );
    expect(second.items).toEqual([
      expect.objectContaining({
        authorKind: 'owner',
        content: '群主发布的文字',
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

describe('member message editing', () => {
  const repository = new GroupConversationAccessRepository(db);
  it('allows the author to edit and retract but rejects another member', async () => {
    const created = await repository.createAccessibleTextMessage(writerMemberId, {
      content: 'editable message',
      groupId: writerGroupId,
      idempotencyKey: 'editable-message-test',
      topicId: writerAccessibleTopicId,
    });
    const target = {
      groupId: writerGroupId,
      publicMessageId: created.publicMessageId,
      visibleAt: created.visibleAt,
    };
    await expect(
      repository.updateAccessibleTextMessage(writerOwnerId, { ...target, content: 'forged' }),
    ).rejects.toThrow();
    await repository.updateAccessibleTextMessage(writerMemberId, {
      ...target,
      content: 'edited message',
    });
    const page = await repository.listAccessibleTextMessages(
      writerMemberId,
      writerGroupId,
      undefined,
    );
    expect(
      page.items.find((item) => item.publicMessageId === created.publicMessageId)?.content,
    ).toBe('edited message');
    await repository.updateAccessibleTextMessage(writerMemberId, { ...target, content: null });
    const retracted = await repository.listAccessibleTextMessages(
      writerMemberId,
      writerGroupId,
      undefined,
    );
    expect(
      retracted.items.find((item) => item.publicMessageId === created.publicMessageId)?.content,
    ).toBe('消息已撤回');
  });
});

describe('member attachments', () => {
  it('rejects another users file and shares the senders selected file', async () => {
    const repository = new GroupConversationAccessRepository(db);
    await expect(
      repository.createAccessibleTextMessage(writerMemberId, {
        content: 'attachment',
        fileIds: [attachmentId],
        groupId: writerGroupId,
        idempotencyKey: 'foreign-file-test',
        topicId: writerAccessibleTopicId,
      }),
    ).rejects.toThrow();
    const fileId = 'conversation-member-shared-file';
    await db.insert(files).values({
      id: fileId,
      userId: writerMemberId,
      name: 'test.txt',
      fileType: 'text/plain',
      size: 4,
      url: 'test.txt',
    });
    const sent = await repository.createAccessibleTextMessage(writerMemberId, {
      content: 'attachment',
      fileIds: [fileId],
      groupId: writerGroupId,
      idempotencyKey: 'own-file-test',
      topicId: writerAccessibleTopicId,
    });
    expect(sent.content).toContain('test.txt');
    const page = await repository.listAccessibleTextMessages(
      writerMemberId,
      writerGroupId,
      undefined,
    );
    expect(
      page.items.find((item) => item.publicMessageId === sent.publicMessageId)?.content,
    ).toContain(fileId);
    expect(
      page.items.find((item) => item.publicMessageId === sent.publicMessageId)?.fileList,
    ).toEqual([
      {
        id: fileId,
        name: 'test.txt',
        fileType: 'text/plain',
        size: 4,
        url: expect.stringContaining(`/f/${fileId}`),
        downloadUrl: expect.stringContaining(`/f/${fileId}?download=1`),
      },
    ]);
    const owner = await repository.listOwnerSupplementalTextMessages(
      writerOwnerId,
      writerGroupId,
      undefined,
    );
    expect(owner.some((item) => item.content.includes(fileId))).toBe(true);
    await repository.updateAccessibleTextMessage(writerMemberId, {
      groupId: writerGroupId,
      publicMessageId: sent.publicMessageId,
      visibleAt: sent.visibleAt,
      content: null,
    });
    const retracted = await repository.listAccessibleTextMessages(
      writerMemberId,
      writerGroupId,
      undefined,
    );
    expect(
      retracted.items.find((item) => item.publicMessageId === sent.publicMessageId)?.fileList,
    ).toBeUndefined();
  });
});

describe('group task scope', () => {
  it('excludes logs older than 30 days for owners and members in every category', async () => {
    const repository = new GroupConversationAccessRepository(db);
    const oldId = 'test-group-task-expired';
    await db.insert(agentOperations).values({
      id: oldId,
      userId: ownerId,
      chatGroupId: groupId,
      status: 'error',
      totalTokens: 10,
      createdAt: new Date(Date.now() - 31 * 86400000),
    });
    try {
      for (const actor of [ownerId, memberId]) {
        for (const category of ['all', 'error', 'failed', 'usage'] as const) {
          expect(
            (await repository.listAccessibleTasks(actor, groupId, 0, category)).items,
          ).toHaveLength(0);
        }
      }
    } finally {
      await db.delete(agentOperations).where(eq(agentOperations.id, oldId));
    }
  });
  it('returns only current-group safe status rows and rejects outsiders', async () => {
    const repository = new GroupConversationAccessRepository(db);
    const ids = ['test-group-task-visible', 'test-group-task-foreign'];
    await db.insert(agentOperations).values([
      {
        id: ids[0],
        userId: ownerId,
        chatGroupId: groupId,
        status: 'error',
        totalCost: 0.25,
        totalTokens: 12000,
        model: 'test-model',
        error: { type: '429', message: 'secret-provider-payload', stack: 'private-stack' },
      },
      { id: ids[1], userId: otherOwnerId, chatGroupId: otherGroupId, status: 'done' },
    ]);
    try {
      const page = await repository.listAccessibleTasks(memberId, groupId);
      expect(page.items).toHaveLength(1);
      expect(page.items[0].status).toBe('error');
      expect(page.items[0].id).not.toBe(ids[0]);
      expect(page.items[0]).toMatchObject({
        totalCost: 0.25,
        totalTokens: 12000,
        model: 'test-model',
        errorCode: 'rate_limit',
      });
      expect(JSON.stringify(page)).not.toMatch(/secret-provider-payload|private-stack/);
      expect(
        (await repository.listAccessibleTasks(memberId, groupId, 0, 'success')).items,
      ).toHaveLength(0);
      expect(
        (await repository.listAccessibleTasks(memberId, groupId, 0, 'error')).items,
      ).toHaveLength(1);
      await expect(repository.listAccessibleTasks(outsiderId, groupId)).rejects.toThrow();
    } finally {
      await db.delete(agentOperations).where(inArray(agentOperations.id, ids));
    }
  });
});
