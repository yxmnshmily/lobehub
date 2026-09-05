import { Buffer } from 'node:buffer';

import { and, asc, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';

import { agents } from '../schemas/agent';
import { chatGroups, chatGroupsAgents } from '../schemas/chatGroup';
import type { LobeChatDatabase } from '../type';
import type { ChatGroupConfig } from '../types/chatGroup';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const cursorPattern = /^[\w-]{1,1024}$/;

export class PlatformUserGroupAdminQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformUserGroupAdminQueryError';
  }
}

export class PlatformUserGroupAdminConflictError extends Error {
  constructor(message = 'group version is stale') {
    super(message);
    this.name = 'PlatformUserGroupAdminConflictError';
  }
}

export class PlatformUserGroupAdminNotFoundError extends Error {
  constructor(message = 'private group or member was not found') {
    super(message);
    this.name = 'PlatformUserGroupAdminNotFoundError';
  }
}

export class PlatformUserGroupAdminPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformUserGroupAdminPreconditionError';
  }
}

export interface PlatformUserPrivateGroupItem {
  avatar: string | null;
  clientId: string | null;
  createdAt: Date;
  description: string | null;
  id: string;
  title: string | null;
  updatedAt: Date;
}

export interface PlatformUserPrivateGroupMemberItem {
  agentId: string;
  avatar: string | null;
  clientId: string | null;
  description: string | null;
  enabled: boolean;
  name: string | null;
  order: number;
  role: string;
}

export interface SetPrivateGroupMemberEnabledInput {
  agentId: string;
  enabled: boolean;
  expectedGroupUpdatedAt: Date;
  groupId: string;
  targetUserId: string;
}

export interface ReorderPrivateGroupMembersInput {
  expectedGroupUpdatedAt: Date;
  groupId: string;
  orderedAgentIds: string[];
  targetUserId: string;
}

export interface UpdatePrivateGroupTemplateInput {
  expectedGroupUpdatedAt: Date;
  groupId: string;
  patch: {
    content?: string;
    openingMessage?: string;
    openingQuestions?: string[];
  };
  targetUserId: string;
}

const normalizeIdentifier = (value: string, field: string): string => {
  if (typeof value !== 'string') throw new PlatformUserGroupAdminQueryError(`${field} is invalid`);
  const normalized = value.trim();
  if (!normalized || normalized.length > 255 || /[\p{Cc}\p{Cf}]/u.test(normalized)) {
    throw new PlatformUserGroupAdminQueryError(`${field} is invalid`);
  }
  return normalized;
};

const normalizeLimit = (limit: number): number => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new PlatformUserGroupAdminQueryError('limit is invalid');
  }
  return limit;
};

const normalizeExpectedVersion = (value: Date): Date => {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new PlatformUserGroupAdminQueryError('expectedGroupUpdatedAt is invalid');
  }
  return new Date(value.getTime());
};

const nextVersion = (current: Date): Date => new Date(Math.max(Date.now(), current.getTime() + 1));

const privateGroupFilters = (targetUserId: string, groupId: string) =>
  and(
    eq(chatGroups.id, groupId),
    eq(chatGroups.userId, targetUserId),
    isNull(chatGroups.workspaceId),
    eq(chatGroups.visibility, 'private'),
  );

const normalizeTemplatePatch = (
  patch: UpdatePrivateGroupTemplateInput['patch'],
): UpdatePrivateGroupTemplateInput['patch'] => {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new PlatformUserGroupAdminQueryError('patch is invalid');
  }
  const allowedKeys = new Set(['content', 'openingMessage', 'openingQuestions']);
  const keys = Object.keys(patch);
  if (keys.length === 0 || keys.some((key) => !allowedKeys.has(key))) {
    throw new PlatformUserGroupAdminQueryError('patch is invalid');
  }
  if ('content' in patch && typeof patch.content !== 'string') {
    throw new PlatformUserGroupAdminQueryError('content is invalid');
  }
  if ('openingMessage' in patch && typeof patch.openingMessage !== 'string') {
    throw new PlatformUserGroupAdminQueryError('openingMessage is invalid');
  }
  if (
    'openingQuestions' in patch &&
    (!Array.isArray(patch.openingQuestions) ||
      patch.openingQuestions.some((question) => typeof question !== 'string'))
  ) {
    throw new PlatformUserGroupAdminQueryError('openingQuestions is invalid');
  }
  return patch;
};

