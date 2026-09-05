import { createHash } from 'node:crypto';

import type { LobeChatDatabase, Transaction } from '@lobechat/database';
import {
  agentOperations,
  chatGroups,
  chatGroupUserMemberships,
  messages,
  messagesFiles,
  topics,
  users,
} from '@lobechat/database/schemas';
import { and, asc, desc, eq, gt, gte, isNotNull, isNull, notExists, or, sql } from 'drizzle-orm';

import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@/server/services/user/travelServiceGroup';

import type { GroupConversationPrincipal } from './principal';
import { GroupConversationAccessUnavailableError } from './principal';

export const GROUP_CONVERSATION_PAGE_SIZE_MAX = 50;
const GROUP_CONVERSATION_PAGE_SIZE_DEFAULT = 30;
const GROUP_CONVERSATION_IDEMPOTENCY_KEY_MAX = 128;
const GROUP_CONVERSATION_TEXT_MAX = 8000;
const GROUP_CONVERSATION_TITLE_MAX = 200;

export const GROUP_CONVERSATION_INVALID_INPUT = 'GROUP_CONVERSATION_INVALID_INPUT';
export const GROUP_CONVERSATION_IDEMPOTENCY_CONFLICT = 'GROUP_CONVERSATION_IDEMPOTENCY_CONFLICT';

export class GroupConversationInvalidInputError extends Error {
  readonly code = GROUP_CONVERSATION_INVALID_INPUT;

  constructor() {
    super(GROUP_CONVERSATION_INVALID_INPUT);
    this.name = 'GroupConversationInvalidInputError';
  }
}

export class GroupConversationIdempotencyConflictError extends Error {
  readonly code = GROUP_CONVERSATION_IDEMPOTENCY_CONFLICT;

  constructor() {
    super(GROUP_CONVERSATION_IDEMPOTENCY_CONFLICT);
    this.name = 'GroupConversationIdempotencyConflictError';
  }
}

export type GroupConversationCursor = {
  createdAt: Date;
  id: string;
};

type GroupConversationPageOptions = {
  cursor?: GroupConversationCursor;
  limit?: number;
};

export type CreateAccessibleTopicInput = {
  groupId: string;
  idempotencyKey: string;
  title: string;
};

export type CreateAccessibleTextMessageInput = {
  content: string;
  groupId: string;
  idempotencyKey: string;
  topicId: string;
};

export type AccessibleConversationTopic = {
  createdAt: Date;
  id: string;
  title: string | null;
};

export type AccessibleTextMessage = {
  authorKind: 'member' | 'owner' | 'self';
  content: string;
  publicMessageId: string;
  topicId: string;
  visibleAt: Date;
};

export type AccessiblePublishedAssistantMessage = {
  content: string;
  id: string;
  kind: 'assistant';
  topicId: string;
  visibleAt: Date;
};

export type OwnerSupplementalTextMessage = {
  content: string;
  createdAt: Date;
  groupId: string;
  id: string;
  role: 'user';
  sender: {
    avatar: string | null;
    fullName: string | null;
    id: string;
    username: string | null;
  };
  topicId: string;
  updatedAt: Date;
};

export type GroupConversationPage<T> = {
  items: T[];
  nextCursor: GroupConversationCursor | null;
};

const pageLimit = (requested?: number) => {
  if (!Number.isFinite(requested)) return GROUP_CONVERSATION_PAGE_SIZE_DEFAULT;

  return Math.min(
    GROUP_CONVERSATION_PAGE_SIZE_MAX,
    Math.max(1, Math.trunc(requested ?? GROUP_CONVERSATION_PAGE_SIZE_DEFAULT)),
  );
};

const afterTopicCursor = (cursor?: GroupConversationCursor) =>
  cursor
    ? or(
        gt(topics.createdAt, cursor.createdAt),
        and(eq(topics.createdAt, cursor.createdAt), gt(topics.id, cursor.id)),
      )
    : undefined;

const afterMessageCursor = (cursor?: GroupConversationCursor) =>
  cursor
    ? or(
        gt(messages.createdAt, cursor.createdAt),
        and(eq(messages.createdAt, cursor.createdAt), gt(messages.id, cursor.id)),
      )
    : undefined;

