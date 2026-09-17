import { createHash } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import { TRPCError } from '@trpc/server';
import { type SQL, sql } from 'drizzle-orm';

export type Resource = 'goal' | 'task' | 'project';
export type Counts = { goals: number; tasks: number; topics: number; files: number };
export type Preview = { deleteCounts: Counts; retainedCounts: Counts; snapshot: string };
type Row = {
  id: string;
  user_id?: string;
  created_by_user_id?: string;
  workspace_id?: string | null;
  group_id?: string | null;
  config?: { groupId?: string };
  project_id?: string | null;
  parent_task_id?: string | null;
  current_topic_id?: string | null;
  sender_id?: string | null;
  visibility?: string | null;
  file_hash?: string | null;
  file_id?: string | null;
  source_type?: string;
  resource_type?: string;
  resource_id?: string | null;
};
export interface Plan extends Omit<Preview, 'snapshot'> {
  acceptances: string[];
  affectedGroupIds: string[];
  documents: string[];
  files: string[];
  goals: string[];
  projects: string[];
  runs: string[];
  tasks: string[];
  topics: string[];
  works: string[];
}

export const snapshotForPlan = (plan: Plan) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        Object.entries(plan)
          .filter(([, value]) => Array.isArray(value))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => [key, [...(value as string[])].sort()]),
      ),
    )
    .digest('hex');

// Identifiers below are service-owned constants. All resource ids remain bind parameters.
export const member = (column: string, ids: Iterable<string>): SQL => {
  const values = [...ids];
  return values.length
    ? sql`${sql.raw(column)}::text in (${sql.join(
        values.map((id) => sql`${id}`),
        sql`,`,
      )})`
    : sql`false`;
};
export async function rows<T = Row>(db: LobeChatDatabase, query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return ('rows' in result ? result.rows : result) as T[];
}
export const unique = (ids: (string | null | undefined)[]) => [
  ...new Set(ids.filter((id): id is string => !!id)),
];

export class DeletionPlanner {
  private groupBoundary?: Set<string>;
  constructor(
    private db: LobeChatDatabase,
    private userId: string,
    private workspaceId?: string,
    private workspaceRole?: string,
  ) {}

  private async allowed(row: Row): Promise<boolean> {
    const creator = row.user_id ?? row.created_by_user_id;
    if ((row.workspace_id ?? null) !== (this.workspaceId ?? null)) return false;
    if (creator !== this.userId && !(this.workspaceId && this.workspaceRole === 'owner'))
      return false;
    if (row.sender_id || (row.visibility === 'private' && creator !== this.userId)) return false;
    const groupId = row.group_id ?? row.config?.groupId;
    if (!groupId) return true;
    if (this.groupBoundary && !this.groupBoundary.has(groupId)) return false;
    const [group] = await rows(
      this.db,
      sql`select id, user_id from chat_groups where id = ${groupId}`,
    );
    return group?.user_id === this.userId;
  }

  private async select(table: string, condition: SQL) {
    return rows(this.db, sql`select * from ${sql.identifier(table)} where ${condition}`);
  }

