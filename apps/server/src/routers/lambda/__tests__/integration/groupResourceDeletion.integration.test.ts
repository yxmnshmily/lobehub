// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import {
  agents,
  chatGroups,
  goalNodes,
  goals,
  messages,
  projectChatGroups,
  projects,
  tasks,
  taskTopics,
  topics,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { goalRouter } from '../../goal';
import { projectRouter } from '../../project';
import { resourceDeletionRouter } from '../../resourceDeletion';
import { taskRouter } from '../../task';
import { topicRouter } from '../../topic';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

let db: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => db }));
let owner: string;
let member: string;
const groupId = 'deletion-router-group';
const resourceId = 'deletion-router-resource';

describe('group deletion API ownership', () => {
  beforeAll(async () => {
    db = await getTestDB();
    owner = await createTestUser(db);
    member = await createTestUser(db);
    await db.insert(chatGroups).values({ id: groupId, userId: owner });
    await db.insert(agents).values({ id: 'deletion-router-agent', userId: member });
    // Creator ownership alone must never override group-owner deletion rights.
    await db.insert(topics).values({ id: resourceId, userId: member, groupId });
    await db.insert(messages).values({
      id: 'deletion-router-message',
      userId: member,
      topicId: resourceId,
      groupId,
      role: 'user',
      content: 'preserve',
    });
    await db.insert(tasks).values({
      id: resourceId,
      createdByUserId: member,
      identifier: 'DEL-1',
      seq: 1,
      instruction: 'fixture',
      config: { groupId },
    });
    await db
      .insert(goals)
      .values({ id: resourceId, userId: member, title: 'fixture', config: { groupId } });
    await db.insert(projects).values({
      id: resourceId,
      userId: member,
      identifier: 'DEL',
      name: 'fixture',
      coordinatorAgentId: 'deletion-router-agent',
    });
    await db.insert(projectChatGroups).values({ projectId: resourceId, chatGroupId: groupId });
  });
  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, resourceId));
    await cleanupTestUser(db, member);
    await cleanupTestUser(db, owner);
  });
  it('rejects all four resource deletion calls from a non-owner', async () => {
    const context = createTestContext(member);
    const cascade = resourceDeletionRouter.createCaller(context);
    for (const resource of ['goal', 'task', 'project'] as const) {
      await expect(cascade.preview({ resource, ids: [resourceId] })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        cascade.delete({ resource, ids: [resourceId], snapshot: 'unauthorized' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }

    await expect(
      topicRouter.createCaller(context).removeTopic({ id: resourceId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      topicRouter.createCaller(context).batchDelete({ ids: [resourceId] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(taskRouter.createCaller(context).delete({ id: resourceId })).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    );
    await expect(goalRouter.createCaller(context).delete({ id: resourceId })).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    );
    await expect(
      projectRouter.createCaller(context).delete({ id: resourceId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await db.select().from(topics).where(eq(topics.id, resourceId))).toHaveLength(1);
    expect(
      await db.select().from(messages).where(eq(messages.id, 'deletion-router-message')),
    ).toHaveLength(1);
    expect(await db.select().from(tasks).where(eq(tasks.id, resourceId))).toHaveLength(1);
    expect(await db.select().from(goals).where(eq(goals.id, resourceId))).toHaveLength(1);
    expect(await db.select().from(projects).where(eq(projects.id, resourceId))).toHaveLength(1);
  });
  it('rejects sweep and secondary topic deletion paths before mutation', async () => {
    const topic = topicRouter.createCaller(createTestContext(member));
    await expect(topic.batchDeleteByGroupId({ groupId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(topic.removeAllTopics()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      taskRouter.createCaller(createTestContext(member)).clearAll(),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      taskRouter.createCaller(createTestContext(member)).deleteTopic({ topicId: resourceId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('allows a group owner to permanently delete its own topic and messages', async () => {
    const id = 'deletion-router-owner-topic';
    await db.insert(topics).values({ id, userId: owner, groupId });
    await db.insert(messages).values({
      id: 'deletion-router-owner-message',
      userId: owner,
      topicId: id,
      groupId,
      role: 'user',
      content: 'delete',
    });
    await topicRouter.createCaller(createTestContext(owner)).removeTopic({ id });
    expect(await db.select().from(topics).where(eq(topics.id, id))).toHaveLength(0);
    expect(await db.select().from(messages).where(eq(messages.topicId, id))).toHaveLength(0);
  });
  it('allows the group owner to delete its own goal', async () => {
    const id = 'deletion-router-owner-goal';
    await db.insert(goals).values({ id, userId: owner, title: 'owner goal', config: { groupId } });
    await db.insert(goalNodes).values({ goalId: id, kind: 'task', title: 'linked graph node' });
    await goalRouter.createCaller(createTestContext(owner)).delete({ id });
    expect(await db.select().from(goalNodes).where(eq(goalNodes.goalId, id))).toHaveLength(0);
    expect(await db.select().from(goals).where(eq(goals.id, id))).toHaveLength(0);
  });

  it('allows the group owner to delete its own task', async () => {
    const id = 'task_deletion-router-owner-task';
    await db.insert(tasks).values({
      id,
      createdByUserId: owner,
      identifier: 'OWN-1',
      seq: 1,
      instruction: 'owner task',
      config: { groupId },
    });
    await db
      .insert(topics)
      .values({ id: 'deletion-router-retained-task-topic', userId: owner, groupId });
    await db.insert(taskTopics).values({
      taskId: id,
      topicId: 'deletion-router-retained-task-topic',
      userId: owner,
      seq: 1,
      status: 'completed',
    });
    await taskRouter.createCaller(createTestContext(owner)).delete({ id });
    expect(await db.select().from(taskTopics).where(eq(taskTopics.taskId, id))).toHaveLength(0);
    expect(
      await db.select().from(topics).where(eq(topics.id, 'deletion-router-retained-task-topic')),
    ).toHaveLength(0);
    expect(await db.select().from(tasks).where(eq(tasks.id, id))).toHaveLength(0);
    await expect(
      taskRouter.createCaller(createTestContext(owner)).delete({ id }),
    ).resolves.toMatchObject({ success: true });
  });

  it('allows the group owner to delete its project and bindings but preserves the reusable group', async () => {
    const id = 'deletion-router-owner-project';
    const agentId = 'deletion-router-owner-coordinator';
    await db.insert(agents).values({ id: agentId, userId: owner });
    await db.insert(projects).values({
      id,
      userId: owner,
      identifier: 'OWN',
      name: 'owner project',
      coordinatorAgentId: agentId,
    });
    await db.insert(projectChatGroups).values({ projectId: id, chatGroupId: groupId });
    await projectRouter.createCaller(createTestContext(owner)).delete({ id });
    expect(await db.select().from(projects).where(eq(projects.id, id))).toHaveLength(0);
    expect(
      await db.select().from(projectChatGroups).where(eq(projectChatGroups.projectId, id)),
    ).toHaveLength(0);
    expect(await db.select().from(agents).where(eq(agents.id, agentId))).toHaveLength(0);
    expect(await db.select().from(chatGroups).where(eq(chatGroups.id, groupId))).toHaveLength(1);
  });
  it('clear-all also removes exclusive conversations instead of orphaning them', async () => {
    const user = await createTestUser(db);
    const id = 'deletion-clear-all-exclusive';
    try {
      await db.insert(topics).values({ id, userId: user });
      await db.insert(tasks).values({
        id,
        createdByUserId: user,
        identifier: 'CLR-1',
        seq: 1,
        instruction: 'disposable',
      });
      await db
        .insert(taskTopics)
        .values({ taskId: id, topicId: id, userId: user, seq: 1, status: 'completed' });
      const result = await taskRouter.createCaller(createTestContext(user)).clearAll();
      expect(result.count).toBe(1);
      expect(result.deletion?.deletedIds.topics).toContain(id);
      expect(await db.select().from(tasks).where(eq(tasks.id, id))).toHaveLength(0);
      expect(await db.select().from(topics).where(eq(topics.id, id))).toHaveLength(0);
    } finally {
      await cleanupTestUser(db, user);
    }
  });
});