const decodeCursorPayload = (cursor: string): unknown => {
  if (!cursorPattern.test(cursor)) throw new PlatformUserGroupAdminQueryError('cursor is invalid');
  try {
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) throw new Error('non-canonical-cursor');
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new PlatformUserGroupAdminQueryError('cursor is invalid');
  }
};

const encodeGroupCursor = (item: PlatformUserPrivateGroupItem): string =>
  Buffer.from(JSON.stringify([item.updatedAt.toISOString(), item.id])).toString('base64url');

const decodeGroupCursor = (cursor: string): { id: string; updatedAt: Date } => {
  const decoded = decodeCursorPayload(cursor);
  if (
    !Array.isArray(decoded) ||
    decoded.length !== 2 ||
    typeof decoded[0] !== 'string' ||
    typeof decoded[1] !== 'string' ||
    !decoded[1] ||
    decoded[1].length > 255
  ) {
    throw new PlatformUserGroupAdminQueryError('cursor is invalid');
  }
  const updatedAt = new Date(decoded[0]);
  if (!Number.isFinite(updatedAt.getTime()) || updatedAt.toISOString() !== decoded[0]) {
    throw new PlatformUserGroupAdminQueryError('cursor is invalid');
  }
  return { id: decoded[1], updatedAt };
};

const encodeMemberCursor = (item: PlatformUserPrivateGroupMemberItem): string =>
  Buffer.from(JSON.stringify([item.order, item.agentId])).toString('base64url');

const decodeMemberCursor = (cursor: string): { agentId: string; order: number } => {
  const decoded = decodeCursorPayload(cursor);
  if (
    !Array.isArray(decoded) ||
    decoded.length !== 2 ||
    !Number.isSafeInteger(decoded[0]) ||
    typeof decoded[1] !== 'string' ||
    !decoded[1] ||
    decoded[1].length > 255
  ) {
    throw new PlatformUserGroupAdminQueryError('cursor is invalid');
  }
  return { agentId: decoded[1], order: decoded[0] };
};

/** Read-only, allowlisted administrator view of one user's personal private groups. */
export class PlatformUserGroupAdminModel {
  constructor(private readonly db: LobeChatDatabase) {}