  async plan(resource: Resource, inputIds: string[]): Promise<Plan> {
    this.groupBoundary = undefined;
    const rootIds = unique(inputIds);
    const table = resource === 'task' ? 'tasks' : resource === 'goal' ? 'goals' : 'projects';
    const roots: Row[] = [];
    for (const id of rootIds) {
      let [row] = await this.select(table, sql`id = ${id}`);
      if (!row && resource === 'task') {
        const scope = this.workspaceId
          ? sql`workspace_id = ${this.workspaceId}`
          : sql`workspace_id is null and created_by_user_id = ${this.userId}`;
        [row] = await this.select('tasks', sql`identifier = ${id} and ${scope}`);
      }
      if (
        !row ||
        !(await this.allowed(row)) ||
        (resource === 'project' && row.user_id !== this.userId)
      )
        throw new TRPCError({ code: 'FORBIDDEN', message: '没有权限删除所选内容' });
      roots.push(row);
    }
    const allowedGroups = new Set(
      roots.flatMap((row) =>
        (row.group_id ?? row.config?.groupId) ? [row.group_id ?? row.config!.groupId!] : [],
      ),
    );
    const projects = resource === 'project' ? unique(roots.map((r) => r.id)) : [];
    if (projects.length) {
      const groups = await rows<{ user_id: string; id: string }>(
        this.db,
        sql`select g.user_id, g.id from project_chat_groups p join chat_groups g on g.id=p.chat_group_id where ${member('p.project_id', projects)}`,
      );
      for (const group of groups) allowedGroups.add(group.id);
      if (groups.some((g) => g.user_id !== this.userId))
        throw new TRPCError({ code: 'FORBIDDEN', message: '只有群主可以删除群内内容' });
    }
    this.groupBoundary = allowedGroups;
    const goalCandidates =
      resource === 'goal' ? roots : await this.select('goals', member('project_id', projects));
    const goalIds: string[] = [];
    for (const row of goalCandidates) if (await this.allowed(row)) goalIds.push(row.id);
    const taskCandidates = new Map<string, Row>();
    for (const row of resource === 'task'
      ? roots
      : await this.select(
          'tasks',
          sql`${member('project_id', projects)} or id in (select task_id from goal_nodes where ${member('goal_id', goalIds)}) or id in (select subject_id from goals where subject_type='task' and ${member('id', goalIds)})`,
        ))
      taskCandidates.set(row.id, row);
    // Parentage is an explicit ownership edge; dependency edges are only references.
    let frontier = [...taskCandidates.keys()];
    while (frontier.length) {
      const children = await this.select('tasks', member('parent_task_id', frontier));
      frontier = children.filter((row) => !taskCandidates.has(row.id)).map((row) => row.id);
      for (const row of children) taskCandidates.set(row.id, row);
    }
    const taskIds = new Set<string>();
    for (const row of taskCandidates.values()) if (await this.allowed(row)) taskIds.add(row.id);
    const explicitTasks = new Set(resource === 'task' ? roots.map((row) => row.id) : []);
    // A retained parent or an external graph/goal/project reference makes a descendant shared.
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of taskIds) {
        if (explicitTasks.has(id)) continue;
        const row = taskCandidates.get(id)!;
        const external = await rows(
          this.db,
          sql`select id::text as id from goal_nodes where task_id=${id} and not (${member('goal_id', goalIds)}) union all select id::text as id from goals where subject_type='task' and subject_id=${id} and not (${member('id', goalIds)}) union all select id::text as id from task_dependencies where depends_on_id=${id} and not (${member('task_id', taskIds)})`,
        );
        if (
          external.length ||
          (row.parent_task_id && !taskIds.has(row.parent_task_id)) ||
          (row.project_id &&
            !projects.includes(row.project_id) &&
            !goalCandidates.some((g) => goalIds.includes(g.id) && g.project_id === row.project_id))
        ) {
          taskIds.delete(id);
          changed = true;
        }
      }
    }
    const topicCandidates = await this.select(
      'topics',
      sql`agent_id in (select coordinator_agent_id from projects where ${member('id', projects)}) or ${member('project_id', projects)} or id in (select topic_id from task_topics where ${member('task_id', taskIds)}) or id in (select current_topic_id from tasks where ${member('id', taskIds)}) or id in (select subject_id from goals where subject_type='topic' and ${member('id', goalIds)})`,
    );
    const topicIds: string[] = [];
    for (const row of topicCandidates) {
      if (!(await this.allowed(row))) continue;
      const refs = await rows(
        this.db,
        sql`select task_id as id from task_topics where topic_id=${row.id} and not (${member('task_id', taskIds)}) union all select id::text as id from tasks where current_topic_id=${row.id} and not (${member('id', taskIds)}) union all select id::text as id from goals where subject_type='topic' and subject_id=${row.id} and not (${member('id', goalIds)})`,
      );
      if (
        !refs.length &&
        (!row.project_id ||
          projects.includes(row.project_id) ||
          [...taskIds].some((id) => taskCandidates.get(id)?.project_id === row.project_id))
      )
        topicIds.push(row.id);
    }
    const acceptanceRows = await this.select(
      'acceptances',
      sql`(subject_type='task' and ${member('subject_id', taskIds)}) or (subject_type='topic' and ${member('subject_id', topicIds)}) or (subject_type='goal' and ${member('subject_id', goalIds)})`,
    );
    const acceptanceIds: string[] = [];
    for (const row of acceptanceRows) if (await this.allowed(row)) acceptanceIds.push(row.id);
    const runRows = await this.select('verify_runs', member('acceptance_id', acceptanceIds));
    const runIds: string[] = [];
    for (const row of runRows) if (await this.allowed(row)) runIds.push(row.id);
    const resultRows = await rows<{ id: string }>(
      this.db,
      sql`select id::text as id from verify_check_results where ${member('verify_run_id', runIds)}`,
    );
    const resultIds = resultRows.map((r) => r.id);

    const attachmentRows = await rows<{ file_id: string }>(
      this.db,
      sql`select f.file_id from messages_files f join messages m on m.id=f.message_id where ${member('m.topic_id', topicIds)} union select file_id from verify_evidence where ${member('check_result_id', resultIds)}`,
    );
    const attachmentIds = unique(attachmentRows.map((row) => row.file_id));
    const documentSeeds = await rows<{ id: string }>(
      this.db,
      sql`select document_id as id from task_documents where ${member('task_id', taskIds)} union select document_id as id from topic_documents where ${member('topic_id', topicIds)} union select document_id as id from verify_evidence where ${member('check_result_id', resultIds)} union select id from documents where source_type='file' and ${member('file_id', attachmentIds)}`,
    );
    const seedIds = unique(documentSeeds.map((row) => row.id));
    const workCandidates = await this.select(
      'works',
      sql`(resource_type='document' and ${member('resource_id', seedIds)}) or (resource_type='file' and ${member('resource_id', attachmentIds)}) or (resource_type='task' and ${member('resource_id', taskIds)}) or ${member('origin_topic_id', topicIds)} or id in (select work_id from project_works where ${member('project_id', projects)}) or id in (select v.work_id from work_versions v join goal_node_work_versions n on n.work_version_id=v.id join goal_nodes g on g.id=n.node_id where ${member('g.goal_id', goalIds)})`,
    );
    const workIds: string[] = [];
    for (const row of workCandidates) {
      if (!(await this.allowed(row))) continue;
      const refs = await rows(
        this.db,
        sql`select project_id as id from project_works where work_id=${row.id} and not (${member('project_id', projects)}) union all select g.goal_id as id from goal_node_work_versions n join work_versions v on v.id=n.work_version_id join goal_nodes g on g.id=n.node_id where v.work_id=${row.id} and not (${member('g.goal_id', goalIds)}) union all select topic_id as id from work_versions where work_id=${row.id} and topic_id is not null and not (${member('topic_id', topicIds)})`,
      );
      if (!refs.length) workIds.push(row.id);
    }
    const docCandidates = await this.select(
      'documents',
      sql`${member('id', seedIds)} or id in (select resource_id from works where resource_type='document' and ${member('id', workIds)})`,
    );
    const documentIds: string[] = [];
    for (const row of docCandidates) {
      if (!(await this.allowed(row))) continue;
      const refs = await rows(
        this.db,
        sql`select document_id as id from task_documents where document_id=${row.id} and not (${member('task_id', taskIds)}) union all select document_id as id from topic_documents where document_id=${row.id} and not (${member('topic_id', topicIds)}) union all select document_id as id from agent_documents where document_id=${row.id} union all select id::text as id from verify_criteria where document_id=${row.id} union all select id::text as id from verify_evidence where document_id=${row.id} and not (${member('check_result_id', resultIds)}) union all select id::text as id from document_shares where document_id=${row.id} union all select id::text as id from expertise_domains where canon_document_id=${row.id} or lesson_base_document_id=${row.id} union all select id::text as id from documents where parent_id=${row.id} union all select id::text as id from files where parent_id=${row.id} union all select id::text as id from works where resource_type='document' and resource_id=${row.id} and not (${member('id', workIds)})`,
      );
      const [doc] = await rows<{ knowledge_base_id: string | null }>(
        this.db,
        sql`select knowledge_base_id from documents where id=${row.id}`,
      );
      if (!refs.length && !doc.knowledge_base_id) documentIds.push(row.id);
    }
    const fileCandidates = await this.select(
      'files',
      sql`id in (select f.file_id from messages_files f join messages m on m.id=f.message_id where ${member('m.topic_id', topicIds)}) or id in (select file_id from documents where ${member('id', documentIds)}) or id in (select file_id from verify_evidence where ${member('check_result_id', resultIds)}) or id in (select resource_id from works where resource_type='file' and ${member('id', workIds)})`,
    );
    const fileIds: string[] = [];
    for (const row of fileCandidates) {
      // Legacy untracked URLs have no proven object-store ownership; retain them
      // rather than claiming physical deletion or deleting an arbitrary URL.
      if (!(await this.allowed(row)) || !row.file_hash) continue;
      const refs = await rows(
        this.db,
        sql`select f.file_id as id from messages_files f join messages m on m.id=f.message_id where f.file_id=${row.id} and (m.topic_id is null or not (${member('m.topic_id', topicIds)})) union all select file_id as id from files_to_sessions where file_id=${row.id} union all select file_id as id from knowledge_base_files where file_id=${row.id} union all select file_id as id from agents_files where file_id=${row.id} union all select id::text as id from generations where file_id=${row.id} union all select id::text as id from documents where file_id=${row.id} and not (${member('id', documentIds)}) union all select id::text as id from verify_evidence where file_id=${row.id} and not (${member('check_result_id', resultIds)}) union all select id::text as id from works where resource_type='file' and resource_id=${row.id} and not (${member('id', workIds)}) union all select t.id from message_tts t join messages m on m.id=t.id where t.file_id=${row.id} and (m.topic_id is null or not (${member('m.topic_id', topicIds)}))`,
      );
      if (!refs.length) fileIds.push(row.id);
    }
    // File mirrors are part of the retained file, not independently disposable pages.
    for (let index = documentIds.length - 1; index >= 0; index--) {
      const doc = docCandidates.find((row) => row.id === documentIds[index])!;
      if (doc.source_type === 'file' && doc.file_id && !fileIds.includes(doc.file_id))
        documentIds.splice(index, 1);
    }
    const deletableWorkIds = workIds.filter((id) => {
      const work = workCandidates.find((row) => row.id === id)!;
      if (work.resource_type === 'task') return !!work.resource_id && taskIds.has(work.resource_id);
      if (work.resource_type === 'document')
        return !!work.resource_id && documentIds.includes(work.resource_id);
      if (work.resource_type === 'file')
        return !!work.resource_id && fileIds.includes(work.resource_id);
      return true;
    });
    return {
      affectedGroupIds: unique(
        topicCandidates.filter((row) => topicIds.includes(row.id)).map((row) => row.group_id),
      ),
      projects,
      goals: goalIds,
      tasks: [...taskIds],
      topics: topicIds,
      files: fileIds,
      documents: documentIds,
      works: deletableWorkIds,
      acceptances: acceptanceIds,
      runs: runIds,
      deleteCounts: {
        goals: goalIds.length,
        tasks: taskIds.size,
        topics: topicIds.length,
        files: fileIds.length,
      },
      retainedCounts: {
        goals: goalCandidates.length - goalIds.length,
        tasks: taskCandidates.size - taskIds.size,
        topics: topicCandidates.length - topicIds.length,
        files: fileCandidates.length - fileIds.length,
      },
    };
  }
}