const toPage = <T extends { createdAt: Date; id: string }>(
  items: T[],
  limit: number,
): GroupConversationPage<T> => {
  const hasNextPage = items.length > limit;
  const visibleItems = hasNextPage ? items.slice(0, limit) : items;
  const lastItem = visibleItems.at(-1);

  return {
    items: visibleItems,
    nextCursor: hasNextPage && lastItem ? { createdAt: lastItem.createdAt, id: lastItem.id } : null,
  };
};

const invalidInput = (): never => {
  throw new GroupConversationInvalidInputError();
};

const assertExactObject = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidInput();
  if (Object.keys(value).some((key) => !keys.includes(key))) return invalidInput();

  return value as Record<string, unknown>;
};

const requiredString = (
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
): string => {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    return invalidInput();
  }

  return value;
};

const parseTopicInput = (input: CreateAccessibleTopicInput): CreateAccessibleTopicInput => {
  const record = assertExactObject(input, ['groupId', 'idempotencyKey', 'title']);
  const idempotencyKey = requiredString(
    record,
    'idempotencyKey',
    GROUP_CONVERSATION_IDEMPOTENCY_KEY_MAX,
  );
  if (!/^[\x20-\x7E]+$/.test(idempotencyKey)) return invalidInput();

  return {
    groupId: requiredString(record, 'groupId', 255),
    idempotencyKey,
    title: requiredString(record, 'title', GROUP_CONVERSATION_TITLE_MAX),
  };
};

const parseTextMessageInput = (
  input: CreateAccessibleTextMessageInput,
): CreateAccessibleTextMessageInput => {
  const record = assertExactObject(input, ['content', 'groupId', 'idempotencyKey', 'topicId']);
  const idempotencyKey = requiredString(
    record,
    'idempotencyKey',
    GROUP_CONVERSATION_IDEMPOTENCY_KEY_MAX,
  );
  if (!/^[\x20-\x7E]+$/.test(idempotencyKey)) return invalidInput();

  return {
    content: requiredString(record, 'content', GROUP_CONVERSATION_TEXT_MAX),
    groupId: requiredString(record, 'groupId', 255),
    idempotencyKey,
    topicId: requiredString(record, 'topicId', 255),
  };
};

const digest = (parts: readonly (number | string)[]) =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex');

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const PUBLISHED_ASSISTANT_MARKER_KEYS = [
  'actorUserIdSnapshot',
  'assistantMessageId',
  'contentHash',
  'groupId',
  'membershipVersion',
  'operationId',
  'ownerUserIdSnapshot',
  'publishedAt',
  'version',
] as const;

const parsePublishedAssistantMarker = (value: unknown) => {
  const marker = asRecord(value);
  if (
    !marker ||
    Object.keys(marker).length !== PUBLISHED_ASSISTANT_MARKER_KEYS.length ||
    Object.keys(marker).some((key) => !PUBLISHED_ASSISTANT_MARKER_KEYS.includes(key as never))
  ) {
    return undefined;
  }

  const publishedAt =
    typeof marker.publishedAt === 'string' ? new Date(marker.publishedAt) : undefined;
  if (
    marker.version !== 1 ||
    typeof marker.operationId !== 'string' ||
    !marker.operationId.trim() ||
    typeof marker.ownerUserIdSnapshot !== 'string' ||
    !marker.ownerUserIdSnapshot.trim() ||
    typeof marker.actorUserIdSnapshot !== 'string' ||
    !marker.actorUserIdSnapshot.trim() ||
    typeof marker.groupId !== 'string' ||
    !marker.groupId.trim() ||
    !Number.isSafeInteger(marker.membershipVersion) ||
    (marker.membershipVersion as number) <= 0 ||
    typeof marker.assistantMessageId !== 'string' ||
    !marker.assistantMessageId.trim() ||
    typeof marker.contentHash !== 'string' ||
    !/^[a-f\d]{64}$/.test(marker.contentHash) ||
    !publishedAt ||
    !Number.isFinite(publishedAt.getTime())
  ) {
    return undefined;
  }

  return {
    actorUserIdSnapshot: marker.actorUserIdSnapshot,
    assistantMessageId: marker.assistantMessageId,
    contentHash: marker.contentHash,
    groupId: marker.groupId,
    membershipVersion: marker.membershipVersion as number,
    operationId: marker.operationId,
    ownerUserIdSnapshot: marker.ownerUserIdSnapshot,
    publishedAt,
  };
};

