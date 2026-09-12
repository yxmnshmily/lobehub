import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { topics, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

/** Use persisted verification, never a caller-supplied phone or a cached session claim. */
export const assertGroupAiPhoneVerified = async (
  db: LobeChatDatabase,
  actorUserId: string,
  context: { groupId?: string | null; topicId?: string | null },
) => {
  const groupId =
    context.groupId ||
    (context.topicId
      ? (
          await db.query.topics.findFirst({
            columns: { groupId: true },
            where: eq(topics.id, context.topicId),
          })
        )?.groupId
      : undefined);
  if (!groupId) return;

  const user = await db.query.users.findFirst({
    columns: { phone: true, phoneNumberVerified: true },
    where: eq(users.id, actorUserId),
  });
  if (!user?.phone?.trim() || user.phoneNumberVerified !== true) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: '[PHONE_BINDING_REQUIRED] 请先绑定手机号码',
    });
  }
};
