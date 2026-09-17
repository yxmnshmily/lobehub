// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import {
  acceptances,
  agentOperations,
  agents,
  asyncTasks,
  chatGroups,
  documents,
  files,
  globalFiles,
  goalNodes,
  goals,
  knowledgeBaseFiles,
  knowledgeBases,
  messages,
  messagesFiles,
  projectChatGroups,
  projects,
  taskDocuments,
  tasks,
  taskTopics,
  topics,
  users,
  verifyCheckResults,
  verifyEvidence,
  verifyRuns,
  works,
  workVersions,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ResourceDeletionService } from './index';

const storage = vi.hoisted(() => ({ deleteFiles: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/server/services/file', () => ({
  FileService: class {
    deleteFiles = storage.deleteFiles;
  },
}));
let db: LobeChatDatabase;
const owner = 'resource-deletion-owner';
const outsider = 'resource-deletion-outsider';
const group = 'resource-deletion-group';
const makeTask = (id: string, extra = {}) =>
  db.insert(tasks).values({
    id,
    createdByUserId: owner,
    identifier: id,
    seq: 1,
    instruction: 'fixture',
    config: { groupId: group },
    ...extra,
  });
const makeTopic = (id: string) => db.insert(topics).values({ id, userId: owner, groupId: group });
const link = (taskId: string, topicId: string) =>
  db.insert(taskTopics).values({ taskId, topicId, userId: owner, seq: 1, status: 'completed' });