const publishedAssistantPublicId = (
  ownerUserId: string,
  groupId: string,
  topicId: string,
  operationId: string,
  assistantMessageId: string,
) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        'group-conversation-published-assistant-v1',
        ownerUserId,
        groupId,
        topicId,
        operationId,
        assistantMessageId,
      ]),
      'utf8',
    )
    .digest('hex');

const textMessagePublicId = (
  ownerUserId: string,
  groupId: string,
  topicId: string,
  messageId: string,
) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        'group-conversation-text-message-v1',
        ownerUserId,
        groupId,
        topicId,
        messageId,
      ]),
      'utf8',
    )
    .digest('hex');

const messageAuthorKind = (
  actorUserId: string,
  ownerUserId: string,
  authorUserId: string,
): AccessibleTextMessage['authorKind'] =>
  authorUserId === actorUserId ? 'self' : authorUserId === ownerUserId ? 'owner' : 'member';

const hostedRunMatchesPublishedMarker = (
  value: unknown,
  marker: NonNullable<ReturnType<typeof parsePublishedAssistantMarker>>,
) => {
  const hostedRun = asRecord(value);

  return (
    hostedRun?.version === 1 &&
    hostedRun.actorUserIdSnapshot === marker.actorUserIdSnapshot &&
    hostedRun.ownerUserIdSnapshot === marker.ownerUserIdSnapshot &&
    hostedRun.groupId === marker.groupId &&
    hostedRun.membershipVersion === marker.membershipVersion
  );
};

const requestIds = (
  kind: 'message' | 'topic',
  principal: GroupConversationPrincipal,
  idempotencyKey: string,
  resourceParts: string[],
) => {
  const principalParts = [
    kind,
    principal.actorUserId,
    principal.groupId,
    principal.membershipVersion,
    idempotencyKey,
  ] as const;

  return {
    clientId: `group-conversation-${kind}-request-${digest([...principalParts, ...resourceParts])}`,
    id: `group-conversation-${kind}-${digest(principalParts)}`,
  };
};

const resolveLockedPrincipal = async (
  tx: Transaction,
  actorUserId: string,
  groupId: string,
): Promise<GroupConversationPrincipal> => {
  const [group] = await tx
    .select({ id: chatGroups.id, resourceOwnerUserId: chatGroups.userId })
    .from(chatGroups)
    .where(
      and(
        eq(chatGroups.id, groupId),
        eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
        eq(chatGroups.visibility, 'private'),
        isNull(chatGroups.workspaceId),
      ),
    )
    .limit(1)
    .for('update');

  if (!group) throw new GroupConversationAccessUnavailableError();

  if (group.resourceOwnerUserId === actorUserId) {
    return {
      actorUserId,
      groupId,
      joinedAt: null,
      kind: 'owner',
      membershipVersion: 0,
      resourceOwnerUserId: group.resourceOwnerUserId,
    };
  }

  const [membership] = await tx
    .select({
      joinedAt: chatGroupUserMemberships.joinedAt,
      membershipVersion: chatGroupUserMemberships.membershipVersion,
    })
    .from(chatGroupUserMemberships)
    .where(
      and(
        eq(chatGroupUserMemberships.chatGroupId, groupId),
        eq(chatGroupUserMemberships.userId, actorUserId),
        eq(chatGroupUserMemberships.role, 'member'),
        isNull(chatGroupUserMemberships.removedAt),
        gt(chatGroupUserMemberships.membershipVersion, 0),
      ),
    )
    .limit(1)
    .for('update');

  if (!membership) throw new GroupConversationAccessUnavailableError();

  return {
    actorUserId,
    groupId,
    joinedAt: membership.joinedAt,
    kind: 'member',
    membershipVersion: membership.membershipVersion,
    resourceOwnerUserId: group.resourceOwnerUserId,
  };
};

