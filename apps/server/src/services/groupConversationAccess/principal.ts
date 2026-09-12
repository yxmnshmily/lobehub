import type { LobeChatDatabase } from '@lobechat/database';
import { chatGroups, chatGroupUserMemberships } from '@lobechat/database/schemas';
import { and, eq, gt, isNotNull, isNull, or } from 'drizzle-orm';

import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@/server/services/user/travelServiceGroup';

export const GROUP_CONVERSATION_ACCESS_UNAVAILABLE = 'GROUP_CONVERSATION_ACCESS_UNAVAILABLE';

export class GroupConversationAccessUnavailableError extends Error {
  readonly code = GROUP_CONVERSATION_ACCESS_UNAVAILABLE;

  constructor() {
    super(GROUP_CONVERSATION_ACCESS_UNAVAILABLE);
    this.name = 'GroupConversationAccessUnavailableError';
  }
}

export type GroupConversationPrincipal =
  | {
      actorUserId: string;
      groupId: string;
      joinedAt: null;
      kind: 'owner';
      membershipVersion: 0;
      resourceOwnerUserId: string;
    }
  | {
      actorUserId: string;
      groupId: string;
      joinedAt: Date;
      kind: 'member';
      membershipVersion: number;
      resourceOwnerUserId: string;
    };

interface ResolveGroupConversationPrincipalInput {
  actorUserId: string;
  groupId: string;
}

const unavailable = (): never => {
  throw new GroupConversationAccessUnavailableError();
};

export const resolveGroupConversationPrincipal = async (
  db: LobeChatDatabase,
  input: ResolveGroupConversationPrincipalInput,
): Promise<GroupConversationPrincipal> => {
  const [row] = await db
    .select({
      groupId: chatGroups.id,
      joinedAt: chatGroupUserMemberships.joinedAt,
      memberUserId: chatGroupUserMemberships.userId,
      membershipVersion: chatGroupUserMemberships.membershipVersion,
      resourceOwnerUserId: chatGroups.userId,
    })
    .from(chatGroups)
    .leftJoin(
      chatGroupUserMemberships,
      and(
        eq(chatGroupUserMemberships.chatGroupId, chatGroups.id),
        eq(chatGroupUserMemberships.userId, input.actorUserId),
        eq(chatGroupUserMemberships.role, 'member'),
        isNull(chatGroupUserMemberships.removedAt),
        gt(chatGroupUserMemberships.membershipVersion, 0),
      ),
    )
    .where(
      and(
        eq(chatGroups.id, input.groupId),
        eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
        eq(chatGroups.visibility, 'private'),
        isNull(chatGroups.workspaceId),
        or(eq(chatGroups.userId, input.actorUserId), isNotNull(chatGroupUserMemberships.userId)),
      ),
    )
    .limit(1);

  if (!row) return unavailable();

  if (row.resourceOwnerUserId === input.actorUserId) {
    return {
      actorUserId: input.actorUserId,
      groupId: row.groupId,
      joinedAt: null,
      kind: 'owner',
      membershipVersion: 0,
      resourceOwnerUserId: row.resourceOwnerUserId,
    };
  }

  if (
    row.memberUserId !== input.actorUserId ||
    !(row.joinedAt instanceof Date) ||
    row.membershipVersion === null ||
    !Number.isInteger(row.membershipVersion) ||
    (row.membershipVersion ?? 0) <= 0
  ) {
    return unavailable();
  }

  return {
    actorUserId: input.actorUserId,
    groupId: row.groupId,
    joinedAt: row.joinedAt,
    kind: 'member',
    membershipVersion: row.membershipVersion,
    resourceOwnerUserId: row.resourceOwnerUserId,
  };
};
