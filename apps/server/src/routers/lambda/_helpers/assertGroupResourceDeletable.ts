import type { LobeChatDatabase } from '@lobechat/database';
import { chatGroups, goals, projectChatGroups, tasks, topics } from '@lobechat/database/schemas';
import { TRPCError } from '@trpc/server';
import { and, inArray, isNotNull, type SQL, sql } from 'drizzle-orm';

interface DeletionContext {
  serverDB: LobeChatDatabase;
  userId: string;
}
type Resource = 'topic' | 'task' | 'goal' | 'project';

/** Group membership and resource creation never grant deletion of group work. */
export async function assertGroupOwnerForDeletion(ctx: DeletionContext, groupIds: string[]) {
  if (!groupIds.length) return;
  const unique = [...new Set(groupIds)];
  const rows = await ctx.serverDB
    .select({ id: chatGroups.id, userId: chatGroups.userId })
    .from(chatGroups)
    .where(inArray(chatGroups.id, unique));
  if (rows.length !== unique.length || rows.some((row) => row.userId !== ctx.userId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: '只有群主可以删除群内内容' });
  }
}

/** Look up the persisted group association, never a client-supplied group id. */
export async function assertGroupResourceDeletable(
  ctx: DeletionContext,
  resource: Resource,
  ids?: string[],
  scope?: SQL,
) {
  if (ids && !ids.length) return;
  let rows: { groupId: string | null }[];
  switch (resource) {
    case 'topic': {
      rows = await ctx.serverDB
        .select({ groupId: topics.groupId })
        .from(topics)
        .where(and(ids ? inArray(topics.id, ids) : undefined, scope, isNotNull(topics.groupId)));
      break;
    }
    case 'task': {
      rows = await ctx.serverDB
        .select({ groupId: sql<string | null>`${tasks.config}->>'groupId'` })
        .from(tasks)
        .where(and(ids ? inArray(tasks.id, ids) : undefined, scope));
      break;
    }
    case 'goal': {
      rows = await ctx.serverDB
        .select({ groupId: sql<string | null>`${goals.config}->>'groupId'` })
        .from(goals)
        .where(and(ids ? inArray(goals.id, ids) : undefined, scope));
      break;
    }
    case 'project': {
      rows = await ctx.serverDB
        .select({ groupId: projectChatGroups.chatGroupId })
        .from(projectChatGroups)
        .where(and(ids ? inArray(projectChatGroups.projectId, ids) : undefined, scope));
      break;
    }
  }
  await assertGroupOwnerForDeletion(
    ctx,
    rows.flatMap((row) => (row.groupId ? [row.groupId] : [])),
  );
}