export class GroupConversationAccessRepository {
  constructor(private readonly db: LobeChatDatabase) {}

  private activeMembershipJoin = (actorUserId: string) =>
    and(
      eq(chatGroupUserMemberships.chatGroupId, chatGroups.id),
      eq(chatGroupUserMemberships.userId, actorUserId),
      eq(chatGroupUserMemberships.role, 'member'),
      isNull(chatGroupUserMemberships.removedAt),
      gt(chatGroupUserMemberships.membershipVersion, 0),
    );

  private accessibleGroupWhere = (actorUserId: string, groupId: string) =>
    and(
      eq(chatGroups.id, groupId),
      eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
      eq(chatGroups.visibility, 'private'),
      isNull(chatGroups.workspaceId),
      or(eq(chatGroups.userId, actorUserId), isNotNull(chatGroupUserMemberships.userId)),
    );

  private visibleSinceCurrentMembership = (
    actorUserId: string,
    createdAt: typeof topics.createdAt,
  ) =>
    or(
      eq(chatGroups.userId, actorUserId),
      and(
        isNotNull(chatGroupUserMemberships.userId),
        gte(createdAt, chatGroupUserMemberships.joinedAt),
      ),
    );

  private resolveAccessibleTextCursor = async (
    actorUserId: string,
    groupId: string,
    topicId: string,
    cursor: GroupConversationCursor,
  ): Promise<GroupConversationCursor> => {
    const rows = await this.db
      .select({
        groupId: chatGroups.id,
        id: messages.id,
        ownerUserId: chatGroups.userId,
        topicId: topics.id,
      })
      .from(topics)
      .innerJoin(chatGroups, eq(chatGroups.id, topics.groupId))
      .leftJoin(chatGroupUserMemberships, this.activeMembershipJoin(actorUserId))
      .innerJoin(
        messages,
        and(
          eq(messages.groupId, chatGroups.id),
          eq(messages.topicId, topics.id),
          eq(messages.createdAt, cursor.createdAt),
          eq(messages.role, 'user'),
          isNotNull(messages.content),
          sql<boolean>`length(trim(${messages.content})) > 0`,
          isNull(messages.workspaceId),
          this.visibleSinceCurrentMembership(actorUserId, messages.createdAt),
          notExists(
            this.db
              .select({ fileId: messagesFiles.fileId })
              .from(messagesFiles)
              .where(eq(messagesFiles.messageId, messages.id)),
          ),
        ),
      )
      .where(
        and(
          this.accessibleGroupWhere(actorUserId, groupId),
          eq(topics.id, topicId),
          eq(topics.userId, chatGroups.userId),
          isNull(topics.workspaceId),
          this.visibleSinceCurrentMembership(actorUserId, topics.createdAt),
        ),
      );

    const match = rows.find(
      (row) =>
        textMessagePublicId(row.ownerUserId, row.groupId, row.topicId, row.id) === cursor.id,
    );
    if (!match) throw new GroupConversationAccessUnavailableError();

    return { createdAt: cursor.createdAt, id: match.id };
  };

