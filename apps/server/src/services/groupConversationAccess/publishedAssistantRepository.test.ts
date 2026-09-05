// @vitest-environment node
import { createHash } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import {
  agentOperations,
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

import { GroupConversationAccessRepository } from './conversationRepository';
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
      repository.listAccessiblePublishedAssistantMessages(
        beforePublishMemberId,
        groupId,
        topicId,
      ),
    ).resolves.toEqual([
      expect.objectContaining({ content, kind: 'assistant', topicId, visibleAt: publishedAt }),
    ]);
  });

  it('does not expose a final to a member whose current membership started after publication', async () => {
    await expect(
      repository.listAccessiblePublishedAssistantMessages(
        afterPublishMemberId,
        groupId,
        topicId,
      ),
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
