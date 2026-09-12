import type { LobeChatDatabase } from '@lobechat/database';
import {
  chatGroups,
  chatGroupUserMemberships,
  users,
  userSettings,
} from '@lobechat/database/schemas';
import { TRPCError } from '@trpc/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  GroupConversationAccessUnavailableError,
  resolveGroupConversationPrincipal,
} from '@/server/services/groupConversationAccess/principal';

const groupInput = z.object({ groupId: z.string().trim().min(1).max(255) });
const procedure = authedProcedure.use(serverDatabase).use(({ ctx, next }) => {
  if (ctx.workspaceId) throw new TRPCError({ code: 'NOT_FOUND' });
  return next({ ctx });
});

// Serialize edits with group deletion and membership removal; recheck access inside the transaction.
const withGroup = async <T>(
  db: LobeChatDatabase,
  actorUserId: string,
  groupId: string,
  action: (tx: LobeChatDatabase, owner: boolean) => Promise<T>,
) => {
  try {
    return await db.transaction(async (tx) => {
      const [group] = await tx
        .select({ id: chatGroups.id })
        .from(chatGroups)
        .where(and(eq(chatGroups.id, groupId), isNull(chatGroups.deletedAt)))
        .for('update');
      if (!group) throw new TRPCError({ code: 'NOT_FOUND' });
      await tx
        .select({ userId: chatGroupUserMemberships.userId })
        .from(chatGroupUserMemberships)
        .where(
          and(
            eq(chatGroupUserMemberships.chatGroupId, groupId),
            eq(chatGroupUserMemberships.userId, actorUserId),
          ),
        )
        .for('update');
      const database = tx as unknown as LobeChatDatabase;
      const principal = await resolveGroupConversationPrincipal(database, { actorUserId, groupId });
      return action(database, principal.kind === 'owner');
    });
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    if (error instanceof GroupConversationAccessUnavailableError)
      throw new TRPCError({ code: 'NOT_FOUND' });
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'GROUP_INFO_OPERATION_FAILED' });
  }
};

export const groupInfoRouter = router({
  get: procedure.input(groupInput).query(({ ctx, input }) =>
    withGroup(ctx.serverDB, ctx.userId, input.groupId, async (db, owner) => {
      // Whitelist public fields: never return the group config or another user's settings.
      const [group] = await db
        .select({
          name: chatGroups.title,
          announcement: sql<string>`coalesce(${chatGroups.config}->>'announcement', '')`,
        })
        .from(chatGroups)
        .where(eq(chatGroups.id, input.groupId));
      const [profile] = await db
        .select({
          nickname: sql<string>`coalesce(nullif(trim(${users.fullName}), ''), ${users.username}, '')`,
          remark: sql<string>`coalesce(${userSettings.general}->'groupRemarks'->>${input.groupId}, '')`,
        })
        .from(users)
        .leftJoin(userSettings, eq(userSettings.id, users.id))
        .where(eq(users.id, ctx.userId));
      return {
        ...group,
        nickname: profile?.nickname ?? '',
        remark: profile?.remark ?? '',
        canEditAnnouncement: owner,
      };
    }),
  ),
  updateAnnouncement: procedure
    .input(groupInput.extend({ announcement: z.string().trim().max(4000) }).strict())
    .mutation(({ ctx, input }) =>
      withGroup(ctx.serverDB, ctx.userId, input.groupId, async (db, owner) => {
        if (!owner) throw new TRPCError({ code: 'FORBIDDEN' });
        await db
          .update(chatGroups)
          .set({
            config: sql`coalesce(${chatGroups.config}, '{}'::jsonb) || jsonb_build_object('announcement', ${input.announcement}::text)`,
            updatedAt: new Date(),
          })
          .where(eq(chatGroups.id, input.groupId));
        return { announcement: input.announcement };
      }),
    ),
  updateRemark: procedure
    .input(groupInput.extend({ remark: z.string().trim().max(1000) }).strict())
    .mutation(({ ctx, input }) =>
      withGroup(ctx.serverDB, ctx.userId, input.groupId, async (db) => {
        // Personal preferences belong to the authenticated user, never to the group owner.
        await db
          .insert(userSettings)
          .values({
            id: ctx.userId,
            general: { groupRemarks: { [input.groupId]: input.remark } },
          })
          .onConflictDoUpdate({
            target: userSettings.id,
            set: {
              general: sql`coalesce(${userSettings.general}, '{}'::jsonb) || jsonb_build_object(
          'groupRemarks', coalesce(${userSettings.general}->'groupRemarks', '{}'::jsonb) ||
          jsonb_build_object(${input.groupId}::text, ${input.remark}::text))`,
            },
          });
        return { remark: input.remark };
      }),
    ),
});
