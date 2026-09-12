// @vitest-environment node
import { createHash } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import {
  agentOperations,
  chatGroups,
  chatGroupUserMemberships,
  files,
  messageGroups,
  messages,
  messagesFiles,
  threads,
  topics,
  users,
  works,
  workVersions,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { getFileProxyUrl } from '@/server/services/file';
import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@/server/services/user/travelServiceGroup';

import { GroupConversationAccessRepository } from './conversationRepository';
import { readExecutionMessages } from './executionMessages';
import { GROUP_CONVERSATION_ACCESS_UNAVAILABLE } from './principal';

const db: LobeChatDatabase = await getTestDB();
const repository = new GroupConversationAccessRepository(db);

const ownerId = 'published-assistant-owner';
const memberId = 'published-assistant-member';
const beforePublishMemberId = 'published-assistant-before-publish-member';
const afterPublishMemberId = 'published-assistant-after-publish-member';
const removedMemberId = 'published-assistant-removed-member';
const outsiderId = 'published-assistant-outsider';
const groupId = 'published-assistant-default-group';
const topicId = 'published-assistant-topic';
const otherTopicId = 'published-assistant-other-topic';
const operationId = 'published-assistant-operation';
const assistantMessageId = 'published-assistant-message';
const forgedMessageId = 'published-assistant-forged-message';
const attachmentId = 'published-assistant-attachment';
const joinedAt = new Date('2026-09-04T02:00:00.000Z');
const messageCreatedAt = new Date('2026-09-04T03:00:00.000Z');
const beforePublishedAt = new Date('2026-09-04T03:02:00.000Z');
const publishedAt = new Date('2026-09-04T03:05:00.000Z');
const afterPublishedAt = new Date('2026-09-04T03:06:00.000Z');
const content = '这是群主 AI 生成的西藏旅游文案。';
const contentHash = createHash('sha256').update(content, 'utf8').digest('hex');

const hostedGroupRun = {
  actorUserIdSnapshot: memberId,
  expiresAt: '2099-09-04T00:00:00.000Z',
  groupId,
  handleHash: 'a'.repeat(64),
  membershipVersion: 2,
  ownerUserIdSnapshot: ownerId,
  version: 1,
};

const hostedGroupMemberFinal = {
  actorUserIdSnapshot: memberId,
  assistantMessageId,
  contentHash,
  groupId,
  membershipVersion: 2,
  operationId,
  ownerUserIdSnapshot: ownerId,
  publishedAt: publishedAt.toISOString(),
  version: 1,
};

const operationMetadata = () => ({
  billingActorUserId: memberId,
  groupId,
  hostedGroupMemberFinal,
  hostedGroupRun,
  orchestrationRole: 'supervisor',
  resourceOwnerUserId: ownerId,
});

const cleanup = async () => {
  await db.delete(messagesFiles).where(eq(messagesFiles.messageId, assistantMessageId));
  await db.delete(agentOperations).where(eq(agentOperations.id, operationId));
  await db.delete(messages).where(inArray(messages.id, [assistantMessageId, forgedMessageId]));
  await db.delete(files).where(eq(files.id, attachmentId));
  await db.delete(topics).where(inArray(topics.id, [topicId, otherTopicId]));
  await db
    .delete(chatGroupUserMemberships)
    .where(eq(chatGroupUserMemberships.chatGroupId, groupId));
  await db.delete(chatGroups).where(eq(chatGroups.id, groupId));
  await db
    .delete(users)
    .where(
      inArray(users.id, [
        ownerId,
        memberId,
        beforePublishMemberId,
        afterPublishMemberId,
        removedMemberId,
        outsiderId,
      ]),
    );
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
  await db.insert(users).values(
    [
      ownerId,
      memberId,
      beforePublishMemberId,
      afterPublishMemberId,
      removedMemberId,
      outsiderId,
    ].map((id) => ({
      email: `${id}@example.test`,
      id,
    })),
  );
  await db.insert(chatGroups).values({
    clientId: DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
    id: groupId,
    title: '默认私有旅游群',
    userId: ownerId,
    visibility: 'private',
  });
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
      joinedAt: beforePublishedAt,
      membershipVersion: 7,
      userId: beforePublishMemberId,
    },
    {
      chatGroupId: groupId,
      invitedByUserId: ownerId,
      joinedAt: afterPublishedAt,
      membershipVersion: 4,
      userId: afterPublishMemberId,
    },
    {
      chatGroupId: groupId,
      invitedByUserId: ownerId,
      joinedAt,
      membershipVersion: 2,
      removedAt: publishedAt,
      userId: removedMemberId,
    },
  ]);
  await db.insert(topics).values([
    {
      createdAt: messageCreatedAt,
      groupId,
      id: topicId,
      title: '成员 AI 生成',
      userId: ownerId,
    },
    {
      createdAt: messageCreatedAt,
      groupId,
      id: otherTopicId,
      title: '同群其他话题',
      userId: ownerId,
    },
  ]);
  await db.insert(messages).values([
    {
      content,
      createdAt: messageCreatedAt,
      groupId,
      id: assistantMessageId,
      model: 'internal-model',
      provider: 'internal-provider',
      reasoning: { private: 'must-not-return' },
      role: 'assistant',
      topicId,
      userId: ownerId,
    },
    {
      content: '浏览器伪造的 assistant 消息',
      createdAt: messageCreatedAt,
      groupId,
      id: forgedMessageId,
      metadata: { hostedGroupMemberFinal },
      role: 'assistant',
      topicId,
      userId: memberId,
    },
  ]);
  await db.insert(agentOperations).values({
    chatGroupId: groupId,
    completedAt: publishedAt,
    completionReason: 'done',
    id: operationId,
    metadata: operationMetadata(),
    status: 'done',
    topicId,
    userId: ownerId,
  });
});