  /**
   * Returns the narrow set of member-authored rows that the standard personal
   * group transcript cannot see through its owner-scoped MessageModel.
   *
   * This is deliberately not a general ownership bypass: the joins prove that
   * the caller owns the default private travel group and that every returned
   * author wrote plain text during a valid membership period. Owner-authored
   * and AI rows continue through the normal MessageModel path.
   */
  listOwnerSupplementalTextMessages = async (
    ownerUserId: string,
    groupId: string,
    topicId: string,
  ): Promise<OwnerSupplementalTextMessage[]> => {
    const rows = await this.db
      .select({
        content: messages.content,
        createdAt: messages.createdAt,
        groupId: messages.groupId,
        id: messages.id,
        sender: {
          // Keep id first: Drizzle uses the first nested column to decide
          // whether a LEFT JOIN object is null.
          id: users.id,
          avatar: users.avatar,
          fullName: users.fullName,
          username: users.username,
        },
        topicId: messages.topicId,
        updatedAt: messages.updatedAt,
      })
      .from(messages)
      .innerJoin(
        topics,
        and(
          eq(topics.id, messages.topicId),
          eq(topics.id, topicId),
          eq(topics.groupId, groupId),
          eq(topics.userId, ownerUserId),
          isNull(topics.workspaceId),
        ),
      )
      .innerJoin(
        chatGroups,
        and(
          eq(chatGroups.id, messages.groupId),
          eq(chatGroups.id, groupId),
          eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
          eq(chatGroups.userId, ownerUserId),
          eq(chatGroups.visibility, 'private'),
          isNull(chatGroups.workspaceId),
        ),
      )
      .innerJoin(
        chatGroupUserMemberships,
        and(
          eq(chatGroupUserMemberships.chatGroupId, chatGroups.id),
          eq(chatGroupUserMemberships.userId, messages.userId),
          eq(chatGroupUserMemberships.role, 'member'),
          gt(chatGroupUserMemberships.membershipVersion, 0),
          gte(messages.createdAt, chatGroupUserMemberships.joinedAt),
          or(
            isNull(chatGroupUserMemberships.removedAt),
            gte(chatGroupUserMemberships.removedAt, messages.createdAt),
          ),
        ),
      )
      .innerJoin(users, eq(users.id, messages.userId))
      .where(
        and(
          eq(messages.role, 'user'),
          isNotNull(messages.content),
          sql<boolean>`length(trim(${messages.content})) > 0`,
          isNull(messages.workspaceId),
          isNull(messages.agentId),
          isNull(messages.sessionId),
          isNull(messages.threadId),
          isNull(messages.messageGroupId),
          isNull(messages.model),
          isNull(messages.provider),
          isNull(messages.tools),
          notExists(
            this.db
              .select({ fileId: messagesFiles.fileId })
              .from(messagesFiles)
              .where(eq(messagesFiles.messageId, messages.id)),
          ),
        ),
      )
      .orderBy(asc(messages.createdAt), asc(messages.id))
      .limit(1000);

    return rows.flatMap<OwnerSupplementalTextMessage>((row) =>
      row.content && row.groupId && row.topicId && row.sender
        ? [
            {
              content: row.content,
              createdAt: row.createdAt,
              groupId: row.groupId,
              id: row.id,
              role: 'user',
              sender: row.sender,
              topicId: row.topicId,
              updatedAt: row.updatedAt,
            },
          ]
        : [],
    );
  };

  listAccessibleTopics = async (
    actorUserId: string,
    groupId: string,
    options: GroupConversationPageOptions = {},
  ): Promise<GroupConversationPage<AccessibleConversationTopic>> => {
    const limit = pageLimit(options.limit);
    const rows = await this.db
      .select({
        createdAt: topics.createdAt,
        groupId: chatGroups.id,
        id: topics.id,
        title: topics.title,
      })
      .from(chatGroups)
      .leftJoin(chatGroupUserMemberships, this.activeMembershipJoin(actorUserId))
      .leftJoin(
        topics,
        and(
          eq(topics.groupId, chatGroups.id),
          eq(topics.userId, chatGroups.userId),
          isNull(topics.workspaceId),
          this.visibleSinceCurrentMembership(actorUserId, topics.createdAt),
          afterTopicCursor(options.cursor),
        ),
      )
      .where(this.accessibleGroupWhere(actorUserId, groupId))
      .orderBy(asc(topics.createdAt), asc(topics.id))
      .limit(limit + 1);

    if (rows.length === 0) throw new GroupConversationAccessUnavailableError();

    const items = rows.flatMap<AccessibleConversationTopic>((row) =>
      row.id && row.createdAt ? [{ createdAt: row.createdAt, id: row.id, title: row.title }] : [],
    );

    return toPage(items, limit);
  };

