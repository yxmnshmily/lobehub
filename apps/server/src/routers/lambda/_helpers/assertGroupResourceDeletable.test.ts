// @vitest-environment node
import {
  agents,
  chatGroups,
  goals,
  projectChatGroups,
  projects,
  tasks,
  topics,
  users,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assertGroupOwnerForDeletion,
  assertGroupResourceDeletable,
} from './assertGroupResourceDeletable';

const db = await getTestDB();
const owner = 'delete-guard-owner';
const member = 'delete-guard-member';
const groupId = 'delete-guard-group';
const ids = {
  topic: 'delete-guard-topic',
  task: 'delete-guard-task',
  goal: 'delete-guard-goal',
  project: 'delete-guard-project',
};

describe('group owner deletion guard with real SQL', () => {
  beforeAll(async () => {
    await db.insert(users).values([{ id: owner }, { id: member }]);
    await db.insert(chatGroups).values({ id: groupId, userId: owner });
    await db.insert(agents).values({ id: 'delete-guard-agent', userId: member });
    await db.insert(topics).values({ id: ids.topic, userId: member, groupId });
    await db.insert(tasks).values({
      id: ids.task,
      createdByUserId: member,
      identifier: 'DG-1',
      seq: 1,
      instruction: 'fixture',
      config: { groupId },
    });
    await db
      .insert(goals)
      .values({ id: ids.goal, userId: member, title: 'fixture', config: { groupId } });
    await db.insert(projects).values({
      id: ids.project,
      userId: member,
      identifier: 'DGR',
      name: 'fixture',
      coordinatorAgentId: 'delete-guard-agent',
    });
    await db.insert(projectChatGroups).values({ projectId: ids.project, chatGroupId: groupId });
  });
  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, ids.project));
    await db.delete(users).where(inArray(users.id, [owner, member]));
  });
  for (const resource of ['topic', 'task', 'goal', 'project'] as const) {
    it(`rejects ${resource} creator who is not the group owner and leaves data intact`, async () => {
      await expect(
        assertGroupResourceDeletable({ serverDB: db, userId: member }, resource, [ids[resource]]),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        assertGroupResourceDeletable({ serverDB: db, userId: owner }, resource, [ids[resource]]),
      ).resolves.toBeUndefined();
    });
  }
  it('does not add restrictions to non-group resources', async () => {
    await db.insert(topics).values({ id: 'delete-guard-personal', userId: member });
    await expect(
      assertGroupResourceDeletable({ serverDB: db, userId: member }, 'topic', [
        'delete-guard-personal',
      ]),
    ).resolves.toBeUndefined();
  });
  it('rejects missing groups instead of trusting the client id', async () => {
    await expect(
      assertGroupOwnerForDeletion({ serverDB: db, userId: member }, ['missing-group']),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