describe('exclusive resource deletion (real SQL)', () => {
  beforeAll(async () => {
    db = await getTestDB();
    await db.insert(users).values([{ id: owner }, { id: outsider }]);
    await db.insert(chatGroups).values({ id: group, userId: owner });
  });
  afterAll(async () => {
    await db.delete(agentOperations).where(eq(agentOperations.userId, owner));
    await db.delete(files).where(eq(files.userId, owner));
    await db
      .delete(globalFiles)
      .where(inArray(globalFiles.hashId, ['rd-file-own', 'rd-file-kb', 'rd-file-evidence']));
    await db.delete(users).where(inArray(users.id, [owner, outsider]));
  }, 30000);

  it('rejects unauthorized previews without mutating data', async () => {
    await makeTask('rd-denied');
    await expect(
      new ResourceDeletionService(db, outsider).preview('task', ['rd-denied']),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await db.select().from(tasks).where(eq(tasks.id, 'rd-denied'))).toHaveLength(1);
  });

  it('hard deletes exclusive topic messages and acceptance rounds, retains shared topic', async () => {
    await makeTask('rd-task');
    await makeTask('rd-other');
    await makeTopic('rd-exclusive');
    await makeTopic('rd-shared');
    await link('rd-task', 'rd-exclusive');
    await link('rd-task', 'rd-shared');
    await link('rd-other', 'rd-shared');
    await db.insert(messages).values({
      id: 'rd-message',
      userId: owner,
      topicId: 'rd-exclusive',
      role: 'assistant',
      content: 'delete permanently',
    });
    const [acceptance] = await db
      .insert(acceptances)
      .values({ userId: owner, subjectType: 'task', subjectId: 'rd-task' })
      .returning();
    const [run] = await db
      .insert(verifyRuns)
      .values({ userId: owner, acceptanceId: acceptance.id, roundIndex: 1 })
      .returning();
    const service = new ResourceDeletionService(db, owner);
    expect(await service.preview('task', ['rd-task'])).toMatchObject({
      deleteCounts: { tasks: 1, topics: 1 },
      retainedCounts: { topics: 1 },
    });
    await service.delete('task', ['rd-task']);
    expect(await db.select().from(tasks).where(eq(tasks.id, 'rd-task'))).toHaveLength(0);
    expect(await db.select().from(messages).where(eq(messages.id, 'rd-message'))).toHaveLength(0);
    expect(
      await db.select().from(acceptances).where(eq(acceptances.id, acceptance.id)),
    ).toHaveLength(0);
    expect(await db.select().from(verifyRuns).where(eq(verifyRuns.id, run.id))).toHaveLength(0);
    expect(await db.select().from(topics).where(eq(topics.id, 'rd-shared'))).toHaveLength(1);
  });

  it('plans a union once and includes tasks only exclusive to selected goals', async () => {
    await makeTask('rd-goal-task');
    await db.insert(goals).values(
      ['rd-goal-a', 'rd-goal-b'].map((id) => ({
        id,
        userId: owner,
        title: id,
        config: { groupId: group },
      })),
    );
    await db
      .insert(goalNodes)
      .values({ goalId: 'rd-goal-a', taskId: 'rd-goal-task', title: 'shared', kind: 'task' });
    await db
      .update(goals)
      .set({ subjectType: 'task', subjectId: 'rd-goal-task' })
      .where(eq(goals.id, 'rd-goal-b'));
    const service = new ResourceDeletionService(db, owner);
    expect(await service.preview('goal', ['rd-goal-a'])).toMatchObject({
      deleteCounts: { goals: 1, tasks: 0 },
      retainedCounts: { tasks: 1 },
    });
    expect(await service.preview('goal', ['rd-goal-a', 'rd-goal-b', 'rd-goal-a'])).toMatchObject({
      deleteCounts: { goals: 2, tasks: 1 },
    });
  });

  it('recomputes exclusivity after preview instead of trusting old counts', async () => {
    await makeTask('rd-race-task');
    await makeTask('rd-race-other');
    await makeTopic('rd-race-topic');
    await link('rd-race-task', 'rd-race-topic');
    const service = new ResourceDeletionService(db, owner);
    expect(await service.preview('task', ['rd-race-task'])).toMatchObject({
      deleteCounts: { topics: 1 },
    });
    await link('rd-race-other', 'rd-race-topic');
    expect(await service.delete('task', ['rd-race-task'])).toMatchObject({
      deleteCounts: { topics: 0 },
      retainedCounts: { topics: 1 },
    });
    expect(await db.select().from(topics).where(eq(topics.id, 'rd-race-topic'))).toHaveLength(1);
  });

  it('rejects a changed confirmed snapshot without deleting even the root', async () => {
    await makeTask('rd-confirmed-task');
    await makeTopic('rd-confirmed-topic');
    const service = new ResourceDeletionService(db, owner);
    const preview = await service.preview('task', ['rd-confirmed-task']);
    await link('rd-confirmed-task', 'rd-confirmed-topic');
    await expect(
      service.delete('task', ['rd-confirmed-task'], preview.snapshot),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await db.select().from(tasks).where(eq(tasks.id, 'rd-confirmed-task'))).toHaveLength(1);
    expect(await db.select().from(topics).where(eq(topics.id, 'rd-confirmed-topic'))).toHaveLength(
      1,
    );
  });

  it('never touches storage when the database transaction fails at commit', async () => {
    await makeTask('rd-commit-task');
    await makeTopic('rd-commit-topic');
    await link('rd-commit-task', 'rd-commit-topic');
    await db.insert(messages).values({
      id: 'rd-commit-message',
      userId: owner,
      topicId: 'rd-commit-topic',
      role: 'assistant',
    });
    await db.insert(globalFiles).values({
      hashId: 'rd-commit-hash',
      creator: owner,
      fileType: 'text/plain',
      size: 1,
      url: 'rd-commit-key',
    });
    await db.insert(files).values({
      id: 'rd-commit-file',
      userId: owner,
      fileHash: 'rd-commit-hash',
      fileType: 'text/plain',
      size: 1,
      name: 'fixture',
      url: 'rd-commit-key',
    });
    await db
      .insert(messagesFiles)
      .values({ messageId: 'rd-commit-message', fileId: 'rd-commit-file', userId: owner });
    storage.deleteFiles.mockClear();
    const failingDB = new Proxy(db, {
      get(target, prop) {
        if (prop === 'transaction')
          return async (callback: Parameters<LobeChatDatabase['transaction']>[0]) =>
            target.transaction(async (tx) => {
              await callback(tx);
              throw new Error('simulated commit conflict');
            });
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(
      new ResourceDeletionService(failingDB, owner).delete('task', ['rd-commit-task']),
    ).rejects.toThrow('simulated commit conflict');
    expect(storage.deleteFiles).not.toHaveBeenCalled();
    expect(await db.select().from(tasks).where(eq(tasks.id, 'rd-commit-task'))).toHaveLength(1);
    expect(await db.select().from(files).where(eq(files.id, 'rd-commit-file'))).toHaveLength(1);
    expect(
      await db
        .select()
        .from(asyncTasks)
        .where(
          and(
            eq(asyncTasks.userId, owner),
            sql`${asyncTasks.metadata} @> ${JSON.stringify({ objects: [{ key: 'rd-commit-key' }] })}::jsonb`,
          ),
        ),
    ).toHaveLength(0);
    await db.delete(files).where(eq(files.id, 'rd-commit-file'));
    await db.delete(globalFiles).where(eq(globalFiles.hashId, 'rd-commit-hash'));
  });

  it('keeps the entire transaction when an uninterruptible runtime remains', async () => {
    await makeTask('rd-running', { status: 'running' });
    await makeTopic('rd-running-topic');
    await link('rd-running', 'rd-running-topic');
    await db.insert(agentOperations).values({
      id: 'rd-operation',
      userId: owner,
      taskId: 'rd-running',
      topicId: 'rd-running-topic',
      status: 'running',
    });
    await expect(
      new ResourceDeletionService(db, owner).delete('task', ['rd-running']),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(await db.select().from(tasks).where(eq(tasks.id, 'rd-running'))).toMatchObject([
      { status: 'running' },
    ]);
    expect(await db.select().from(topics).where(eq(topics.id, 'rd-running-topic'))).toHaveLength(1);
    await db.delete(agentOperations).where(eq(agentOperations.id, 'rd-operation'));
  });

  it('deletes exclusive documents, works and evidence files but preserves KB and other-task references', async () => {
    await makeTask('rd-artifacts');
    await makeTask('rd-artifacts-other');
    await makeTopic('rd-artifacts-topic');
    await link('rd-artifacts', 'rd-artifacts-topic');
    await db.insert(messages).values({
      id: 'rd-artifacts-message',
      userId: owner,
      topicId: 'rd-artifacts-topic',
      role: 'assistant',
    });
    await db.insert(globalFiles).values(
      ['rd-file-own', 'rd-file-kb', 'rd-file-evidence'].map((id) => ({
        hashId: id,
        creator: owner,
        fileType: 'text/plain',
        size: 1,
        url: id,
      })),
    );
    await db.insert(files).values(
      ['rd-file-own', 'rd-file-kb', 'rd-file-evidence'].map((id) => ({
        id,
        userId: owner,
        name: id,
        fileType: 'text/plain',
        size: 1,
        url: id,
        fileHash: id,
      })),
    );
    await db.insert(messagesFiles).values(
      ['rd-file-own', 'rd-file-kb'].map((fileId) => ({
        fileId,
        messageId: 'rd-artifacts-message',
        userId: owner,
      })),
    );
    await db.insert(knowledgeBases).values({ id: 'rd-kb', userId: owner, name: 'keep' });
    await db
      .insert(knowledgeBaseFiles)
      .values({ knowledgeBaseId: 'rd-kb', fileId: 'rd-file-kb', userId: owner });
    await db.insert(documents).values(
      ['rd-doc-own', 'rd-doc-shared'].map((id) => ({
        id,
        userId: owner,
        fileType: 'text/plain',
        totalCharCount: 1,
        totalLineCount: 1,
        sourceType: 'agent' as const,
        source: 'fixture',
      })),
    );
    await db.insert(documents).values(
      ['rd-file-own', 'rd-file-kb'].map((fileId) => ({
        id: `${fileId}-mirror`,
        userId: owner,
        fileType: 'text/plain',
        sourceType: 'file' as const,
        source: fileId,
        fileId,
        totalCharCount: 1,
        totalLineCount: 1,
      })),
    );
    await db.insert(taskDocuments).values([
      { taskId: 'rd-artifacts', documentId: 'rd-doc-own', userId: owner },
      { taskId: 'rd-artifacts', documentId: 'rd-doc-shared', userId: owner },
      { taskId: 'rd-artifacts-other', documentId: 'rd-doc-shared', userId: owner },
    ]);
    await db.insert(works).values({
      id: 'rd-work',
      userId: owner,
      type: 'document',
      resourceType: 'document',
      resourceId: 'rd-doc-own',
      originTopicId: 'rd-artifacts-topic',
      visibility: 'private',
      toolName: 'fixture',
      toolIdentifier: 'fixture',
    });
    await db.insert(workVersions).values({
      workId: 'rd-work',
      version: 1,
      changeType: 'created',
      toolName: 'fixture',
      toolIdentifier: 'fixture',
      topicId: 'rd-artifacts-topic',
    });
    const [acceptance] = await db
      .insert(acceptances)
      .values({ userId: owner, subjectType: 'task', subjectId: 'rd-artifacts' })
      .returning();
    const [run] = await db
      .insert(verifyRuns)
      .values({ userId: owner, acceptanceId: acceptance.id, roundIndex: 1 })
      .returning();
    const [result] = await db
      .insert(verifyCheckResults)
      .values({ verifyRunId: run.id, userId: owner, checkItemId: 'C1', verifierType: 'agent' })
      .returning();
    await db.insert(verifyEvidence).values({
      checkResultId: result.id,
      userId: owner,
      type: 'text',
      fileId: 'rd-file-evidence',
    });
    const service = new ResourceDeletionService(db, owner);
    expect(await service.preview('task', ['rd-artifacts'])).toMatchObject({
      deleteCounts: { files: 2 },
      retainedCounts: { files: 1 },
    });
    await service.delete('task', ['rd-artifacts']);
    expect(await db.select().from(documents).where(eq(documents.id, 'rd-doc-own'))).toHaveLength(0);
    expect(await db.select().from(works).where(eq(works.id, 'rd-work'))).toHaveLength(0);
    expect(
      await db.select().from(verifyEvidence).where(eq(verifyEvidence.checkResultId, result.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(files)
        .where(inArray(files.id, ['rd-file-own', 'rd-file-evidence'])),
    ).toHaveLength(0);
    expect(await db.select().from(files).where(eq(files.id, 'rd-file-kb'))).toHaveLength(1);
    expect(
      await db.select().from(documents).where(eq(documents.id, 'rd-file-own-mirror')),
    ).toHaveLength(0);
    expect(
      await db.select().from(documents).where(eq(documents.id, 'rd-file-kb-mirror')),
    ).toHaveLength(1);
    expect(await db.select().from(documents).where(eq(documents.id, 'rd-doc-shared'))).toHaveLength(
      1,
    );
  });

  it('cascades project goals and tasks, retaining resources from another group', async () => {
    await db.insert(agents).values({ id: 'rd-coordinator', userId: owner });
    await db.insert(projects).values({
      id: 'rd-project',
      userId: owner,
      name: 'delete project',
      identifier: 'RD-P',
      coordinatorAgentId: 'rd-coordinator',
    });
    await db.insert(projectChatGroups).values({ projectId: 'rd-project', chatGroupId: group });
    await db.insert(chatGroups).values({ id: 'rd-other-group', userId: owner });
    await makeTask('rd-project-task', { projectId: 'rd-project' });
    await makeTask('rd-project-retain', {
      projectId: 'rd-project',
      config: { groupId: 'rd-other-group' },
    });
    await db.insert(goals).values({
      id: 'rd-project-goal',
      userId: owner,
      title: 'fixture',
      projectId: 'rd-project',
      config: { groupId: group },
    });
    await makeTopic('rd-project-topic');
    await link('rd-project-task', 'rd-project-topic');
    const service = new ResourceDeletionService(db, owner);
    expect(await service.preview('project', ['rd-project'])).toMatchObject({
      deleteCounts: { goals: 1, tasks: 1, topics: 1 },
      retainedCounts: { tasks: 1 },
    });
    const deleted = await service.delete('project', ['rd-project']);
    expect(deleted.deletedIds.projects).toEqual(['rd-project']);
    expect(await db.select().from(projects).where(eq(projects.id, 'rd-project'))).toHaveLength(0);
    expect(await db.select().from(goals).where(eq(goals.id, 'rd-project-goal'))).toHaveLength(0);
    expect(await db.select().from(tasks).where(eq(tasks.id, 'rd-project-task'))).toHaveLength(0);
    expect(await db.select().from(tasks).where(eq(tasks.id, 'rd-project-retain'))).toMatchObject([
      { projectId: null },
    ]);
    expect(await db.select().from(chatGroups).where(eq(chatGroups.id, group))).toHaveLength(1);
  }, 30000);
});
