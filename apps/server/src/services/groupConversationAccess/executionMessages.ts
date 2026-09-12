import type { LobeChatDatabase } from '@lobechat/database';
import { chatGroupsAgents, messages, threads } from '@lobechat/database/schemas';
import type { UIChatMessage } from '@lobechat/types';
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import { MessageModel } from '@/database/models/message';
import { getFileProxyUrl } from '@/server/services/file';

/** Recover only the branch rooted at a server-recorded request. Never scan a topic as history. */
export const recoverExecutionMessageIds = async (
  db: LobeChatDatabase,
  input: {
    groupId: string;
    joinedAt: Date;
    ownerId: string;
    sourceMessageId: string;
    startedAt?: Date | null;
    topicId: string;
    until: Date;
  },
): Promise<string[]> => {
  const result = await db.execute(sql`
    WITH RECURSIVE execution AS (
      SELECT id, created_at, 0 AS depth, ARRAY[id] AS path
      FROM messages
      WHERE id = ${input.sourceMessageId} AND role = 'user'
        AND user_id = ${input.ownerId} AND group_id = ${input.groupId}
        AND topic_id = ${input.topicId} AND workspace_id IS NULL
        AND thread_id IS NULL AND session_id IS NULL
        AND created_at >= ${input.joinedAt.toISOString()}::timestamptz
      UNION ALL
      SELECT child.id, child.created_at, parent.depth + 1, parent.path || child.id
      FROM messages child JOIN execution parent ON child.parent_id = parent.id
      WHERE child.user_id = ${input.ownerId} AND child.group_id = ${input.groupId}
        AND child.topic_id = ${input.topicId} AND child.workspace_id IS NULL
        AND child.thread_id IS NULL AND child.session_id IS NULL
        AND child.role IN ('assistant', 'tool', 'task')
        AND child.created_at <= ${input.until.toISOString()}::timestamptz
        AND child.created_at >= ${(input.startedAt ?? input.joinedAt).toISOString()}::timestamptz
        AND NOT child.id = ANY(parent.path)
    )
    SELECT id FROM execution WHERE depth > 0 ORDER BY created_at, depth, id
  `);
  return result.rows.map((row) => String(row.id));
};

export interface ExecutionMessageInput {
  agentId?: string | null;
  groupId: string;
  ids: string[];
  joinedAt: Date;
  operationId: string;
  ownerId: string;
  publicId: (id: string) => string;
  topicId: string;
  until: Date;
}