  listAccessibleTextMessages = async (
    actorUserId: string,
    groupId: string,
    topicId: string,
    options: GroupConversationPageOptions = {},
  ): Promise<GroupConversationPage<AccessibleTextMessage>> => {
    const limit = pageLimit(options.limit);
    const rawCursor = options.cursor
      ? await this.resolveAccessibleTextCursor(actorUserId, groupId, topicId, options.cursor)
      : undefined;
    const rows = await this.db
      .select({
        authorUserId: messages.userId,
        content: messages.content,
        createdAt: messages.createdAt,
        groupId: chatGroups.id,
        id: messages.id,
        ownerUserId: chatGroups.userId,
        topicId: topics.id,
      })
      .from(topics)
      .innerJoin(chatGroups, eq(chatGroups.id, topics.groupId))
      .leftJoin(chatGroupUserMemberships, this.activeMembershipJoin(actorUserId))
      .leftJoin(
        messages,
        and(
          eq(messages.groupId, chatGroups.id),
          eq(messages.topicId, topics.id),
          eq(messages.role, 'user'),
          isNotNull(messages.content),
          sql<boolean>`length(trim(${messages.content})) > 0`,
          isNull(messages.workspaceId),
          this.visibleSinceCurrentMembership(actorUserId, messages.createdAt),
          afterMessageCursor(rawCursor),
          notExists(
            this.db
              .select({ fileId: messagesFiles.fileId })
              .from(messagesFiles)
              .where(eq(messagesFiles.messageId, messages.id)),
          ),
        ),
      )
      .where(
        and(
          this.accessibleGroupWhere(actorUserId, groupId),
          eq(topics.id, topicId),
          eq(topics.userId, chatGroups.userId),
          isNull(topics.workspaceId),
          this.visibleSinceCurrentMembership(actorUserId, topics.createdAt),
        ),
      )
      .orderBy(asc(messages.createdAt), asc(messages.id))
      .limit(limit + 1);

    if (rows.length === 0) throw new GroupConversationAccessUnavailableError();

    const internalItems = rows.flatMap((row) =>
      row.id && row.content && row.createdAt && row.authorUserId && row.groupId && row.ownerUserId
        ? [
            {
              authorUserId: row.authorUserId,
              content: row.content,
              createdAt: row.createdAt,
              groupId: row.groupId,
              id: row.id,
              ownerUserId: row.ownerUserId,
              topicId: row.topicId,
            },
          ]
        : [],
    );

    const result = toPage(internalItems, limit);
    const lastVisibleItem = result.items.at(-1);
    return {
      items: result.items.map((item) => ({
        authorKind: messageAuthorKind(actorUserId, item.ownerUserId, item.authorUserId),
        content: item.content,
        publicMessageId: textMessagePublicId(
          item.ownerUserId,
          item.groupId,
          item.topicId,
          item.id,
        ),
        topicId: item.topicId,
        visibleAt: item.createdAt,
      })),
      nextCursor:
        result.nextCursor && lastVisibleItem
          ? {
              createdAt: result.nextCursor.createdAt,
              id: textMessagePublicId(
                lastVisibleItem.ownerUserId,
                lastVisibleItem.groupId,
                lastVisibleItem.topicId,
                result.nextCursor.id,
              ),
            }
          : null,
    };
  };

