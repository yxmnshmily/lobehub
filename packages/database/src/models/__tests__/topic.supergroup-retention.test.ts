// @vitest-environment node
import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, chatGroups, messages, sessions, topics, users } from '../../schemas';
import { TopicModel } from '../topic';

const db = await getTestDB();
const userId = 'supergroup-retention-owner';
const groupId = 'supergroup-retention-default';
const ordinaryGroupId = 'supergroup-retention-ordinary';
const agentId = 'supergroup-retention-agent';
const targetAgentId = 'supergroup-retention-target-agent';
const sessionId = 'supergroup-retention-session';
const protectedTopicId = 'supergroup-retention-topic';
const ordinaryTopicId = 'supergroup-retention-ordinary-topic';
const model = new TopicModel(db, userId);

beforeEach(async () => {
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values([
    { id: agentId, userId },
    { id: targetAgentId, userId },
  ]);
  await db.insert(sessions).values({ id: sessionId, userId });
  await db.insert(chatGroups).values([
    { id: groupId, userId, clientId: DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID },
    { id: ordinaryGroupId, userId },
  ]);
  await db.insert(topics).values([
    { id: protectedTopicId, userId, agentId, sessionId, groupId },
    { id: ordinaryTopicId, userId, agentId, sessionId, groupId: ordinaryGroupId },
  ]);
  await db.insert(messages).values({
    id: 'supergroup-retention-message',
    userId,
    groupId,
    topicId: protectedTopicId,
    role: 'user',
    content: '群聊天记录',
  });
});

afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

describe('default supergroup original topic permissions', () => {
  it.each([
    ['single', () => model.delete(protectedTopicId)],
    ['selected', () => model.batchDelete([protectedTopicId])],
    ['session', () => model.batchDeleteBySessionId(sessionId)],
    ['group', () => model.batchDeleteByGroupId(groupId)],
    ['agent', () => model.batchDeleteByAgentId(agentId)],
    ['all', () => model.deleteAll()],
  ] as const)('allows owner deletion through %s', async (_label, remove) => {
    await remove();
    expect(await db.select().from(topics).where(eq(topics.id, protectedTopicId))).toEqual([]);
    expect(await db.select().from(messages).where(eq(messages.topicId, protectedTopicId))).toEqual(
      [],
    );
  });

  it('keeps other users from deleting owned topics', async () => {
    const outsider = new TopicModel(db, 'not-the-owner');
    await outsider.delete(protectedTopicId);
    await outsider.batchDelete([protectedTopicId]);
    await outsider.batchDeleteByGroupId(groupId);
    expect(await db.select().from(topics).where(eq(topics.id, protectedTopicId))).toHaveLength(1);
  });

  it('moves selected owned topics and their messages to an accessible agent', async () => {
    await model.batchMoveToAgent([protectedTopicId, ordinaryTopicId], targetAgentId);
    const [topic] = await db.select().from(topics).where(eq(topics.id, protectedTopicId));
    const [message] = await db
      .select()
      .from(messages)
      .where(eq(messages.topicId, protectedTopicId));
    expect(topic).toMatchObject({ agentId: targetAgentId, sessionId: null });
    expect(message.agentId).toBe(targetAgentId);
  });

  it('allows the owner to change topic grouping', async () => {
    await model.update(protectedTopicId, { groupId: ordinaryGroupId });
    const [topic] = await db.select().from(topics).where(eq(topics.id, protectedTopicId));
    expect(topic.groupId).toBe(ordinaryGroupId);
  });
});
