// @vitest-environment node
// Opt-in only: the harness must supply a disposable PostgreSQL database.
import { createHash, randomUUID } from 'node:crypto';

import {
  DeleteObjectsCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { LobeChatDatabase } from '@lobechat/database';
import {
  agents,
  chatGroups,
  files,
  globalFiles,
  goalNodes,
  goals,
  messages,
  messagesFiles,
  projectChatGroups,
  projects,
  tasks,
  taskTopics,
  topics,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { FileModel } from '@/database/models/file';
import { S3 } from '@/server/modules/S3';

import { resourceDeletionRouter } from '../../resourceDeletion';
import { topicRouter } from '../../topic';
import { createTestContext, createTestUser } from './setup';

let db: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => db }));
const enabled = process.env.RUN_PHYSICAL_DELETE_TEST === '1';
const prefix = `codex-delete-test/${randomUUID()}/`;
const keys: string[] = [];
let storage: S3Client;
let owner: string;
let groupId: string;
const bucket = process.env.S3_BUCKET!;
async function exists(key: string) {
  try {
    await storage.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error: any) {
    if (error.$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
}
async function fixture(label: string) {
  const id = randomUUID();
  const key = prefix + label;
  keys.push(key);
  const body = randomUUID();
  const hash = createHash('sha256').update(body).digest('hex');
  await storage.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
  await db
    .insert(globalFiles)
    .values({ hashId: hash, creator: owner, fileType: 'text/plain', size: body.length, url: key });
  await db.insert(files).values({
    id,
    userId: owner,
    fileHash: hash,
    fileType: 'text/plain',
    size: body.length,
    url: key,
    name: label,
  });
  await db.insert(topics).values({ id, userId: owner, groupId });
  await db
    .insert(messages)
    .values({ id, userId: owner, topicId: id, groupId, role: 'user', content: 'isolated fixture' });
  await db.insert(messagesFiles).values({ fileId: id, messageId: id, userId: owner });
  expect(await exists(key)).toBe(true);
  return { id, key, hash };
}
describe.skipIf(!enabled)('real PostgreSQL and S3 permanent deletion', () => {
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_TEST_URL!).pathname.startsWith('/codex_delete_'))
      throw new Error('Disposable database required');
    await import('@/server/services/goal');
    db = await getTestDB();
    owner = await createTestUser(db);
    groupId = randomUUID();
    await db.insert(chatGroups).values({ id: groupId, userId: owner });
    storage = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_ENABLE_PATH_STYLE === '1',
      region: process.env.S3_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
    });
  }, 60000);
  afterAll(async () => {
    if (keys.length && storage) {
      const result = await storage.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        }),
      );
      expect(result.Errors ?? []).toHaveLength(0);
      for (const key of keys) expect(await exists(key)).toBe(false);
    }
    storage?.destroy();
  });
  it('hard deletes the conversation, attachment rows and physical object', async () => {
    const f = await fixture('exclusive');
    await topicRouter
      .createCaller(createTestContext(owner))
      .removeTopic({ id: f.id, removeFiles: true });
    for (const table of [topics, messages, files])
      expect(await db.select().from(table).where(eq(table.id, f.id))).toHaveLength(0);
    expect(
      await db.select().from(messagesFiles).where(eq(messagesFiles.fileId, f.id)),
    ).toHaveLength(0);
    expect(await db.select().from(globalFiles).where(eq(globalFiles.hashId, f.hash))).toHaveLength(
      0,
    );
    expect(await exists(f.key)).toBe(false);
  });
  it.each(['task', 'goal', 'project'] as const)(
    'deletes exclusive %s descendants and actual storage objects with matching preview counts',
    async (resource) => {
      const f = await fixture(`cascade-${resource}`);
      const taskId = `task_${randomUUID()}`;
      const goalId = `goal_${randomUUID()}`;
      const projectId = `project_${randomUUID()}`;
      if (resource === 'project') {
        const agentId = `agt_${randomUUID()}`;
        await db.insert(agents).values({ id: agentId, userId: owner });
        await db.insert(projects).values({
          id: projectId,
          userId: owner,
          name: 'Disposable project',
          identifier: 'CASC',
          coordinatorAgentId: agentId,
        });
        await db.insert(projectChatGroups).values({ projectId, chatGroupId: groupId });
      }
      await db.insert(tasks).values({
        id: taskId,
        createdByUserId: owner,
        identifier: taskId,
        seq: 1,
        instruction: 'Disposable task',
        config: { groupId },
        projectId: resource === 'project' ? projectId : null,
      });
      await db
        .insert(taskTopics)
        .values({ taskId, topicId: f.id, userId: owner, seq: 1, status: 'completed' });
      if (resource !== 'task') {
        await db.insert(goals).values({
          id: goalId,
          userId: owner,
          title: 'Disposable goal',
          config: { groupId },
          projectId: resource === 'project' ? projectId : null,
        });
        await db
          .insert(goalNodes)
          .values({ goalId, taskId, kind: 'task', title: 'Disposable node' });
      }
      const id = resource === 'task' ? taskId : resource === 'goal' ? goalId : projectId;
      const context = createTestContext(owner);
      const preview = await resourceDeletionRouter
        .createCaller(context)
        .preview({ resource, ids: [id] });
      expect(preview.deleteCounts).toMatchObject({
        goals: resource === 'task' ? 0 : 1,
        tasks: 1,
        topics: 1,
        files: 1,
      });
      await resourceDeletionRouter
        .createCaller(context)
        .delete({ resource, ids: [id], snapshot: preview.snapshot });
      expect(await db.select().from(tasks).where(eq(tasks.id, taskId))).toHaveLength(0);
      expect(await db.select().from(taskTopics).where(eq(taskTopics.taskId, taskId))).toHaveLength(
        0,
      );
      if (resource !== 'task')
        expect(await db.select().from(goals).where(eq(goals.id, goalId))).toHaveLength(0);
      if (resource === 'project')
        expect(await db.select().from(projects).where(eq(projects.id, projectId))).toHaveLength(0);
      expect(await db.select().from(topics).where(eq(topics.id, f.id))).toHaveLength(0);
      expect(await db.select().from(files).where(eq(files.id, f.id))).toHaveLength(0);
      expect(
        await db.select().from(globalFiles).where(eq(globalFiles.hashId, f.hash)),
      ).toHaveLength(0);
      expect(await exists(f.key)).toBe(false);
    },
  );
  it('preserves an attachment still referenced by another topic', async () => {
    const f = await fixture('shared');
    const other = randomUUID();
    await db.insert(topics).values({ id: other, userId: owner, groupId });
    await db
      .insert(messages)
      .values({ id: other, userId: owner, topicId: other, groupId, role: 'user' });
    await db.insert(messagesFiles).values({ fileId: f.id, messageId: other, userId: owner });
    const api = topicRouter.createCaller(createTestContext(owner));
    await api.removeTopic({ id: f.id, removeFiles: true });
    expect(await exists(f.key)).toBe(true);
    expect(await db.select().from(files).where(eq(files.id, f.id))).toHaveLength(1);
    await api.removeTopic({ id: other, removeFiles: true });
    expect(await exists(f.key)).toBe(false);
  });
  it('preserves a physical object referenced by another user file record', async () => {
    const f = await fixture('shared-hash');
    const otherUser = await createTestUser(db);
    const otherId = randomUUID();
    await db.insert(files).values({
      id: otherId,
      userId: otherUser,
      fileHash: f.hash,
      fileType: 'text/plain',
      size: 36,
      url: f.key,
      name: 'shared-copy',
    });
    await topicRouter
      .createCaller(createTestContext(owner))
      .removeTopic({ id: f.id, removeFiles: true });
    expect(await db.select().from(files).where(eq(files.id, f.id))).toHaveLength(0);
    expect(await db.select().from(files).where(eq(files.id, otherId))).toHaveLength(1);
    expect(await db.select().from(globalFiles).where(eq(globalFiles.hashId, f.hash))).toHaveLength(
      1,
    );
    expect(await exists(f.key)).toBe(true);
  });

  it('persists pending cleanup on storage failure and retries after database commit', async () => {
    const f = await fixture('retry');
    const failure = vi
      .spyOn(S3.prototype, 'deleteFiles')
      .mockRejectedValueOnce(new Error('injected storage outage'));
    let cleanup: { jobId: string; status: string } | undefined;
    try {
      const result = await topicRouter
        .createCaller(createTestContext(owner))
        .removeTopic({ id: f.id, removeFiles: true });
      expect(result).toHaveProperty('storageCleanup');
      if (!('storageCleanup' in result)) throw new Error('Expected cleanup result');
      cleanup = result.storageCleanup;
    } finally {
      failure.mockRestore();
    }
    expect(cleanup?.status).toBe('pending');
    expect(await db.select().from(topics).where(eq(topics.id, f.id))).toHaveLength(0);
    expect(await db.select().from(files).where(eq(files.id, f.id))).toHaveLength(0);
    expect(await exists(f.key)).toBe(true);
    const retried = await resourceDeletionRouter
      .createCaller(createTestContext(owner))
      .retryCleanup({ jobId: cleanup!.jobId });
    expect(retried.storageCleanup.status).toBe('completed');
    expect(await exists(f.key)).toBe(false);
  });
  it('serializes storage cleanup against concurrent registration of the retired key', async () => {
    const f = await fixture('concurrent');
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = S3.prototype.deleteFiles;
    const delayed = vi.spyOn(S3.prototype, 'deleteFiles').mockImplementation(async function (
      this: S3,
      keys,
      signal,
    ) {
      started();
      await gate;
      return original.call(this, keys, signal);
    });
    const deletion = topicRouter
      .createCaller(createTestContext(owner))
      .removeTopic({ id: f.id, removeFiles: true });
    let registration: Promise<unknown> | undefined;
    try {
      await entered;
      registration = new FileModel(db, owner)
        .create({
          fileHash: f.hash,
          fileType: 'text/plain',
          size: 36,
          url: f.key,
          name: 'concurrent old address',
        })
        .then(
          () => 'unexpected success',
          (error: Error) => error.message,
        );
      await vi.waitFor(
        async () => {
          const blocked = await db.execute(
            sql`select count(*)::int as count from pg_stat_activity where datname=current_database() and wait_event_type='Lock'`,
          );
          expect(blocked.rows[0].count).toBeGreaterThan(0);
        },
        { timeout: 2000 },
      );
      release();
      const result = await deletion;
      expect(result).toHaveProperty('storageCleanup');
      if (!('storageCleanup' in result)) throw new Error('Expected cleanup result');
      expect(result.storageCleanup?.status).toBe('completed');
      expect(await registration).toContain('重新上传');
      expect(await db.select().from(files).where(eq(files.url, f.key))).toHaveLength(0);
      expect(await exists(f.key)).toBe(false);
    } finally {
      release();
      await deletion;
      await registration;
      delayed.mockRestore();
    }
  });
});