  /**
   * Returns only server-published final assistant text for an active member.
   * The durable operation marker is the authority; message role or metadata
   * alone can never make browser-created content visible through this path.
   */
  listAccessiblePublishedAssistantMessages = async (
    actorUserId: string,
    groupId: string,
    topicId: string,
  ): Promise<AccessiblePublishedAssistantMessage[]> =>
    this.db.transaction(async (tx) => {
      const principal = await resolveLockedPrincipal(tx, actorUserId, groupId);
      if (principal.kind !== 'member') throw new GroupConversationAccessUnavailableError();

      const [topic] = await tx
        .select({ id: topics.id })
        .from(topics)
        .where(
          and(
            eq(topics.id, topicId),
            eq(topics.groupId, principal.groupId),
            eq(topics.userId, principal.resourceOwnerUserId),
            isNull(topics.workspaceId),
          ),
        )
        .limit(1);
      if (!topic) throw new GroupConversationAccessUnavailableError();

      const rows = await tx
        .select({
          content: messages.content,
          messageId: messages.id,
          metadata: agentOperations.metadata,
          operationId: agentOperations.id,
          topicId: messages.topicId,
        })
        .from(agentOperations)
        .innerJoin(
          chatGroupUserMemberships,
          and(
            eq(chatGroupUserMemberships.chatGroupId, principal.groupId),
            eq(chatGroupUserMemberships.userId, principal.actorUserId),
            eq(chatGroupUserMemberships.role, 'member'),
            eq(chatGroupUserMemberships.membershipVersion, principal.membershipVersion),
            isNull(chatGroupUserMemberships.removedAt),
          ),
        )
        .innerJoin(
          messages,
          and(
            eq(
              messages.id,
              sql<string>`${agentOperations.metadata}->'hostedGroupMemberFinal'->>'assistantMessageId'`,
            ),
            eq(messages.userId, principal.resourceOwnerUserId),
            eq(messages.groupId, principal.groupId),
            eq(messages.topicId, topic.id),
            eq(messages.role, 'assistant'),
            isNotNull(messages.content),
            sql<boolean>`length(trim(${messages.content})) > 0`,
            isNull(messages.workspaceId),
            isNull(messages.threadId),
            isNull(messages.sessionId),
            isNull(messages.messageGroupId),
            isNull(messages.error),
            isNull(messages.tools),
            notExists(
              tx
                .select({ fileId: messagesFiles.fileId })
                .from(messagesFiles)
                .where(eq(messagesFiles.messageId, messages.id)),
            ),
          ),
        )
        .where(
          and(
            eq(agentOperations.userId, principal.resourceOwnerUserId),
            eq(agentOperations.chatGroupId, principal.groupId),
            eq(agentOperations.topicId, topic.id),
            isNull(agentOperations.workspaceId),
            isNull(agentOperations.parentOperationId),
            eq(agentOperations.status, 'done'),
            eq(agentOperations.completionReason, 'done'),
            isNull(agentOperations.error),
            isNull(agentOperations.interruption),
            sql<boolean>`${agentOperations.metadata}->'hostedGroupMemberFinal'->>'ownerUserIdSnapshot' = ${principal.resourceOwnerUserId}`,
            sql<boolean>`${agentOperations.metadata}->'hostedGroupMemberFinal'->>'groupId' = ${principal.groupId}`,
          ),
        )
        .orderBy(desc(agentOperations.completedAt), desc(agentOperations.id))
        .limit(50);

      return rows.flatMap<AccessiblePublishedAssistantMessage>((row) => {
        const metadata = asRecord(row.metadata);
        const marker = parsePublishedAssistantMarker(metadata?.hostedGroupMemberFinal);
        const canonicalContent = row.content?.trim();
        if (
          !marker ||
          !canonicalContent ||
          !row.topicId ||
          marker.operationId !== row.operationId ||
          marker.ownerUserIdSnapshot !== principal.resourceOwnerUserId ||
          marker.groupId !== principal.groupId ||
          marker.assistantMessageId !== row.messageId ||
          marker.publishedAt < principal.joinedAt ||
          !hostedRunMatchesPublishedMarker(metadata.hostedGroupRun, marker) ||
          createHash('sha256').update(canonicalContent, 'utf8').digest('hex') !== marker.contentHash
        ) {
          return [];
        }

        return [
          {
            content: canonicalContent,
            id: publishedAssistantPublicId(
              principal.resourceOwnerUserId,
              principal.groupId,
              row.topicId,
              row.operationId,
              row.messageId,
            ),
            kind: 'assistant',
            topicId: row.topicId,
            visibleAt: marker.publishedAt,
          },
        ];
      });
    });

