// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { asyncTasks, fileUploads, globalFiles, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { FileModel } from '@/database/models/file';

import { FileDeletionCleanup } from './cleanup';

const storage = vi.hoisted(() => ({ deleteFiles: vi.fn() }));
vi.mock('@/server/services/file', () => ({
  FileService: class {
    deleteFiles = storage.deleteFiles;
  },
}));
let db: LobeChatDatabase;
const user = 'rd-cleanup-owner';
describe('durable storage cleanup', () => {
  beforeAll(async () => {
    db = await getTestDB();
    await db.insert(users).values({ id: user });
  });
  afterAll(async () => {
    await db.delete(users).where(eq(users.id, user));
  });
  it('keeps a durable retry after partial storage failure and completes it idempotently', async () => {
    const cleanup = new FileDeletionCleanup(db, user);
    const jobId = await cleanup.enqueue([
      { key: 'rd/key-a', hash: 'hash-a' },
      { key: 'rd/key-b', hash: 'hash-b' },
    ]);
    storage.deleteFiles
      .mockRejectedValueOnce(new Error('one object failed'))
      .mockResolvedValueOnce(undefined);
    expect(await cleanup.retry(jobId)).toEqual({ jobId, status: 'pending' });
    expect(await db.select().from(asyncTasks).where(eq(asyncTasks.id, jobId))).toMatchObject([
      { status: 'pending', metadata: { attempts: 1 } },
    ]);
    expect(await new FileDeletionCleanup(db, user).retry(jobId)).toEqual({
      jobId,
      status: 'completed',
    });
    expect(storage.deleteFiles).toHaveBeenNthCalledWith(
      2,
      ['rd/key-a', 'rd/key-b'],
      expect.any(AbortSignal),
    );
    await cleanup.retry(jobId);
    expect(storage.deleteFiles).toHaveBeenCalledTimes(2);
  });
  it('denies retry to another user', async () => {
    const jobId = await new FileDeletionCleanup(db, user).enqueue([
      { key: 'rd/private', hash: 'hash-private' },
    ]);
    await expect(new FileDeletionCleanup(db, 'not-owner').retry(jobId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('preserves an object referenced again before retry', async () => {
    const cleanup = new FileDeletionCleanup(db, user);
    const jobId = await cleanup.enqueue([{ key: 'rd/reused', hash: 'rd-reused-hash' }]);
    await db.insert(globalFiles).values({
      hashId: 'rd-reused-hash',
      creator: user,
      fileType: 'text/plain',
      size: 1,
      url: 'rd/reused',
    });
    storage.deleteFiles.mockClear();
    expect(await cleanup.retry(jobId)).toEqual({ jobId, status: 'completed' });
    expect(storage.deleteFiles).not.toHaveBeenCalled();
    await db.delete(globalFiles).where(eq(globalFiles.hashId, 'rd-reused-hash'));
  });
  it('defers physical cleanup while an upload reserves the key', async () => {
    const cleanup = new FileDeletionCleanup(db, user);
    const jobId = await cleanup.enqueue([{ key: 'rd/upload-active' }]);
    const [upload] = await db
      .insert(fileUploads)
      .values({
        userId: user,
        pathname: 'rd/upload-active',
        size: 1,
        expiresAt: new Date(Date.now() + 60000),
      })
      .returning();
    storage.deleteFiles.mockClear();
    expect(await cleanup.retry(jobId)).toEqual({ jobId, status: 'pending' });
    expect(storage.deleteFiles).not.toHaveBeenCalled();
    await db.delete(fileUploads).where(eq(fileUploads.id, upload.id));
    expect(await cleanup.retry(jobId)).toEqual({ jobId, status: 'completed' });
  });
  it('rejects retired keys at all three registration entries but permits a fresh key', async () => {
    const cleanup = new FileDeletionCleanup(db, user);
    const jobId = await cleanup.enqueue([{ key: 'rd/retired' }]);
    await cleanup.retry(jobId);
    const model = new FileModel(db, user);
    const file = { fileType: 'text/plain', size: 1, url: 'rd/retired' };
    await expect(model.create({ ...file, name: 'retired' })).rejects.toThrow('重新上传');
    await expect(
      model.createGlobalFile({ ...file, hashId: 'rd-newhash', creator: user }),
    ).rejects.toThrow('重新上传');
    await model.createGlobalFile({ ...file, url: 'rd/fresh', hashId: 'rd-newhash', creator: user });
    await expect(model.updateGlobalFile('rd-newhash', { url: 'rd/retired' })).rejects.toThrow(
      '重新上传',
    );
    expect((await model.checkHash('rd-newhash')).url).toBe('rd/fresh');
    await db.delete(globalFiles).where(eq(globalFiles.hashId, 'rd-newhash'));
  });
});
