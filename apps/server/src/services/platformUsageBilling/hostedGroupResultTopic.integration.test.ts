// @vitest-environment node
import { chatGroups, topics, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveHostedGroupResultTopicId } from './hostedGroupOperationAccess';

const db = await getTestDB();
beforeAll(async () => {
  await db.insert(users).values([{ id: 'result-owner' }, { id: 'result-other' }]);
  await db.insert(chatGroups).values([
    { id: 'result-group', userId: 'result-owner' },
    { id: 'result-other-group', userId: 'result-other' },
  ]);
  await db.insert(topics).values([
    { id: 'result-topic', groupId: 'result-group', userId: 'result-owner' },
    { id: 'result-private-topic', userId: 'result-owner' },
    { id: 'result-other-topic', groupId: 'result-other-group', userId: 'result-other' },
  ]);
});
afterAll(async () => {
  await db.delete(users);
});

describe('hosted group result topic projection', () => {
  it('returns only the exact execution topic belonging to the authorized owner and group', async () => {
    const scope = { groupId: 'result-group', ownerUserId: 'result-owner' };
    expect(await resolveHostedGroupResultTopicId(db, { ...scope, topicId: 'result-topic' })).toBe(
      'result-topic',
    );
    expect(
      await resolveHostedGroupResultTopicId(db, { ...scope, topicId: 'result-private-topic' }),
    ).toBeUndefined();
    expect(
      await resolveHostedGroupResultTopicId(db, { ...scope, topicId: 'result-other-topic' }),
    ).toBeUndefined();
    expect(
      await resolveHostedGroupResultTopicId(db, { ...scope, topicId: undefined }),
    ).toBeUndefined();
  });
});