  async listPrivateGroups(
    targetUserIdValue: string,
    cursorValue?: string,
    limitValue = DEFAULT_LIMIT,
  ) {
    const targetUserId = normalizeIdentifier(targetUserIdValue, 'targetUserId');
    const limit = normalizeLimit(limitValue);
    const cursor = cursorValue === undefined ? undefined : decodeGroupCursor(cursorValue);
    const filters = [
      eq(chatGroups.userId, targetUserId),
      isNull(chatGroups.workspaceId),
      eq(chatGroups.visibility, 'private'),
    ];
    if (cursor) {
      filters.push(
        or(
          lt(chatGroups.updatedAt, cursor.updatedAt),
          and(eq(chatGroups.updatedAt, cursor.updatedAt), lt(chatGroups.id, cursor.id)),
        )!,
      );
    }

    const rows = await this.db
      .select({
        avatar: chatGroups.avatar,
        clientId: chatGroups.clientId,
        createdAt: chatGroups.createdAt,
        description: chatGroups.description,
        id: chatGroups.id,
        title: chatGroups.title,
        updatedAt: chatGroups.updatedAt,
      })
      .from(chatGroups)
      .where(and(...filters))
      .orderBy(desc(chatGroups.updatedAt), desc(chatGroups.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items,
      nextCursor: hasMore && items.length > 0 ? encodeGroupCursor(items.at(-1)!) : null,
    };
  }

  async getPrivateGroupMembers(
    targetUserIdValue: string,
    groupIdValue: string,
    cursorValue?: string,
    limitValue = DEFAULT_LIMIT,
  ) {
    const targetUserId = normalizeIdentifier(targetUserIdValue, 'targetUserId');
    const groupId = normalizeIdentifier(groupIdValue, 'groupId');
    const limit = normalizeLimit(limitValue);
    const cursor = cursorValue === undefined ? undefined : decodeMemberCursor(cursorValue);

    const [group] = await this.db
      .select({ id: chatGroups.id })
      .from(chatGroups)
      .where(
        and(
          eq(chatGroups.id, groupId),
          eq(chatGroups.userId, targetUserId),
          isNull(chatGroups.workspaceId),
          eq(chatGroups.visibility, 'private'),
        ),
      )
      .limit(1);
    if (!group) return undefined;

    const memberOrder = sql<number>`coalesce(${chatGroupsAgents.order}, 0)`;
    const filters = [
      eq(chatGroupsAgents.chatGroupId, group.id),
      eq(chatGroupsAgents.userId, targetUserId),
      isNull(chatGroupsAgents.workspaceId),
      eq(agents.userId, targetUserId),
      isNull(agents.workspaceId),
    ];
    if (cursor) {
      filters.push(
        or(
          gt(memberOrder, cursor.order),
          and(eq(memberOrder, cursor.order), gt(chatGroupsAgents.agentId, cursor.agentId)),
        )!,
      );
    }

    const rows = await this.db
      .select({
        agentId: chatGroupsAgents.agentId,
        avatar: agents.avatar,
        clientId: agents.clientId,
        description: agents.description,
        enabled: chatGroupsAgents.enabled,
        name: agents.name,
        order: chatGroupsAgents.order,
        role: chatGroupsAgents.role,
      })
      .from(chatGroupsAgents)
      .innerJoin(agents, eq(chatGroupsAgents.agentId, agents.id))
      .where(and(...filters))
      .orderBy(asc(memberOrder), asc(chatGroupsAgents.agentId))
      .limit(limit + 1);

    const normalizedRows: PlatformUserPrivateGroupMemberItem[] = rows.map((row) => ({
      ...row,
      enabled: row.enabled ?? true,
      order: row.order ?? 0,
      role: row.role ?? 'participant',
    }));
    const hasMore = normalizedRows.length > limit;
    const items = hasMore ? normalizedRows.slice(0, limit) : normalizedRows;
    return {
      items,
      nextCursor: hasMore && items.length > 0 ? encodeMemberCursor(items.at(-1)!) : null,
    };
  }

  async setPrivateGroupMemberEnabled(input: SetPrivateGroupMemberEnabledInput) {
    const targetUserId = normalizeIdentifier(input.targetUserId, 'targetUserId');
    const groupId = normalizeIdentifier(input.groupId, 'groupId');
    const agentId = normalizeIdentifier(input.agentId, 'agentId');
    const expectedGroupUpdatedAt = normalizeExpectedVersion(input.expectedGroupUpdatedAt);
    if (typeof input.enabled !== 'boolean') {
      throw new PlatformUserGroupAdminQueryError('enabled is invalid');
    }

    return this.db.transaction(async (tx) => {
      const [group] = await tx
        .select({ updatedAt: chatGroups.updatedAt })
        .from(chatGroups)
        .where(privateGroupFilters(targetUserId, groupId))
        .limit(1);
      if (!group) throw new PlatformUserGroupAdminNotFoundError();
      if (group.updatedAt.getTime() !== expectedGroupUpdatedAt.getTime()) {
        throw new PlatformUserGroupAdminConflictError();
      }

      const [member] = await tx
        .select({
          agentId: chatGroupsAgents.agentId,
          enabled: chatGroupsAgents.enabled,
          order: chatGroupsAgents.order,
          role: chatGroupsAgents.role,
        })
        .from(chatGroupsAgents)
        .innerJoin(agents, eq(chatGroupsAgents.agentId, agents.id))
        .where(
          and(
            eq(chatGroupsAgents.chatGroupId, groupId),
            eq(chatGroupsAgents.agentId, agentId),
            eq(chatGroupsAgents.userId, targetUserId),
            isNull(chatGroupsAgents.workspaceId),
            eq(agents.userId, targetUserId),
            isNull(agents.workspaceId),
          ),
        )
        .limit(1);
      if (!member) throw new PlatformUserGroupAdminNotFoundError();
      const role = member.role ?? 'participant';
      if (role === 'supervisor' && !input.enabled) {
        throw new PlatformUserGroupAdminPreconditionError('supervisor cannot be disabled');
      }
      const groupUpdatedAt = nextVersion(group.updatedAt);
      const [claimedGroup] = await tx
        .update(chatGroups)
        .set({ updatedAt: groupUpdatedAt })
        .where(
          and(
            privateGroupFilters(targetUserId, groupId),
            eq(chatGroups.updatedAt, expectedGroupUpdatedAt),
          ),
        )
        .returning({ id: chatGroups.id });
      if (!claimedGroup) throw new PlatformUserGroupAdminConflictError();

      const [updatedMember] = await tx
        .update(chatGroupsAgents)
        .set({ enabled: input.enabled, updatedAt: groupUpdatedAt })
        .where(
          and(
            eq(chatGroupsAgents.chatGroupId, groupId),
            eq(chatGroupsAgents.agentId, agentId),
            eq(chatGroupsAgents.userId, targetUserId),
            isNull(chatGroupsAgents.workspaceId),
          ),
        )
        .returning({
          agentId: chatGroupsAgents.agentId,
          enabled: chatGroupsAgents.enabled,
          order: chatGroupsAgents.order,
          role: chatGroupsAgents.role,
        });
      if (!updatedMember)
        throw new PlatformUserGroupAdminConflictError('member changed concurrently');

      return {
        groupUpdatedAt,
        member: {
          ...updatedMember,
          enabled: updatedMember.enabled ?? true,
          order: updatedMember.order ?? 0,
          role: updatedMember.role ?? 'participant',
        },
      };
    });
  }

  async reorderPrivateGroupMembers(input: ReorderPrivateGroupMembersInput) {
    const targetUserId = normalizeIdentifier(input.targetUserId, 'targetUserId');
    const groupId = normalizeIdentifier(input.groupId, 'groupId');
    const expectedGroupUpdatedAt = normalizeExpectedVersion(input.expectedGroupUpdatedAt);
    if (!Array.isArray(input.orderedAgentIds)) {
      throw new PlatformUserGroupAdminQueryError('orderedAgentIds is invalid');
    }
    const orderedAgentIds = input.orderedAgentIds.map((agentId) =>
      normalizeIdentifier(agentId, 'orderedAgentIds'),
    );

    return this.db.transaction(async (tx) => {
      const [group] = await tx
        .select({ updatedAt: chatGroups.updatedAt })
        .from(chatGroups)
        .where(privateGroupFilters(targetUserId, groupId))
        .limit(1);
      if (!group) throw new PlatformUserGroupAdminNotFoundError();
      if (group.updatedAt.getTime() !== expectedGroupUpdatedAt.getTime()) {
        throw new PlatformUserGroupAdminConflictError();
      }

      const members = await tx
        .select({
          agentId: chatGroupsAgents.agentId,
          agentUserId: agents.userId,
          agentWorkspaceId: agents.workspaceId,
          memberUserId: chatGroupsAgents.userId,
          memberWorkspaceId: chatGroupsAgents.workspaceId,
          role: chatGroupsAgents.role,
        })
        .from(chatGroupsAgents)
        .innerJoin(agents, eq(chatGroupsAgents.agentId, agents.id))
        .where(eq(chatGroupsAgents.chatGroupId, groupId));
      if (
        members.some(
          (member) =>
            member.memberUserId !== targetUserId ||
            member.memberWorkspaceId !== null ||
            member.agentUserId !== targetUserId ||
            member.agentWorkspaceId !== null,
        )
      ) {
        throw new PlatformUserGroupAdminNotFoundError();
      }

      const supervisors = members.filter((member) => member.role === 'supervisor');
      const uniqueIds = new Set(orderedAgentIds);
      const completeRoster =
        orderedAgentIds.length === members.length &&
        uniqueIds.size === members.length &&
        members.every((member) => uniqueIds.has(member.agentId));
      if (
        !completeRoster ||
        supervisors.length !== 1 ||
        orderedAgentIds[0] !== supervisors[0].agentId
      ) {
        throw new PlatformUserGroupAdminPreconditionError(
          'order must be a complete roster with the supervisor first',
        );
      }

      const groupUpdatedAt = nextVersion(group.updatedAt);
      const [claimedGroup] = await tx
        .update(chatGroups)
        .set({ updatedAt: groupUpdatedAt })
        .where(
          and(
            privateGroupFilters(targetUserId, groupId),
            eq(chatGroups.updatedAt, expectedGroupUpdatedAt),
          ),
        )
        .returning({ id: chatGroups.id });
      if (!claimedGroup) throw new PlatformUserGroupAdminConflictError();

      for (const [order, agentId] of orderedAgentIds.entries()) {
        const [updatedMember] = await tx
          .update(chatGroupsAgents)
          .set({ order, updatedAt: groupUpdatedAt })
          .where(
            and(
              eq(chatGroupsAgents.chatGroupId, groupId),
              eq(chatGroupsAgents.agentId, agentId),
              eq(chatGroupsAgents.userId, targetUserId),
              isNull(chatGroupsAgents.workspaceId),
            ),
          )
          .returning({ agentId: chatGroupsAgents.agentId });
        if (!updatedMember) {
          throw new PlatformUserGroupAdminConflictError('member changed concurrently');
        }
      }

      return { groupUpdatedAt, orderedAgentIds };
    });
  }

  async updatePrivateGroupTemplate(input: UpdatePrivateGroupTemplateInput) {
    const targetUserId = normalizeIdentifier(input.targetUserId, 'targetUserId');
    const groupId = normalizeIdentifier(input.groupId, 'groupId');
    const expectedGroupUpdatedAt = normalizeExpectedVersion(input.expectedGroupUpdatedAt);
    const patch = normalizeTemplatePatch(input.patch);

    return this.db.transaction(async (tx) => {
      const [group] = await tx
        .select({
          config: chatGroups.config,
          content: chatGroups.content,
          updatedAt: chatGroups.updatedAt,
        })
        .from(chatGroups)
        .where(privateGroupFilters(targetUserId, groupId))
        .limit(1);
      if (!group) throw new PlatformUserGroupAdminNotFoundError();
      if (group.updatedAt.getTime() !== expectedGroupUpdatedAt.getTime()) {
        throw new PlatformUserGroupAdminConflictError();
      }

      const nextConfig: ChatGroupConfig = group.config ? { ...group.config } : {};
      if ('openingMessage' in patch) nextConfig.openingMessage = patch.openingMessage;
      if ('openingQuestions' in patch) nextConfig.openingQuestions = patch.openingQuestions;
      const groupUpdatedAt = nextVersion(group.updatedAt);
      const [updatedGroup] = await tx
        .update(chatGroups)
        .set({
          config: nextConfig,
          content: 'content' in patch ? patch.content : group.content,
          updatedAt: groupUpdatedAt,
        })
        .where(
          and(
            privateGroupFilters(targetUserId, groupId),
            eq(chatGroups.updatedAt, expectedGroupUpdatedAt),
          ),
        )
        .returning({ id: chatGroups.id });
      if (!updatedGroup) throw new PlatformUserGroupAdminConflictError();

      return { groupUpdatedAt };
    });
  }
}
