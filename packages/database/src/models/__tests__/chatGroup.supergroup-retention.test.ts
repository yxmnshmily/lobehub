// @vitest-environment node
import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, chatGroups, chatGroupsAgents, messages, topics, users } from '../../schemas';
import { ChatGroupModel } from '../chatGroup';

const db = await getTestDB();
const userId = 'default-group-retention-user';
const groupId = 'default-group-retention-group';
const ordinaryGroupId = 'default-group-retention-ordinary';
const agentId = 'default-group-retention-agent';
const topicId = 'default-group-retention-topic';
const model = new ChatGroupModel(db, userId);

beforeEach(async () => {
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values({ id: agentId, userId, virtual: true });
  await db.insert(chatGroups).values([
    {
      id: groupId,
      userId,
      clientId: DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
      visibility: 'private',
    },
    { id: ordinaryGroupId, userId },
  ]);
  await db
    .insert(chatGroupsAgents)
    .values({ agentId, chatGroupId: groupId, userId, role: 'participant' });
  await db.insert(topics).values({ id: topicId, groupId, userId });
  await db
    .insert(messages)
    .values({ id: 'default-group-retention-message', topicId, groupId, userId, role: 'user' });
});
afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

describe('default personal supergroup original permissions', () => {
  it('allows owner deletion and cascades its transcript', async () => {
    await model.delete(groupId);
    expect(await db.select().from(chatGroups).where(eq(chatGroups.id, groupId))).toEqual([]);
    expect(await db.select().from(topics).where(eq(topics.id, topicId))).toEqual([]);
    expect(await db.select().from(agents).where(eq(agents.id, agentId))).toEqual([]);
  });
  it('includes the owned default group when deleting all owned groups', async () => {
    await model.deleteAll();
    expect(await db.select().from(chatGroups).where(eq(chatGroups.userId, userId))).toEqual([]);
  });
  it('does not let another user delete the group', async () => {
    await expect(new ChatGroupModel(db, 'not-the-owner').delete(groupId)).rejects.toThrow();
    expect(await db.select().from(chatGroups).where(eq(chatGroups.id, groupId))).toHaveLength(1);
  });
});