/** Batch root histories, keeping the canonical reader and per-execution projection. */
export const readExecutionMessages = async (
  db: LobeChatDatabase,
  inputs: ExecutionMessageInput[],
): Promise<(UIChatMessage[] | undefined)[]> => {
  if (!inputs.length) return [];
  const scope = inputs[0];
  if (inputs.some((input) => input.ownerId !== scope.ownerId || input.groupId !== scope.groupId))
    throw new Error('Execution batch must belong to one owner and group');
  const reader = new MessageModel(db, scope.ownerId);
  const agents = await db
    .select({ id: chatGroupsAgents.agentId })
    .from(chatGroupsAgents)
    .where(
      and(
        eq(chatGroupsAgents.chatGroupId, scope.groupId),
        eq(chatGroupsAgents.userId, scope.ownerId),
        eq(chatGroupsAgents.enabled, true),
        isNull(chatGroupsAgents.workspaceId),
      ),
    );
  const agentIds = new Set(agents.map((agent) => agent.id));
  const roots = new Map<string, UIChatMessage>();
  const allowedRoots = new Map<ExecutionMessageInput, Set<string>>();
  // Bound combined parameter count too; oversized single executions retain the old single read.
  // No data survives this request, and batching never truncates history.
  for (let offset = 0; offset < inputs.length;) {
    const batch: ExecutionMessageInput[] = [];
    let idCount = 0;
    while (offset < inputs.length && batch.length < 50) {
      const input = inputs[offset];
      if (batch.length && idCount + input.ids.length > 10_000) break;
      offset += 1;
      if (!input.ids.length) continue;
      batch.push(input);
      idCount += input.ids.length;
    }
    if (!batch.length) continue;
    const predicates = batch.map((input) =>
      and(
        inArray(messages.id, input.ids),
        eq(messages.topicId, input.topicId),
        gte(messages.createdAt, input.joinedAt),
        lte(messages.createdAt, input.until),
      ),
    );
    const where = and(
      eq(messages.groupId, scope.groupId),
      isNull(messages.threadId),
      isNull(messages.workspaceId),
      isNull(messages.sessionId),
      inArray(messages.role, ['assistant', 'tool', 'task']),
      or(...predicates),
    );
    if (batch.length > 1) {
      // Preserve PostgreSQL's microsecond boundary instead of rechecking rounded JS Dates.
      const permitted = await db
        .select({
          id: messages.id,
          indexes: sql<number[]>`array_remove(ARRAY[${sql.join(
            predicates.map(
              (predicate, index) => sql`CASE WHEN ${predicate} THEN ${index}::int END`,
            ),
            sql`, `,
          )}], NULL)`,
        })
        .from(messages)
        .where(and(eq(messages.userId, scope.ownerId), where))
        // The caller's publication transaction holds these rows through the content read.
        .for('share');
      for (const input of batch) allowedRoots.set(input, new Set());
      for (const item of permitted)
        for (const index of item.indexes) allowedRoots.get(batch[index])!.add(item.id);
    }
    const items = await reader.queryWithWhere({
      includeFileWorks: true,
      includeGroupedMessages: true,
      pageSize: new Set(batch.flatMap((input) => input.ids)).size,
      postProcessUrl: async (_path, file) => (file.id ? getFileProxyUrl(file.id) : ''),
      where,
    });
    if (batch.length === 1) allowedRoots.set(batch[0], new Set(items.map((item) => item.id)));
    for (const item of items) roots.set(item.id, item);
  }
  const results: (UIChatMessage[] | undefined)[] = [];
  for (const input of inputs) {
    const visited = new Set<string>();
    const read = async (ids: string[], threadId?: string): Promise<UIChatMessage[] | undefined> => {
      if (!ids.length) return [];
      const chain = threadId
        ? await reader.queryWithWhere({
            includeFileWorks: true,
            includeGroupedMessages: true,
            pageSize: ids.length,
            postProcessUrl: async (_path, file) => (file.id ? getFileProxyUrl(file.id) : ''),
            where: and(
              inArray(messages.id, ids),
              or(eq(messages.groupId, input.groupId), isNull(messages.groupId)),
              eq(messages.topicId, input.topicId),
              eq(messages.threadId, threadId),
              isNull(messages.workspaceId),
              isNull(messages.sessionId),
              gte(messages.createdAt, input.joinedAt),
              lte(messages.createdAt, input.until),
              inArray(messages.role, ['user', 'assistant', 'tool', 'task']),
            ),
          })
        : ids.flatMap((id) => {
            const item = roots.get(id);
            return item && allowedRoots.get(input)?.has(id) ? [item] : [];
          });
      const byId = new Map(chain.map((item) => [item.id, item]));
      if (!ids.every((id) => byId.has(id))) return;
      return Promise.all(
        ids.map(async (id, index) => {
          const item = byId.get(id)!;
          const result: UIChatMessage = {
            agentId:
              item.agentId && agentIds.has(item.agentId)
                ? item.agentId
                : threadId
                  ? undefined
                  : (input.agentId ?? undefined),
            audioList: item.audioList,
            content: item.content,
            createdAt: input.until.getTime() - ids.length + index + 1,
            fileList: item.fileList?.map((file) => ({
              ...file,
              downloadUrl: `${getFileProxyUrl(file.id)}?download=1`,
            })),
            imageList: item.imageList,
            id: input.publicId(id),
            metadata: {
              ...(item.role === 'task' && item.metadata?.taskTitle
                ? { taskTitle: item.metadata.taskTitle }
                : {}),
              ...(item.metadata?.work?.rootOperationId === input.operationId
                ? { work: { rootOperationId: input.operationId } }
                : {}),
            },
            parentId:
              item.parentId && byId.has(item.parentId) ? input.publicId(item.parentId) : undefined,
            plugin: item.plugin,
            pluginError: item.pluginError,
            pluginState: item.pluginState,
            role: item.role,
            tool_call_id: item.tool_call_id,
            tools: item.tools,
            topicId: input.topicId,
            updatedAt: input.until.getTime(),
            videoList: item.videoList,
            works: item.works?.filter((work) => work.event.rootOperationId === input.operationId),
          };
          if (
            item.role === 'task' &&
            item.taskDetail?.threadId &&
            !visited.has(item.taskDetail.threadId)
          ) {
            const [thread] = await db
              .select({ id: threads.id })
              .from(threads)
              .where(
                and(
                  eq(threads.id, item.taskDetail.threadId),
                  eq(threads.sourceMessageId, id),
                  eq(threads.userId, input.ownerId),
                  eq(threads.topicId, input.topicId),
                  or(eq(threads.groupId, input.groupId), isNull(threads.groupId)),
                  isNull(threads.workspaceId),
                  isNull(threads.deletedAt),
                ),
              );
            if (thread) {
              visited.add(thread.id);
              const children = await db
                .select({ id: messages.id })
                .from(messages)
                .where(
                  and(
                    eq(messages.threadId, thread.id),
                    eq(messages.userId, input.ownerId),
                    eq(messages.topicId, input.topicId),
                    isNull(messages.workspaceId),
                    isNull(messages.sessionId),
                    or(eq(messages.groupId, input.groupId), isNull(messages.groupId)),
                    gte(messages.createdAt, input.joinedAt),
                    lte(messages.createdAt, input.until),
                    inArray(messages.role, ['user', 'assistant', 'tool', 'task']),
                  ),
                )
                .orderBy(asc(messages.createdAt), asc(messages.id));
              result.tasks = await read(
                children.map((child) => child.id),
                thread.id,
              );
              const detail = item.taskDetail;
              result.taskDetail = {
                threadId: input.publicId(thread.id),
                title: detail.title,
                status: detail.status,
                duration: detail.duration,
                startedAt: detail.startedAt,
                completedAt: detail.completedAt,
                totalMessages: detail.totalMessages,
                totalSteps: detail.totalSteps,
                totalToolCalls: detail.totalToolCalls,
              };
            }
          }
          return result;
        }),
      );
    };
    results.push(await read(input.ids));
  }
  return results;
};