  createAccessibleTopic = async (
    actorUserId: string,
    unsafeInput: CreateAccessibleTopicInput,
  ): Promise<AccessibleConversationTopic> => {
    const input = parseTopicInput(unsafeInput);

    return this.db.transaction(async (tx) => {
      const principal = await resolveLockedPrincipal(tx, actorUserId, input.groupId);
      const request = requestIds('topic', principal, input.idempotencyKey, [input.title]);
      const [created] = await tx
        .insert(topics)
        .values({
          clientId: request.clientId,
          groupId: principal.groupId,
          id: request.id,
          title: input.title,
          trigger: 'chat',
          userId: principal.resourceOwnerUserId,
          workspaceId: null,
        })
        .onConflictDoNothing()
        .returning({ createdAt: topics.createdAt, id: topics.id, title: topics.title });

      if (created) return created;

      const [existing] = await tx
        .select({
          clientId: topics.clientId,
          createdAt: topics.createdAt,
          groupId: topics.groupId,
          id: topics.id,
          title: topics.title,
          userId: topics.userId,
          workspaceId: topics.workspaceId,
        })
        .from(topics)
        .where(eq(topics.id, request.id))
        .limit(1)
        .for('update');

      if (
        !existing ||
        existing.clientId !== request.clientId ||
        existing.groupId !== principal.groupId ||
        existing.title !== input.title ||
        existing.userId !== principal.resourceOwnerUserId ||
        existing.workspaceId !== null
      ) {
        throw new GroupConversationIdempotencyConflictError();
      }
      if (principal.joinedAt && existing.createdAt < principal.joinedAt) {
        throw new GroupConversationAccessUnavailableError();
      }

      return { createdAt: existing.createdAt, id: existing.id, title: existing.title };
    });
  };

  createAccessibleTextMessage = async (
    actorUserId: string,
    unsafeInput: CreateAccessibleTextMessageInput,
  ): Promise<AccessibleTextMessage> => {
    const input = parseTextMessageInput(unsafeInput);

    return this.db.transaction(async (tx) => {
      const principal = await resolveLockedPrincipal(tx, actorUserId, input.groupId);
      const [topic] = await tx
        .select({ createdAt: topics.createdAt, id: topics.id })
        .from(topics)
        .where(
          and(
            eq(topics.id, input.topicId),
            eq(topics.groupId, principal.groupId),
            eq(topics.userId, principal.resourceOwnerUserId),
            isNull(topics.workspaceId),
            principal.joinedAt ? gte(topics.createdAt, principal.joinedAt) : undefined,
          ),
        )
        .limit(1)
        .for('update');

      if (!topic) throw new GroupConversationAccessUnavailableError();

      const request = requestIds('message', principal, input.idempotencyKey, [
        topic.id,
        input.content,
      ]);
      const [created] = await tx
        .insert(messages)
        .values({
          clientId: request.clientId,
          content: input.content,
          groupId: principal.groupId,
          id: request.id,
          role: 'user',
          topicId: topic.id,
          userId: principal.actorUserId,
          workspaceId: null,
        })
        .onConflictDoNothing()
        .returning({
          authorUserId: messages.userId,
          content: messages.content,
          createdAt: messages.createdAt,
          id: messages.id,
          topicId: messages.topicId,
        });

      if (created?.content && created.topicId) {
        return {
          authorKind: 'self',
          content: created.content,
          publicMessageId: textMessagePublicId(
            principal.resourceOwnerUserId,
            principal.groupId,
            created.topicId,
            created.id,
          ),
          topicId: created.topicId,
          visibleAt: created.createdAt,
        };
      }

      const [existing] = await tx
        .select({
          clientId: messages.clientId,
          content: messages.content,
          createdAt: messages.createdAt,
          groupId: messages.groupId,
          id: messages.id,
          role: messages.role,
          topicId: messages.topicId,
          userId: messages.userId,
          workspaceId: messages.workspaceId,
        })
        .from(messages)
        .where(eq(messages.id, request.id))
        .limit(1)
        .for('update');

      if (
        !existing ||
        existing.clientId !== request.clientId ||
        existing.content !== input.content ||
        existing.groupId !== principal.groupId ||
        existing.role !== 'user' ||
        existing.topicId !== topic.id ||
        existing.userId !== principal.actorUserId ||
        existing.workspaceId !== null
      ) {
        throw new GroupConversationIdempotencyConflictError();
      }
      if (principal.joinedAt && existing.createdAt < principal.joinedAt) {
        throw new GroupConversationAccessUnavailableError();
      }

      return {
        authorKind: 'self',
        content: existing.content,
        publicMessageId: textMessagePublicId(
          principal.resourceOwnerUserId,
          principal.groupId,
          existing.topicId,
          existing.id,
        ),
        topicId: existing.topicId,
        visibleAt: existing.createdAt,
      };
    });
  };
}
