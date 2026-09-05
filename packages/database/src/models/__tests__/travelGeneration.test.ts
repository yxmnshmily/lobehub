// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { chatGroups, travelGenerationTasks, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TravelGenerationTaskModel } from '../travelGeneration';

const db: LobeChatDatabase = await getTestDB();
const userA = 'travel-generation-user-a';
const userB = 'travel-generation-user-b';
const workspaceA = 'travel-generation-workspace-a';

beforeEach(async () => {
  await db.delete(users).where(eq(users.id, userA));
  await db.delete(users).where(eq(users.id, userB));
  await db.insert(users).values([{ id: userA }, { id: userB }]);
  await db.insert(workspaces).values({
    id: workspaceA,
    name: 'Travel generation workspace',
    primaryOwnerId: userA,
    slug: workspaceA,
  });
  await db.insert(chatGroups).values([
    { id: 'travel-group-a', userId: userA, visibility: 'private' },
    { id: 'travel-group-a-second', userId: userA, visibility: 'private' },
    { id: 'travel-group-b', userId: userB, visibility: 'private' },
    {
      id: 'travel-group-workspace-a',
      userId: userA,
      visibility: 'private',
      workspaceId: workspaceA,
    },
  ]);
});

afterEach(async () => {
  await db.delete(users).where(eq(users.id, userA));
  await db.delete(users).where(eq(users.id, userB));
});

describe('TravelGenerationTaskModel', () => {
  it('finds and updates only tasks owned by the authenticated customer', async () => {
    const modelA = new TravelGenerationTaskModel(db, userA);
    const modelB = new TravelGenerationTaskModel(db, userB);
    const taskA = await modelA.create({
      groupId: 'travel-group-a',
      input: { prompt: '用户 A 的旅游封面' },
      status: 'pending',
      type: 'image',
    });
    const taskB = await modelB.create({
      groupId: 'travel-group-b',
      input: { prompt: '用户 B 的旅游封面' },
      status: 'pending',
      type: 'image',
    });

    await expect(modelA.findById(taskA.id)).resolves.toMatchObject({ userId: userA });
    await expect(modelA.findById(taskB.id)).resolves.toBeUndefined();

    await modelA.update(taskB.id, { status: 'failed' });
    const [unchanged] = await db
      .select({ status: travelGenerationTasks.status })
      .from(travelGenerationTasks)
      .where(eq(travelGenerationTasks.id, taskB.id));
    expect(unchanged.status).toBe('pending');
  });

  it('atomically creates one task when two model instances race on the same idempotency key', async () => {
    const firstProcess = new TravelGenerationTaskModel(db, userA);
    const secondProcess = new TravelGenerationTaskModel(db, userA);
    const value = {
      groupId: 'travel-group-a',
      idempotencyKey: 'derived-operation-tool-copy',
      input: { prompt: '写一篇桂林旅游文案' },
      requestHash: 'request-hash-a',
      status: 'queued',
      type: 'copy',
    };

    const [first, second] = await Promise.all([
      firstProcess.createOrFindByIdempotency(value),
      secondProcess.createOrFindByIdempotency(value),
    ]);

    expect(first.record.id).toBe(second.record.id);
    expect([first.created, second.created].sort()).toEqual([false, true]);
    expect(
      await db
        .select({ id: travelGenerationTasks.id })
        .from(travelGenerationTasks)
        .where(eq(travelGenerationTasks.idempotencyKey, value.idempotencyKey)),
    ).toHaveLength(1);
  });

  it('returns a stable conflict when the same key is reused for different request content', async () => {
    const model = new TravelGenerationTaskModel(db, userA);
    const value = {
      groupId: 'travel-group-a',
      idempotencyKey: 'derived-operation-tool-image',
      input: { prompt: '雪山日出' },
      requestHash: 'request-hash-image-a',
      status: 'queued',
      type: 'image',
    };

    await model.createOrFindByIdempotency(value);

    await expect(
      model.createOrFindByIdempotency({
        ...value,
        input: { prompt: '海岛日落' },
        requestHash: 'request-hash-image-b',
      }),
    ).rejects.toMatchObject({ code: 'TRAVEL_GENERATION_IDEMPOTENCY_CONFLICT' });
  });

  it('isolates identical keys by user, workspace, group, and generation type', async () => {
    const personalA = new TravelGenerationTaskModel(db, userA);
    const personalB = new TravelGenerationTaskModel(db, userB);
    const workspaceModel = new TravelGenerationTaskModel(db, userA, workspaceA);
    const common = {
      idempotencyKey: 'same-derived-key',
      input: { prompt: '同一个请求' },
      requestHash: 'same-request-hash',
      status: 'queued',
    };

    const results = await Promise.all([
      personalA.createOrFindByIdempotency({ ...common, groupId: 'travel-group-a', type: 'copy' }),
      personalA.createOrFindByIdempotency({ ...common, groupId: 'travel-group-a', type: 'image' }),
      personalA.createOrFindByIdempotency({
        ...common,
        groupId: 'travel-group-a-second',
        type: 'copy',
      }),
      personalB.createOrFindByIdempotency({ ...common, groupId: 'travel-group-b', type: 'copy' }),
      workspaceModel.createOrFindByIdempotency({
        ...common,
        groupId: 'travel-group-workspace-a',
        type: 'copy',
      }),
    ]);

    expect(new Set(results.map(({ record }) => record.id)).size).toBe(5);
    expect(results.every(({ created }) => created)).toBe(true);
  });
});
