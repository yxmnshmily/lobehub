import type { LobeChatDatabase } from '@lobechat/database';
import { chatGroups, chatGroupUserMemberships } from '@lobechat/database/schemas';
import { and, asc, eq, gt, isNotNull, isNull, or } from 'drizzle-orm';

import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@/server/services/user/travelServiceGroup';

import { GroupConversationAccessUnavailableError } from './principal';

export type AccessibleGroupSummary = {
  avatar: string | null;
  groupId: string;
  joinedAt: Date | null;
  kind: 'member' | 'owner';
  membershipVersion: number;
  resourceOwnerUserId: string;
  title: string | null;
};

type AccessibleGroupRow = {
  avatar: string | null;
  groupId: string;
  joinedAt: Date | null;
  memberUserId: string | null;
  membershipVersion: number | null;
  resourceOwnerUserId: string;
  title: string | null;
};

export class GroupConversationAccessRepository {
  constructor(private readonly db: LobeChatDatabase) {}

  private queryAccessibleGroups = async (
    actorUserId: string,
    groupId?: string,
  ): Promise<AccessibleGroupRow[]> =>
    this.db
      .select({
        avatar: chatGroups.avatar,
        groupId: chatGroups.id,
        joinedAt: chatGroupUserMemberships.joinedAt,
        memberUserId: chatGroupUserMemberships.userId,
        membershipVersion: chatGroupUserMemberships.membershipVersion,
        resourceOwnerUserId: chatGroups.userId,
        title: chatGroups.title,
      })
      .from(chatGroups)
      .leftJoin(
        chatGroupUserMemberships,
        and(
          eq(chatGroupUserMemberships.chatGroupId, chatGroups.id),
          eq(chatGroupUserMemberships.userId, actorUserId),
          eq(chatGroupUserMemberships.role, 'member'),
          isNull(chatGroupUserMemberships.removedAt),
          gt(chatGroupUserMemberships.membershipVersion, 0),
        ),
      )
      .where(
        and(
          groupId ? eq(chatGroups.id, groupId) : undefined,
          eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
          eq(chatGroups.visibility, 'private'),
          isNull(chatGroups.workspaceId),
          or(eq(chatGroups.userId, actorUserId), isNotNull(chatGroupUserMemberships.userId)),
        ),
      )
      .orderBy(asc(chatGroups.id));

  private toSummary = (
    actorUserId: string,
    row: AccessibleGroupRow,
  ): AccessibleGroupSummary | undefined => {
    if (row.resourceOwnerUserId === actorUserId) {
      return {
        avatar: row.avatar,
        groupId: row.groupId,
        joinedAt: null,
        kind: 'owner',
        membershipVersion: 0,
        resourceOwnerUserId: row.resourceOwnerUserId,
        title: row.title,
      };
    }

    const membershipVersion = row.membershipVersion;
    if (
      row.memberUserId !== actorUserId ||
      !(row.joinedAt instanceof Date) ||
      typeof membershipVersion !== 'number' ||
      !Number.isInteger(membershipVersion) ||
      membershipVersion <= 0
    ) {
      return undefined;
    }

    return {
      avatar: row.avatar,
      groupId: row.groupId,
      joinedAt: row.joinedAt,
      kind: 'member',
      membershipVersion,
      resourceOwnerUserId: row.resourceOwnerUserId,
      title: row.title,
    };
  };

  listAccessibleGroupSummaries = async (actorUserId: string): Promise<AccessibleGroupSummary[]> => {
    const rows = await this.queryAccessibleGroups(actorUserId);

    return rows.flatMap((row) => {
      const summary = this.toSummary(actorUserId, row);
      return summary ? [summary] : [];
    });
  };

  getAccessibleGroupSummary = async (
    actorUserId: string,
    groupId: string,
  ): Promise<AccessibleGroupSummary> => {
    const [row] = await this.queryAccessibleGroups(actorUserId, groupId);
    const summary = row && this.toSummary(actorUserId, row);

    if (!summary) throw new GroupConversationAccessUnavailableError();
    return summary;
  };
}
