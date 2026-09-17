import type { LobeChatDatabase } from '@lobechat/database';
import { TRPCError } from '@trpc/server';
import { sql } from 'drizzle-orm';

import { serverDBEnv } from '@/config/db';
import { FileModel } from '@/database/models/file';

import { FileDeletionCleanup, stageFileCleanup } from './cleanup';
import {
  DeletionPlanner,
  member,
  type Plan,
  type Preview,
  type Resource,
  rows,
  snapshotForPlan,
} from './planner';

export { FileDeletionCleanup, stageFileCleanup } from './cleanup';
export type { Preview, Resource } from './planner';

export class ResourceDeletionService {
  constructor(
    private db: LobeChatDatabase,
    private userId: string,
    private workspaceId?: string,
    private workspaceRole?: string,
  ) {}

  private planner(db = this.db) {
    return new DeletionPlanner(db, this.userId, this.workspaceId, this.workspaceRole);
  }

  async preview(resource: Resource, ids: string[]): Promise<Preview> {
    const plan = await this.planner().plan(resource, ids);
    return {
      deleteCounts: plan.deleteCounts,
      retainedCounts: plan.retainedCounts,
      snapshot: snapshotForPlan(plan),
    };
  }

  async delete(resource: Resource, ids: string[], expectedSnapshot?: string) {
    const committed = await this.db.transaction(
      async (tx) => {
        const db = tx as LobeChatDatabase;
        let plan = await this.planner(db).plan(resource, ids);
        // Lock actual resource rows, not client counts. FK references cannot be inserted
        // against these rows until commit; serializable also protects soft graph reads.
        for (const table of [
          'projects',
          'goals',
          'tasks',
          'topics',
          'documents',
          'files',
          'works',
        ] as const) {
          await db.execute(
            sql`select id from ${sql.identifier(table)} where ${member('id', plan[table])} order by id for update`,
          );
        }
        plan = await this.planner(db).plan(resource, ids);
        if (expectedSnapshot && snapshotForPlan(plan) !== expectedSnapshot)
          throw new TRPCError({
            code: 'CONFLICT',
            message: '关联内容已经变化，请重新确认删除范围',
          });
        await this.stopTasks(db, plan);
        const coordinatorRows = await rows<{ coordinator_agent_id: string }>(
          db,
          sql`select coordinator_agent_id from projects where ${member('id', plan.projects)}`,
        );
        if (plan.goals.length) {
          const { GoalService } = await import('@/server/services/goal');
          const service = new GoalService(db, this.userId, this.workspaceId);
          for (const id of plan.goals) await service.delete(id, { taskIdsToStop: plan.tasks });
        }
        await db.execute(sql`delete from verify_runs where ${member('id', plan.runs)}`);
        await db.execute(sql`delete from acceptances where ${member('id', plan.acceptances)}`);
        await db.execute(sql`delete from works where ${member('id', plan.works)}`);
        await db.execute(sql`delete from documents where ${member('id', plan.documents)}`);
        await db.execute(sql`delete from topics where ${member('id', plan.topics)}`);
        await db.execute(sql`delete from tasks where ${member('id', plan.tasks)}`);
        await db.execute(sql`delete from projects where ${member('id', plan.projects)}`);
        // A project coordinator can own a retained conversation. Never let its FK
        // cascade secretly delete something excluded from the preview.
        for (const { coordinator_agent_id: agentId } of coordinatorRows) {
          await db.execute(sql`delete from agents where id=${agentId} and user_id=${this.userId}
          and not exists (select 1 from topics where agent_id=${agentId})
          and not exists (select 1 from tasks where assignee_agent_id=${agentId} or created_by_agent_id=${agentId})
          and not exists (select 1 from goals where agent_id=${agentId})
          and not exists (select 1 from project_agents where agent_id=${agentId})
          and not exists (select 1 from projects where coordinator_agent_id=${agentId})`);
        }
        let cleanupJobId: string | undefined;
        if (plan.files.length) {
          const removed = await new FileModel(db, this.userId, this.workspaceId).deleteMany(
            plan.files,
            serverDBEnv.REMOVE_GLOBAL_FILE,
          );
          cleanupJobId = await stageFileCleanup(db, this.userId, this.workspaceId, removed ?? []);
        }
        // The durable cleanup record commits together with the deleted references.
        // No external object is touched until this transaction has committed.
        return {
          cleanupJobId,
          affectedGroupIds: plan.affectedGroupIds,
          deleteCounts: plan.deleteCounts,
          retainedCounts: plan.retainedCounts,
          deletedIds: {
            documents: plan.documents,
            works: plan.works,
            goals: plan.goals,
            tasks: plan.tasks,
            topics: plan.topics,
            files: plan.files,
            projects: plan.projects,
          },
        };
      },
      { isolationLevel: 'serializable' },
    );
    const { cleanupJobId, ...result } = committed;
    return {
      ...result,
      storageCleanup: cleanupJobId ? await this.retryCleanup(cleanupJobId) : undefined,
    };
  }

  retryCleanup(jobId: string) {
    return new FileDeletionCleanup(this.db, this.userId, this.workspaceId).retry(jobId);
  }

  retryPendingCleanup() {
    return new FileDeletionCleanup(this.db, this.userId, this.workspaceId).retryPending();
  }

  private async stopTasks(db: LobeChatDatabase, plan: Plan) {
    // Fence schedule/heartbeat task claims before cancelling existing task topics.
    await db.execute(
      sql`update tasks set status='paused' where ${member('id', plan.tasks)} and status='running'`,
    );
    const running = await rows<{ topic_id: string }>(
      db,
      sql`select distinct topic_id from task_topics where ${member('task_id', plan.tasks)} and ${member('topic_id', plan.topics)} and status='running'`,
    );
    if (running.length) {
      const { TaskService } = await import('@/server/services/task');
      const service = new TaskService(db, this.userId, this.workspaceId);
      for (const row of running) await service.cancelTopic(row.topic_id);
    }
    // A shared or non-task runtime must not be silently orphaned. The existing
    // stop workflow can be retried before deleting when interruption isn't possible.
    const active = await rows(
      db,
      sql`select id from agent_operations where (${member('task_id', plan.tasks)} or ${member('topic_id', plan.topics)}) and status in ('running','waiting_for_async_tool','waiting_for_human') limit 1`,
    );
    if (active.length)
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: '仍有运行中的对话，请先停止后再删除',
      });
  }
}