afterAll(cleanup);

describe('published assistant member projection', () => {
  it('preserves database microsecond time boundaries across batched executions', async () => {
    await db.execute(sql`UPDATE ${messages}
      SET created_at = ${messageCreatedAt.toISOString()}::timestamptz + interval '500 microseconds'
      WHERE id = ${assistantMessageId}`);
    const input = {
      ownerId,
      groupId,
      topicId,
      joinedAt,
      operationId,
      until: publishedAt,
      ids: [assistantMessageId],
      publicId: (id: string) => id,
    };
    try {
      const result = await readExecutionMessages(db, [
        input,
        { ...input, until: messageCreatedAt },
      ]);
      expect(result[0]?.[0].content).toBe(content);
      expect(result[1]).toBeUndefined();
    } finally {
      await db
        .update(messages)
        .set({ createdAt: messageCreatedAt })
        .where(eq(messages.id, assistantMessageId));
    }
  });

  it('keeps large execution batches below the database parameter limit', async () => {
    const logger = (
      db as unknown as {
        session: { logger: { logQuery: (query: string, params: unknown[]) => void } };
      }
    ).session.logger;
    const queries = vi.spyOn(Object.getPrototypeOf(logger) as typeof logger, 'logQuery');
    try {
      const result = await readExecutionMessages(
        db,
        Array.from({ length: 50 }, (_, index) => ({
          ownerId,
          groupId,
          topicId,
          joinedAt,
          operationId,
          until: publishedAt,
          ids: Array.from({ length: 1400 }, (_, step) => `absent-${index}-${step}`),
          publicId: (id: string) => id,
        })),
      );
      expect(result).toEqual(Array.from({ length: 50 }, () => undefined));
      expect(Math.max(...queries.mock.calls.map(([, params]) => params.length))).toBeLessThan(
        65_535,
      );
    } finally {
      queries.mockRestore();
    }
  });

  it('keeps each batched execution within its own topic and time bounds', async () => {
    const input = {
      ownerId,
      groupId,
      topicId,
      joinedAt,
      operationId,
      until: publishedAt,
      ids: [assistantMessageId],
      publicId: (id: string) => `public-${id}`,
    };
    const result = await readExecutionMessages(db, [
      input,
      { ...input, topicId: otherTopicId },
      { ...input, until: joinedAt },
      { ...input, joinedAt: afterPublishedAt },
      { ...input, ids: [forgedMessageId] },
      { ...input, ids: [] },
    ]);
    expect(result[0]?.[0].content).toBe(content);
    expect(result.slice(1)).toEqual([undefined, undefined, undefined, undefined, []]);
    await expect(
      readExecutionMessages(db, [input, { ...input, ownerId: outsiderId }]),
    ).rejects.toThrow('Execution batch must belong to one owner and group');
  });

  it('reads every execution beyond the SQL batch boundary', async () => {
    const result = await readExecutionMessages(
      db,
      Array.from({ length: 51 }, (_, index) => ({
        ownerId,
        groupId,
        topicId,
        joinedAt,
        operationId,
        until: publishedAt,
        ids: [assistantMessageId],
        publicId: () => `public-${index}`,
      })),
    );
    expect(result).toHaveLength(51);
    expect(result[0]?.[0].id).toBe('public-0');
    expect(result[50]?.[0].id).toBe('public-50');
  });

  it('batches completed execution reads without dropping histories or retaining deleted steps', async () => {
    const ids = Array.from({ length: 8 }, (_, index) => `batch-final-${index}`);
    await db.insert(messages).values(
      ids.map((id): typeof messages.$inferInsert => ({
        id,
        content,
        role: 'assistant',
        userId: ownerId,
        groupId,
        topicId,
        createdAt: messageCreatedAt,
      })),
    );
    await db.insert(agentOperations).values(
      ids.map((id): typeof agentOperations.$inferInsert => ({
        id,
        userId: ownerId,
        chatGroupId: groupId,
        topicId,
        status: 'done',
        completionReason: 'done',
        completedAt: publishedAt,
        metadata: {
          ...operationMetadata(),
          hostedGroupMemberFinal: {
            ...hostedGroupMemberFinal,
            operationId: id,
            assistantMessageId: id,
            executionMessageIds: [id],
          },
        },
      })),
    );
    // Observe real SQL; do not stub the repository or message reader.
    const logger = (
      db as unknown as {
        session: { logger: { logQuery: (query: string, params: unknown[]) => void } };
      }
    ).session.logger;
    const queries = vi.spyOn(Object.getPrototypeOf(logger) as typeof logger, 'logQuery');
    try {
      const result = await repository.listAccessiblePublishedAssistantMessages(memberId, groupId);
      expect(result.filter((item) => item.executionMessages?.length === 1)).toHaveLength(8);
      const reads = queries.mock.calls.filter(([query]) =>
        /from\s+"messages"\s+left join/.test(query),
      ).length;
      expect(reads).toBe(1);
      // The permission mapping must stay valid until its content read in the same transaction.
      expect(
        queries.mock.calls.some(
          ([query]) => query.includes('array_remove(ARRAY[') && /for share\s*$/i.test(query),
        ),
      ).toBe(true);
      await db.delete(messages).where(eq(messages.id, ids[0]));
      const refreshed = await repository.listAccessiblePublishedAssistantMessages(
        memberId,
        groupId,
      );
      expect(refreshed.filter((item) => item.executionMessages?.length === 1)).toHaveLength(7);
    } finally {
      queries.mockRestore();
      await db.delete(agentOperations).where(inArray(agentOperations.id, ids));
      await db.delete(messages).where(inArray(messages.id, ids));
    }
  });

  it('shares live steps with current members, then replaces them with the same completed message IDs', async () => {
    const sourceId = 'live-execution-source';
    await db.insert(messages).values({
      id: sourceId,
      role: 'user',
      content: '实时请求',
      groupId,
      topicId,
      userId: ownerId,
      createdAt: messageCreatedAt,
    });
    await db
      .update(messages)
      .set({ parentId: sourceId })
      .where(eq(messages.id, assistantMessageId));
    await db
      .update(agentOperations)
      .set({
        status: 'running',
        completedAt: null,
        completionReason: null,
        appContext: { sourceMessageId: sourceId },
        metadata: { ...operationMetadata(), hostedGroupMemberFinal: undefined },
      })
      .where(eq(agentOperations.id, operationId));
    try {
      expect(
        await repository.listAccessiblePublishedAssistantMessages(memberId, groupId, topicId),
      ).toEqual([]);
      const [live] = await repository.listAccessiblePublishedAssistantMessages(
        memberId,
        groupId,
        undefined,
        undefined,
        true,
      );
      expect(live).toMatchObject({
        isGenerating: true,
        executionMessages: [{ role: 'assistant', content }],
      });
      const [again] = await repository.listAccessiblePublishedAssistantMessages(
        memberId,
        groupId,
        undefined,
        undefined,
        true,
      );
      expect(again.executionMessages?.[0].id).toBe(live.executionMessages?.[0].id);
      expect(
        await repository.listAccessiblePublishedAssistantMessages(
          afterPublishMemberId,
          groupId,
          undefined,
          undefined,
          true,
        ),
      ).toEqual([]);
      await expect(
        repository.listAccessiblePublishedAssistantMessages(
          removedMemberId,
          groupId,
          undefined,
          undefined,
          true,
        ),
      ).rejects.toThrow(GROUP_CONVERSATION_ACCESS_UNAVAILABLE);
      await db
        .update(agentOperations)
        .set({
          status: 'done',
          completionReason: 'done',
          completedAt: publishedAt,
          metadata: operationMetadata(),
        })
        .where(eq(agentOperations.id, operationId));
      const finished = await repository.listAccessiblePublishedAssistantMessages(
        memberId,
        groupId,
        undefined,
        undefined,
        true,
      );
      expect(finished).toHaveLength(1);
      expect(finished[0].isGenerating).toBeUndefined();
      expect(finished[0].executionMessages?.[0].id).toBe(live.executionMessages?.[0].id);
    } finally {
      await db
        .update(agentOperations)
        .set({
          status: 'done',
          completionReason: 'done',
          completedAt: publishedAt,
          appContext: null,
          metadata: operationMetadata(),
        })
        .where(eq(agentOperations.id, operationId));
      await db.update(messages).set({ parentId: null }).where(eq(messages.id, assistantMessageId));
      await db.delete(messages).where(eq(messages.id, sourceId));
    }
  });
  it('hydrates task details and nested tool messages using the same authorized reader', async () => {
    const taskId = 'published-child-task';
    const threadId = 'published-child-thread';
    const childId = 'published-child-answer';
    await db.insert(messages).values({
      id: taskId,
      role: 'task',
      content: '子任务',
      userId: ownerId,
      groupId,
      topicId,
      createdAt: messageCreatedAt,
    });
    await db.insert(threads).values({
      id: threadId,
      type: 'isolation',
      sourceMessageId: taskId,
      userId: ownerId,
      groupId,
      topicId,
      status: 'completed',
      title: '查找路线',
    });
    await db.insert(messages).values({
      id: childId,
      role: 'assistant',
      content: '子任务结果',
      userId: ownerId,
      topicId,
      threadId,
      createdAt: messageCreatedAt,
    });
    await db
      .update(agentOperations)
      .set({
        metadata: {
          ...operationMetadata(),
          hostedGroupMemberFinal: {
            ...hostedGroupMemberFinal,
            executionMessageIds: [taskId, assistantMessageId],
          },
        },
      })
      .where(eq(agentOperations.id, operationId));
    try {
      const [result] = await repository.listAccessiblePublishedAssistantMessages(
        memberId,
        groupId,
        topicId,
      );
      expect(result.executionMessages?.[0]).toMatchObject({
        role: 'task',
        taskDetail: { title: '查找路线', status: 'completed' },
        tasks: [{ content: '子任务结果', role: 'assistant' }],
      });
      expect(result.executionMessages?.[0].tasks?.[0].id).not.toBe(childId);
      await db.update(threads).set({ topicId: otherTopicId }).where(eq(threads.id, threadId));
      const [isolated] = await repository.listAccessiblePublishedAssistantMessages(
        memberId,
        groupId,
        topicId,
      );
      expect(isolated.executionMessages?.[0].tasks).toBeUndefined();
      expect(isolated.executionMessages?.[0].taskDetail).toBeUndefined();
    } finally {
      await db
        .update(agentOperations)
        .set({ metadata: operationMetadata() })
        .where(eq(agentOperations.id, operationId));
      await db.delete(threads).where(eq(threads.id, threadId));
      await db.delete(messages).where(inArray(messages.id, [taskId, childId]));
    }
  });
  it.each(['recorded', 'legacy'])(
    'returns the %s canonical tool chain through the shared reader',
    async (mode) => {
      const stepId = 'published-chain-step';
      const resultId = 'published-chain-result';
      const sourceId = 'published-chain-source';
      await db.insert(messages).values({
        id: sourceId,
        role: 'user',
        content: '本次请求',
        userId: ownerId,
        groupId,
        topicId,
        createdAt: messageCreatedAt,
      });
      await db.insert(messages).values([
        {
          id: stepId,
          parentId: sourceId,
          role: 'assistant',
          content: '',
          userId: ownerId,
          groupId,
          topicId,
          createdAt: messageCreatedAt,
          tools: [
            {
              id: 'call-1',
              type: 'builtin',
              apiName: 'search',
              identifier: 'lobe-web-browsing',
              arguments: '{}',
            },
          ],
        },
        {
          id: resultId,
          parentId: stepId,
          role: 'tool',
          content: '工具结果',
          userId: ownerId,
          groupId,
          topicId,
          createdAt: messageCreatedAt,
        },
      ]);
      await db
        .update(messages)
        .set({ parentId: resultId, metadata: { work: { rootOperationId: operationId } } })
        .where(eq(messages.id, assistantMessageId));
      await db.insert(works).values({
        id: 'published-chain-work',
        type: 'document',
        resourceType: 'document',
        resourceId: 'published-document',
        userId: ownerId,
        visibility: 'private',
        title: '行程产物',
        toolName: 'createDocument',
        toolIdentifier: 'lobe-notebook',
        originTopicId: topicId,
      });
      const [version] = await db
        .insert(workVersions)
        .values({
          workId: 'published-chain-work',
          version: 1,
          changeType: 'created',
          toolName: 'createDocument',
          toolIdentifier: 'lobe-notebook',
          rootOperationId: operationId,
          topicId,
          messageId: resultId,
        })
        .returning({ id: workVersions.id });
      await db
        .update(works)
        .set({ currentVersionId: version.id })
        .where(eq(works.id, 'published-chain-work'));
      await db
        .update(agentOperations)
        .set({
          appContext: { sourceMessageId: sourceId },
          metadata: {
            ...operationMetadata(),
            hostedGroupMemberFinal: {
              ...hostedGroupMemberFinal,
              ...(mode === 'recorded'
                ? { executionMessageIds: [stepId, resultId, assistantMessageId] }
                : {}),
            },
          },
        })
        .where(eq(agentOperations.id, operationId));
      try {
        const [published] = await repository.listAccessiblePublishedAssistantMessages(
          memberId,
          groupId,
          topicId,
        );
        expect(published.executionMessages?.map((message) => message.role)).toEqual([
          'assistant',
          'tool',
          'assistant',
        ]);
        expect(published.executionMessages?.[0].tools?.[0].id).toBe('call-1');
        expect(published.executionMessages?.at(-1)?.id).toBe(published.id);
        expect(published.executionMessages?.at(-1)).not.toHaveProperty('reasoning');
        expect(published.executionMessages?.at(-1)).not.toHaveProperty('provider');
        expect(published.executionMessages?.at(-1)?.works?.[0]).toMatchObject({
          id: 'published-chain-work',
          resourceType: 'document',
          resourceId: 'published-document',
          event: { rootOperationId: operationId },
        });
        expect(
          await repository.resolvePublishedResource(memberId, 'document', 'published-document'),
        ).toEqual({ ownerId, publishedAt });
        expect(
          await repository.resolvePublishedResource(outsiderId, 'document', 'published-document'),
        ).toBeUndefined();
        expect(
          await repository.resolvePublishedResource(
            afterPublishMemberId,
            'document',
            'published-document',
          ),
        ).toBeUndefined();
        expect(
          await repository.resolvePublishedResource(memberId, 'document', 'unrelated-document'),
        ).toBeUndefined();
        expect(
          await repository.resolvePublishedResource(memberId, 'file', 'published-document'),
        ).toBeUndefined();
        await db
          .insert(messageGroups)
          .values({ id: 'published-compression', type: 'compression', userId: ownerId, topicId });
        await db
          .update(messages)
          .set({ messageGroupId: 'published-compression' })
          .where(inArray(messages.id, [resultId, assistantMessageId]));
        const [archived] = await repository.listAccessiblePublishedAssistantMessages(
          memberId,
          groupId,
          topicId,
        );
        expect(archived).toBeDefined();
        expect(archived.executionMessages?.map((item) => item.role)).toEqual([
          'assistant',
          'tool',
          'assistant',
        ]);
        expect(archived.id).toBe(published.id);
        expect(
          await repository.resolvePublishedResource(memberId, 'document', 'published-document'),
        ).toEqual({ ownerId, publishedAt });
        const matches = await repository.listAccessiblePublishedAssistantMessages(
          memberId,
          groupId,
          topicId,
          '旅游文案',
        );
        expect(matches.map((item) => item.id)).toEqual([published.id]);
        await db
          .update(messages)
          .set({ messageGroupId: null })
          .where(inArray(messages.id, [resultId, assistantMessageId]));
        await db.update(messages).set({ topicId: otherTopicId }).where(eq(messages.id, resultId));
        const [isolated] = await repository.listAccessiblePublishedAssistantMessages(
          memberId,
          groupId,
          topicId,
        );
        expect(isolated.executionMessages).toBeUndefined();
        expect(isolated.content).toBe(content);
        expect(
          await repository.resolvePublishedResource(memberId, 'document', 'published-document'),
        ).toBeUndefined();
      } finally {
        await db
          .update(messages)
          .set({ messageGroupId: null })
          .where(inArray(messages.id, [resultId, assistantMessageId]));
        await db.delete(messageGroups).where(eq(messageGroups.id, 'published-compression'));
        await db.delete(works).where(eq(works.id, 'published-chain-work'));
        await db
          .update(messages)
          .set({ parentId: null, metadata: null })
          .where(eq(messages.id, assistantMessageId));
        await db
          .update(agentOperations)
          .set({ appContext: null, metadata: operationMetadata() })
          .where(eq(agentOperations.id, operationId));
        await db.delete(messages).where(inArray(messages.id, [stepId, resultId, sourceId]));
      }
    },
  );
  it('resolves the exact saved request after archival, including attachments and mentions, only for an accessible publication', async () => {
    const originalRequest = {
      prompt: '原始要求\n\n[附件](</api/file/proxy/original-file>)',
      mentionedAgentIds: ['writer'],
    };
    await db
      .insert(messageGroups)
      .values({ id: 'archived-retry', type: 'compression', userId: ownerId, topicId });
    await db
      .update(messages)
      .set({ messageGroupId: 'archived-retry' })
      .where(eq(messages.id, assistantMessageId));
    await db
      .update(agentOperations)
      .set({
        metadata: {
          ...operationMetadata(),
          hostedGroupRun: { ...hostedGroupRun, originalRequest },
        },
      })
      .where(eq(agentOperations.id, operationId));
    try {
      const [published] = await repository.listAccessiblePublishedAssistantMessages(
        memberId,
        groupId,
        topicId,
      );
      expect(
        await repository.getAccessiblePublishedAssistantRequest(memberId, groupId, published.id),
      ).toEqual({ ...originalRequest, topicId });
      expect(published).not.toHaveProperty('originalRequest');
      await expect(
        repository.getAccessiblePublishedAssistantRequest(outsiderId, groupId, published.id),
      ).rejects.toThrow();
      await expect(
        repository.getAccessiblePublishedAssistantRequest(memberId, groupId, 'f'.repeat(64)),
      ).rejects.toThrow();
    } finally {
      await db
        .update(messages)
        .set({ messageGroupId: null })
        .where(eq(messages.id, assistantMessageId));
      await db.delete(messageGroups).where(eq(messageGroups.id, 'archived-retry'));
      await db
        .update(agentOperations)
        .set({ metadata: operationMetadata() })
        .where(eq(agentOperations.id, operationId));
    }
  });

  it('does not expose final replies through a foreign or non-compression message group', async () => {
    await db
      .insert(messageGroups)
      .values({ id: 'foreign-archive', type: 'compression', userId: outsiderId, topicId });
    await db
      .update(messages)
      .set({ messageGroupId: 'foreign-archive' })
      .where(eq(messages.id, assistantMessageId));
    try {
      expect(
        await repository.listAccessiblePublishedAssistantMessages(memberId, groupId, topicId),
      ).toEqual([]);
      await db
        .update(messageGroups)
        .set({ userId: ownerId, topicId: otherTopicId })
        .where(eq(messageGroups.id, 'foreign-archive'));
      expect(
        await repository.listAccessiblePublishedAssistantMessages(memberId, groupId, topicId),
      ).toEqual([]);
      await db
        .update(messageGroups)
        .set({ topicId, type: 'parallel' })
        .where(eq(messageGroups.id, 'foreign-archive'));
      expect(
        await repository.listAccessiblePublishedAssistantMessages(memberId, groupId, topicId),
      ).toEqual([]);
    } finally {
      await db
        .update(messages)
        .set({ messageGroupId: null })
        .where(eq(messages.id, assistantMessageId));
      await db.delete(messageGroups).where(eq(messageGroups.id, 'foreign-archive'));
    }
  });

  it('does not guess the request when a legacy publication has no original request snapshot', async () => {
    const [published] = await repository.listAccessiblePublishedAssistantMessages(
      memberId,
      groupId,
      topicId,
    );
    await expect(
      repository.getAccessiblePublishedAssistantRequest(memberId, groupId, published.id),
    ).rejects.toThrow();
  });

  it('keeps an explicitly linked generated file with the verified final answer', async () => {
    const fileContent = `${content}\n\n[行程文件](<${getFileProxyUrl(attachmentId)}>)`;
    await db.insert(files).values({
      id: attachmentId,
      userId: ownerId,
      name: '行程.txt',
      fileType: 'text/plain',
      size: 8,
      url: 'private-storage-key',
    });
    await db
      .insert(messagesFiles)
      .values({ messageId: assistantMessageId, fileId: attachmentId, userId: ownerId });
    await db
      .update(messages)
      .set({ content: fileContent })
      .where(eq(messages.id, assistantMessageId));
    await db
      .update(agentOperations)
      .set({
        metadata: {
          ...operationMetadata(),
          hostedGroupMemberFinal: {
            ...hostedGroupMemberFinal,
            contentHash: createHash('sha256').update(fileContent).digest('hex'),
          },
        },
      })
      .where(eq(agentOperations.id, operationId));
    try {
      const result = await repository.listAccessiblePublishedAssistantMessages(
        memberId,
        groupId,
        undefined,
      );
      expect(result).toHaveLength(1);
      expect(result[0].fileList).toEqual([
        {
          id: attachmentId,
          name: '行程.txt',
          fileType: 'text/plain',
          size: 8,
          url: getFileProxyUrl(attachmentId),
          downloadUrl: `${getFileProxyUrl(attachmentId)}?download=1`,
        },
      ]);
      expect(JSON.stringify(result)).not.toContain('private-storage-key');
    } finally {
      await db.delete(messagesFiles).where(eq(messagesFiles.messageId, assistantMessageId));
      await db.delete(files).where(eq(files.id, attachmentId));
      await db.update(messages).set({ content }).where(eq(messages.id, assistantMessageId));
      await db
        .update(agentOperations)
        .set({ metadata: operationMetadata() })
        .where(eq(agentOperations.id, operationId));
    }
  });
  it('filters published answers before returning search results without exposing hidden content', async () => {
    await expect(
      repository.listAccessiblePublishedAssistantMessages(
        memberId,
        groupId,
        undefined,
        '不存在的内容',
      ),
    ).resolves.toEqual([]);
    const found = await repository.listAccessiblePublishedAssistantMessages(
      memberId,
      groupId,
      undefined,
      '西藏',
    );
    expect(found.map((message) => message.content)).toEqual([content]);
    await expect(
      repository.listAccessiblePublishedAssistantMessages(memberId, groupId, undefined, '%'),
    ).resolves.toEqual([]);
  });
  it('returns only the server-published final text and no operation or model internals', async () => {
    const [item] = await repository.listAccessiblePublishedAssistantMessages(
      memberId,
      groupId,
      topicId,
    );

    expect(item).toMatchObject({ content, kind: 'assistant', topicId, visibleAt: publishedAt });
    expect(item?.id).toMatch(/^[a-f\d]{64}$/);
    expect(item?.id).not.toBe(assistantMessageId);
  });

  it('does not trust a client-created assistant role or message metadata', async () => {
    const result = await repository.listAccessiblePublishedAssistantMessages(
      memberId,
      groupId,
      topicId,
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.content).toBe(content);
    expect(result[0]?.id).not.toBe(assistantMessageId);
    expect(result[0]?.id).not.toBe(forgedMessageId);
  });

  it('lets another active member who joined after run start but before publication read the final', async () => {
    await expect(
      repository.listAccessiblePublishedAssistantMessages(beforePublishMemberId, groupId, topicId),
    ).resolves.toEqual([
      expect.objectContaining({ content, kind: 'assistant', topicId, visibleAt: publishedAt }),
    ]);
  });

  it('does not expose a final to a member whose current membership started after publication', async () => {
    await expect(
      repository.listAccessiblePublishedAssistantMessages(afterPublishMemberId, groupId, topicId),
    ).resolves.toEqual([]);
  });

  it('keeps the published final visible to another active member after removing the initiating member', async () => {
    await db
      .update(chatGroupUserMemberships)
      .set({ removedAt: new Date('2026-09-04T03:10:00.000Z') })
      .where(
        and(
          eq(chatGroupUserMemberships.chatGroupId, groupId),
          eq(chatGroupUserMemberships.userId, memberId),
        ),
      );

    try {
      await expect(
        repository.listAccessiblePublishedAssistantMessages(
          beforePublishMemberId,
          groupId,
          topicId,
        ),
      ).resolves.toEqual([
        expect.objectContaining({ content, kind: 'assistant', topicId, visibleAt: publishedAt }),
      ]);
      await expect(
        repository.listAccessiblePublishedAssistantMessages(memberId, groupId, topicId),
      ).rejects.toThrow(GROUP_CONVERSATION_ACCESS_UNAVAILABLE);
    } finally {
      await db
        .update(chatGroupUserMemberships)
        .set({ removedAt: null })
        .where(
          and(
            eq(chatGroupUserMemberships.chatGroupId, groupId),
            eq(chatGroupUserMemberships.userId, memberId),
          ),
        );
    }
  });

  it('fails the projection when the durable message content no longer matches its SHA-256 marker', async () => {
    await db
      .update(messages)
      .set({ content: '被篡改的最终文案' })
      .where(eq(messages.id, assistantMessageId));

    try {
      await expect(
        repository.listAccessiblePublishedAssistantMessages(memberId, groupId, topicId),
      ).resolves.toEqual([]);
    } finally {
      await db.update(messages).set({ content }).where(eq(messages.id, assistantMessageId));
    }
  });

  it('requires exact root-operation, owner, group, topic, membership and publication bindings', async () => {
    const invalidMarkers = [
      { ...hostedGroupMemberFinal, groupId: 'another-group' },
      { ...hostedGroupMemberFinal, membershipVersion: 1 },
      { ...hostedGroupMemberFinal, operationId: 'another-operation' },
      { ...hostedGroupMemberFinal, ownerUserIdSnapshot: outsiderId },
      { ...hostedGroupMemberFinal, actorUserIdSnapshot: outsiderId },
      { ...hostedGroupMemberFinal, assistantMessageId: forgedMessageId },
      { ...hostedGroupMemberFinal, contentHash: 'A'.repeat(64) },
      { ...hostedGroupMemberFinal, publishedAt: '2026-09-04T01:00:00.000Z' },
      { ...hostedGroupMemberFinal, version: 2 },
    ];

    for (const marker of invalidMarkers) {
      await db
        .update(agentOperations)
        .set({ metadata: { ...operationMetadata(), hostedGroupMemberFinal: marker } })
        .where(eq(agentOperations.id, operationId));
      await expect(
        repository.listAccessiblePublishedAssistantMessages(memberId, groupId, topicId),
      ).resolves.toEqual([]);
    }

    await db
      .update(agentOperations)
      .set({ metadata: operationMetadata() })
      .where(eq(agentOperations.id, operationId));
  });

  it('requires a successful root operation without errors or interruption', async () => {
    const invalidOperationStates = [
      { completionReason: null, status: 'running' as const },
      { completionReason: 'error' as const, status: 'done' as const },
      { error: { message: 'internal failure' } },
      {
        interruption: {
          canResume: false,
          interruptedAt: publishedAt.toISOString(),
          reason: 'stopped',
        },
      },
      { parentOperationId: 'parent-operation' },
    ];

    for (const state of invalidOperationStates) {
      await db.update(agentOperations).set(state).where(eq(agentOperations.id, operationId));
      await expect(
        repository.listAccessiblePublishedAssistantMessages(memberId, groupId, topicId),
      ).resolves.toEqual([]);
      await db
        .update(agentOperations)
        .set({
          completionReason: 'done',
          error: null,
          interruption: null,
          metadata: operationMetadata(),
          parentOperationId: null,
          status: 'done',
        })
        .where(eq(agentOperations.id, operationId));
    }
  });

  it('keeps assistant projection topic-bound and rejects unsafe message state or attachments', async () => {
    await expect(
      repository.listAccessiblePublishedAssistantMessages(memberId, groupId, otherTopicId),
    ).resolves.toEqual([]);

    for (const state of [{ error: { message: 'message failed' } }, { role: 'user' as const }]) {
      await db.update(messages).set(state).where(eq(messages.id, assistantMessageId));
      await expect(
        repository.listAccessiblePublishedAssistantMessages(memberId, groupId, topicId),
      ).resolves.toEqual([]);
      await db
        .update(messages)
        .set({ error: null, role: 'assistant' })
        .where(eq(messages.id, assistantMessageId));
    }

    await db.insert(files).values({
      fileType: 'text/plain',
      id: attachmentId,
      name: 'internal.txt',
      size: 8,
      url: 'https://example.test/internal.txt',
      userId: ownerId,
    });
    await db.insert(messagesFiles).values({
      fileId: attachmentId,
      messageId: assistantMessageId,
      userId: ownerId,
    });

    await expect(
      repository.listAccessiblePublishedAssistantMessages(memberId, groupId, topicId),
    ).resolves.toEqual([]);

    await db.delete(messagesFiles).where(eq(messagesFiles.messageId, assistantMessageId));
    await db.delete(files).where(eq(files.id, attachmentId));
  });

  it('invalidates removal and does not expose an old final after a post-publication rejoin', async () => {
    await db
      .update(chatGroupUserMemberships)
      .set({ joinedAt: afterPublishedAt, membershipVersion: 3 })
      .where(
        and(
          eq(chatGroupUserMemberships.chatGroupId, groupId),
          eq(chatGroupUserMemberships.userId, memberId),
        ),
      );
    await expect(
      repository.listAccessiblePublishedAssistantMessages(memberId, groupId, topicId),
    ).resolves.toEqual([]);

    await db
      .update(chatGroupUserMemberships)
      .set({ removedAt: publishedAt })
      .where(
        and(
          eq(chatGroupUserMemberships.chatGroupId, groupId),
          eq(chatGroupUserMemberships.userId, memberId),
        ),
      );
    await expect(
      repository.listAccessiblePublishedAssistantMessages(memberId, groupId, topicId),
    ).rejects.toThrow(GROUP_CONVERSATION_ACCESS_UNAVAILABLE);

    await db
      .update(chatGroupUserMemberships)
      .set({ joinedAt, membershipVersion: 2, removedAt: null })
      .where(
        and(
          eq(chatGroupUserMemberships.chatGroupId, groupId),
          eq(chatGroupUserMemberships.userId, memberId),
        ),
      );
  });

  it('rejects owners, outsiders and already removed members from the member-only projection', async () => {
    await expect(
      repository.listAccessiblePublishedAssistantMessages(ownerId, groupId, topicId),
    ).rejects.toThrow(GROUP_CONVERSATION_ACCESS_UNAVAILABLE);
    await expect(
      repository.listAccessiblePublishedAssistantMessages(outsiderId, groupId, topicId),
    ).rejects.toThrow(GROUP_CONVERSATION_ACCESS_UNAVAILABLE);
    await expect(
      repository.listAccessiblePublishedAssistantMessages(removedMemberId, groupId, topicId),
    ).rejects.toThrow(GROUP_CONVERSATION_ACCESS_UNAVAILABLE);
  });
});
