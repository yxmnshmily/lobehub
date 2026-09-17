import { randomUUID } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import { TRPCError } from '@trpc/server';
import { sql } from 'drizzle-orm';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { FileService } from '@/server/services/file';

import { member, rows } from './planner';

const TYPE = 'resource-file-deletion';
type ObjectRef = { key: string; hash?: string | null };
type Metadata = { objects: ObjectRef[]; attempts: number; lease?: string };
type Job = {
  id: string;
  metadata: Metadata;
  status: string;
  user_id: string;
  workspace_id: string | null;
  updated_at: string | Date;
};
export type CleanupResult = { jobId: string; status: 'completed' | 'pending' };

/** Durable outbox on the existing async_tasks table; never performs S3 I/O in the source transaction. */
export class FileDeletionCleanup {
  constructor(
    private db: LobeChatDatabase,
    private userId: string,
    private workspaceId?: string,
  ) {}

  async enqueue(objects: ObjectRef[]): Promise<string> {
    return new AsyncTaskModel(this.db, this.userId, this.workspaceId).create({
      type: TYPE,
      status: 'pending',
      metadata: {
        objects: [...new Map(objects.map((object) => [object.key, object])).values()],
        attempts: 0,
      },
    });
  }

  async retry(jobId: string): Promise<CleanupResult> {
    const lease = randomUUID();
    const claimed = await this.db.transaction(async (tx) => {
      const db = tx as LobeChatDatabase;
      const [job] = await rows<Job>(
        db,
        sql`select * from async_tasks where id::text=${jobId} and type=${TYPE} for update`,
      );
      if (
        !job ||
        job.user_id !== this.userId ||
        (job.workspace_id ?? null) !== (this.workspaceId ?? null)
      )
        throw new TRPCError({ code: 'FORBIDDEN', message: '没有权限重试此文件清理' });
      if (job.status === 'success') return { done: true as const };
      // A crashed worker's lease becomes reclaimable; repeated button clicks do not run it twice.
      if (job.status === 'processing' && Date.now() - new Date(job.updated_at).getTime() < 300_000)
        return { busy: true as const };
      const metadata: Metadata = {
        ...job.metadata,
        attempts: (job.metadata.attempts ?? 0) + 1,
        lease,
      };
      await db.execute(
        sql`update async_tasks set status='processing', metadata=${JSON.stringify(metadata)}::jsonb, updated_at=now() where id::text=${jobId}`,
      );
      return { metadata };
    });
    if ('done' in claimed) return { jobId, status: 'completed' };
    if ('busy' in claimed) return { jobId, status: 'pending' };
    try {
      await this.db.transaction(async (tx) => {
        const db = tx as LobeChatDatabase;
        await db.execute(sql`set local lock_timeout = '5s'`);
        await db.execute(
          sql`lock table files, global_files, file_uploads in share row exclusive mode`,
        );
        const objects = claimed.metadata.objects;
        const uploads = await rows(
          db,
          sql`select id from file_uploads where status in ('active', 'cleaning') and ${member(
            'pathname',
            objects.map((object) => object.key),
          )} limit 1`,
        );
        if (uploads.length) throw new Error('文件仍有上传登记，稍后重试清理');
        // A fresh upload may have reused a hash/key after the original delete committed.
        // Such a live object is retained; its newly created references take precedence.
        const live = await rows<{ url: string; hash: string | null }>(
          db,
          sql`select url, file_hash as hash from files where ${member(
            'url',
            objects.map((object) => object.key),
          )} or ${member(
            'file_hash',
            objects.flatMap((object) => (object.hash ? [object.hash] : [])),
          )} union all select url, hash_id as hash from global_files where ${member(
            'url',
            objects.map((object) => object.key),
          )} or ${member(
            'hash_id',
            objects.flatMap((object) => (object.hash ? [object.hash] : [])),
          )}`,
        );
        const remaining = objects.filter(
          (object) =>
            !live.some(
              (ref) => ref.url === object.key || (object.hash && ref.hash === object.hash),
            ),
        );
        if (remaining.length)
          await new FileService(db, this.userId, this.workspaceId).deleteFiles(
            remaining.map((object) => object.key),
            AbortSignal.timeout(30_000),
          );
        await db.execute(
          sql`update async_tasks set status='success', error=null, updated_at=now() where id::text=${jobId} and metadata->>'lease'=${lease}`,
        );
      });
      return { jobId, status: 'completed' };
    } catch (error) {
      // Keep the original complete key set: batch delete may have succeeded only
      // partly, and deleting an already absent object is safe on retry.
      await this.db.execute(
        sql`update async_tasks set status='pending', error=${JSON.stringify({ message: error instanceof Error ? error.message : '文件清理失败' })}::jsonb, updated_at=now() where id::text=${jobId} and metadata->>'lease'=${lease}`,
      );
      return { jobId, status: 'pending' };
    }
  }

  async retryPending(): Promise<CleanupResult[]> {
    const scope = this.workspaceId
      ? sql`workspace_id=${this.workspaceId}`
      : sql`workspace_id is null`;
    const pending = await rows<{ id: string }>(
      this.db,
      sql`select id from async_tasks where type=${TYPE} and user_id=${this.userId} and ${scope} and (status='pending' or status='error' or (status='processing' and updated_at < now() - interval '5 minutes')) order by created_at limit 50`,
    );
    const results: CleanupResult[] = [];
    for (const job of pending) results.push(await this.retry(job.id));
    return results;
  }
}

export async function stageFileCleanup(
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | undefined,
  removed: { url: string | null; fileHash?: string | null }[],
) {
  const objects = removed.flatMap((file) =>
    file.url ? [{ key: file.url, hash: file.fileHash }] : [],
  );
  return objects.length
    ? new FileDeletionCleanup(db, userId, workspaceId).enqueue(objects)
    : undefined;
}
