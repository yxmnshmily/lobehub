import { createHash } from 'node:crypto';

import { GROUP_RECENT_MESSAGE_LIMIT } from '@lobechat/const';
import type { LobeChatDatabase, Transaction } from '@lobechat/database';
import {
  agentOperations,
  agents,
  chatGroups,
  chatGroupsAgents,
  chatGroupUserMemberships,
  files,
  messageGroups,
  messages,
  messagesFiles,
  topics,
  users,
  works,
  workVersions,
} from '@lobechat/database/schemas';
import type { ChatFileItem, ChatImageItem, ChatTopic, UIChatMessage } from '@lobechat/types';
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import { escapeRegExp } from 'es-toolkit';

import { getFileProxyUrl } from '@/server/services/file';
import { parseHostedGroupRunSnapshot } from '@/server/services/platformUsageBilling/hostedGroupOperationAccess';
import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@/server/services/user/travelServiceGroup';

import type { ExecutionMessageInput } from './executionMessages';
import { readExecutionMessages, recoverExecutionMessageIds } from './executionMessages';
import type { GroupConversationPrincipal } from './principal';
import {
  GroupConversationAccessUnavailableError,
  resolveGroupConversationPrincipal,
} from './principal';

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
  direction?: 'latest' | 'oldest';
  keywords?: string;
  limit?: number;
  recent?: boolean;
};

export type CreateAccessibleTopicInput = {
  groupId: string;
  idempotencyKey: string;
  title: string;
};

export type CreateAccessibleTextMessageInput = {
  fileIds?: string[];
  content: string;
  groupId: string;
  idempotencyKey: string;
  topicId: string;
};

export type AccessibleConversationTopic = {
  businessAssociations?: ChatTopic['businessAssociations'];
  cost?: number | null;
  favorite?: boolean | null;
  updatedAt?: Date;
  status?: typeof topics.$inferSelect.status;
  trigger?: string | null;
  latestMessage?: string;
  latestMessageId?: string;
  createdAt: Date;
  id: string;
  title: string | null;
};

export type AccessibleTextMessage = {
  authorKind: 'member' | 'owner' | 'self';
  content: string;
  fileList?: ChatFileItem[];
  imageList?: ChatImageItem[];
  publicMessageId: string;
  sender?: { avatar: string | null; fullName: string | null; id: string };
  topicId: string;
  visibleAt: Date;
};

export type AccessiblePublishedAssistantMessage = {
  agentId?: string | null;
  content: string;
  executionMessages?: UIChatMessage[];
  fileList?: ChatFileItem[];
  imageList?: ChatImageItem[];
  id: string;
  isGenerating?: boolean;
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

const beforeTopicCursor = (cursor?: GroupConversationCursor) =>
  cursor
    ? or(
        lt(topics.createdAt, cursor.createdAt),
        and(eq(topics.createdAt, cursor.createdAt), lt(topics.id, cursor.id)),
      )
    : undefined;

const afterMessageCursor = (cursor?: GroupConversationCursor) =>
  cursor
    ? or(
        gt(messages.createdAt, cursor.createdAt),
        and(eq(messages.createdAt, cursor.createdAt), gt(messages.id, cursor.id)),
      )
    : undefined;

const beforeMessageCursor = (cursor?: GroupConversationCursor) =>
  cursor
    ? or(
        lt(messages.createdAt, cursor.createdAt),
        and(eq(messages.createdAt, cursor.createdAt), lt(messages.id, cursor.id)),
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
  const record = assertExactObject(input, [
    'content',
    'groupId',
    'idempotencyKey',
    'topicId',
    'fileIds',
  ]);
  const idempotencyKey = requiredString(
    record,
    'idempotencyKey',
    GROUP_CONVERSATION_IDEMPOTENCY_KEY_MAX,
  );
  if (!/^[\x20-\x7E]+$/.test(idempotencyKey)) return invalidInput();

  const fileIds = record.fileIds;
  if (
    fileIds !== undefined &&
    (!Array.isArray(fileIds) ||
      fileIds.length > 20 ||
      fileIds.some((id) => typeof id !== 'string' || !id || id.length > 255))
  )
    return invalidInput();
  return {
    content: requiredString(record, 'content', GROUP_CONVERSATION_TEXT_MAX),
    ...(fileIds ? { fileIds: [...new Set(fileIds as string[])] } : {}),
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
    PUBLISHED_ASSISTANT_MARKER_KEYS.some((key) => !(key in marker)) ||
    Object.keys(marker).some(
      (key) =>
        key !== 'executionMessageIds' && !PUBLISHED_ASSISTANT_MARKER_KEYS.includes(key as never),
    ) ||
    (marker.executionMessageIds !== undefined &&
      (!Array.isArray(marker.executionMessageIds) ||
        marker.executionMessageIds.length === 0 ||
        marker.executionMessageIds.some((id) => typeof id !== 'string' || !id.trim()) ||
        marker.executionMessageIds.at(-1) !== marker.assistantMessageId ||
        new Set(marker.executionMessageIds).size !== marker.executionMessageIds.length))
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
    executionMessageIds: marker.executionMessageIds as string[] | undefined,
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

const projectAttachments = (
  items: Array<{ id: string; name: string; fileType: string; size: number }>,
) =>
  items.length
    ? {
        fileList: items
          .filter((file) => !file.fileType.startsWith('image/'))
          .map(({ id, name, fileType, size }) => ({
            id,
            name,
            fileType,
            size,
            url: getFileProxyUrl(id),
            downloadUrl: `${getFileProxyUrl(id)}?download=1`,
          })),
        imageList: items
          .filter((file) => file.fileType.startsWith('image/'))
          .map(({ id, name }) => ({
            id,
            alt: name,
            url: getFileProxyUrl(id),
          })),
      }
    : {};

export class GroupConversationAccessRepository {
  constructor(private readonly db: LobeChatDatabase) {}

  /** Read-only resource access derived from an accessible, still-current publication. */
  resolvePublishedResource = async (
    actorUserId: string,
    type: 'document' | 'file',
    resourceId: string,
  ) => {
    const candidates = await this.db
      .select({
        groupId: agentOperations.chatGroupId,
        ownerId: works.userId,
        workId: works.id,
        versionId: workVersions.id,
      })
      .from(works)
      .innerJoin(workVersions, eq(workVersions.id, works.currentVersionId))
      .innerJoin(
        agentOperations,
        and(
          eq(agentOperations.id, workVersions.rootOperationId),
          eq(agentOperations.userId, works.userId),
        ),
      )
      .innerJoin(
        chatGroupUserMemberships,
        and(
          eq(chatGroupUserMemberships.chatGroupId, agentOperations.chatGroupId),
          eq(chatGroupUserMemberships.userId, actorUserId),
          isNull(chatGroupUserMemberships.removedAt),
        ),
      )
      .where(
        and(
          eq(works.resourceType, type),
          isNull(works.workspaceId),
          isNull(works.deletedAt),
          type === 'document'
            ? eq(works.resourceId, resourceId)
            : sql<boolean>`${workVersions.metadata}->>'fileId' = ${resourceId}`,
        ),
      );
    for (const candidate of candidates) {
      if (!candidate.groupId) continue;
      try {
        const published = await this.listAccessiblePublishedAssistantMessages(
          actorUserId,
          candidate.groupId,
        );
        const publication = published.find((message) =>
          message.executionMessages?.some((step) =>
            step.works?.some(
              (work) => work.id === candidate.workId && work.event.id === candidate.versionId,
            ),
          ),
        );
        if (publication) return { ownerId: candidate.ownerId, publishedAt: publication.visibleAt };
      } catch (error) {
        if (!(error instanceof GroupConversationAccessUnavailableError)) throw error;
      }
    }
    return undefined;
  };

  updateAccessibleTextMessage = async (
    actorUserId: string,
    input: { groupId: string; publicMessageId: string; visibleAt: Date; content: string | null },
  ): Promise<void> =>
    this.db.transaction(async (tx) => {
      const principal = await resolveLockedPrincipal(tx, actorUserId, input.groupId);
      const content = input.content === null ? '消息已撤回' : input.content.trim();
      if (!content || content.length > GROUP_CONVERSATION_TEXT_MAX) return invalidInput();
      const candidates = await tx
        .select({ id: messages.id, topicId: messages.topicId })
        .from(messages)
        .where(
          and(
            eq(messages.groupId, principal.groupId),
            eq(messages.userId, actorUserId),
            eq(messages.role, 'user'),
            isNull(messages.workspaceId),
            gte(messages.createdAt, input.visibleAt),
            lt(messages.createdAt, new Date(input.visibleAt.getTime() + 1)),
            principal.joinedAt ? gte(messages.createdAt, principal.joinedAt) : undefined,
          ),
        )
        .for('update');
      const message = candidates.find(
        (row) =>
          row.topicId &&
          textMessagePublicId(
            principal.resourceOwnerUserId,
            principal.groupId,
            row.topicId,
            row.id,
          ) === input.publicMessageId,
      );
      if (!message) throw new GroupConversationAccessUnavailableError();
      if (input.content === null) {
        await tx.delete(messagesFiles).where(eq(messagesFiles.messageId, message.id));
      }
      await tx
        .update(messages)
        .set({ content, updatedAt: new Date() })
        .where(eq(messages.id, message.id));
    });

  listAccessibleTasks = async (
    actorUserId: string,
    groupId: string,
    offset = 0,
    category: 'all' | 'running' | 'success' | 'failed' | 'error' | 'usage' = 'all',
  ) =>
    this.db.transaction(async (tx) => {
      const principal = await resolveLockedPrincipal(tx, actorUserId, groupId);
      const rows = await tx
        .select({
          id: agentOperations.id,
          status: agentOperations.status,
          createdAt: agentOperations.createdAt,
          startedAt: agentOperations.startedAt,
          completedAt: agentOperations.completedAt,
          completionReason: agentOperations.completionReason,
          totalCost: agentOperations.totalCost,
          currency: agentOperations.currency,
          totalTokens: agentOperations.totalTokens,
          totalInputTokens: agentOperations.totalInputTokens,
          totalOutputTokens: agentOperations.totalOutputTokens,
          processingTimeMs: agentOperations.processingTimeMs,
          stepCount: agentOperations.stepCount,
          llmCalls: agentOperations.llmCalls,
          toolCalls: agentOperations.toolCalls,
          model: agentOperations.model,
          provider: agentOperations.provider,
          agentName: sql<
            string | null
          >`coalesce(nullif(trim(${agents.name}), ''), ${agents.title})`,
          topicId: topics.id,
          topicTitle: topics.title,
          // Do not return provider payloads, credentials, stack traces or arbitrary error text.
          errorCode: sql<string | null>`case
            when ${agentOperations.error} is null and ${agentOperations.status} != 'error' then null
            when ${agentOperations.error}->>'type' = '429' then 'rate_limit'
            when ${agentOperations.error}->>'type' in ('401', '403') then 'authentication'
            when ${agentOperations.error}->>'type' in ('408', '504', 'TimeoutError') then 'timeout'
            when ${agentOperations.error}->>'type' in ('500', '502', '503') then 'unavailable'
            else 'execution_error' end`,
        })
        .from(agentOperations)
        .leftJoin(
          agents,
          and(
            eq(agents.id, agentOperations.agentId),
            eq(agents.userId, principal.resourceOwnerUserId),
            isNull(agents.workspaceId),
          ),
        )
        .leftJoin(
          topics,
          and(
            eq(topics.id, agentOperations.topicId),
            eq(topics.groupId, principal.groupId),
            eq(topics.userId, principal.resourceOwnerUserId),
            isNull(topics.workspaceId),
            isNull(topics.deletedAt),
            principal.joinedAt ? gte(topics.createdAt, principal.joinedAt) : undefined,
          ),
        )
        .where(
          and(
            eq(agentOperations.chatGroupId, principal.groupId),
            eq(agentOperations.userId, principal.resourceOwnerUserId),
            isNull(agentOperations.workspaceId),
            isNull(agentOperations.parentOperationId),
            gte(agentOperations.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
            principal.joinedAt ? gte(agentOperations.createdAt, principal.joinedAt) : undefined,
            category === 'running'
              ? inArray(agentOperations.status, [
                  'idle',
                  'running',
                  'waiting_for_human',
                  'waiting_for_async_tool',
                ])
              : undefined,
            category === 'success'
              ? and(
                  eq(agentOperations.status, 'done'),
                  or(
                    isNull(agentOperations.completionReason),
                    eq(agentOperations.completionReason, 'done'),
                  ),
                )
              : undefined,
            category === 'failed'
              ? or(
                  inArray(agentOperations.status, ['error', 'interrupted', 'abandoned']),
                  inArray(agentOperations.completionReason, [
                    'cost_limit',
                    'max_steps',
                    'lease_expired',
                  ]),
                )
              : undefined,
            category === 'error'
              ? or(isNotNull(agentOperations.error), eq(agentOperations.status, 'error'))
              : undefined,
            category === 'usage'
              ? or(isNotNull(agentOperations.totalCost), isNotNull(agentOperations.totalTokens))
              : undefined,
          ),
        )
        .orderBy(desc(agentOperations.createdAt), desc(agentOperations.id))
        .limit(51)
        .offset(offset);
      return {
        items: rows.slice(0, 50).map((row) => ({
          ...row,
          totalCost: row.totalCost === null ? null : Number(row.totalCost),
          id: createHash('sha256')
            .update(JSON.stringify([groupId, row.id]))
            .digest('hex'),
          status: row.status,
          createdAt: row.createdAt,
        })),
        nextOffset: rows.length > 50 ? offset + 50 : null,
      };
    });

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
    topicId: string | undefined,
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
          or(
            sql<boolean>`${messages.metadata}->>'groupSharedAttachments' = 'true'`,
            notExists(
              this.db
                .select({ fileId: messagesFiles.fileId })
                .from(messagesFiles)
                .where(eq(messagesFiles.messageId, messages.id)),
            ),
          ),
        ),
      )
      .where(
        and(
          this.accessibleGroupWhere(actorUserId, groupId),
          topicId ? eq(topics.id, topicId) : undefined,
          eq(topics.userId, chatGroups.userId),
          isNull(topics.workspaceId),
          topicId ? this.visibleSinceCurrentMembership(actorUserId, topics.createdAt) : undefined,
        ),
      );

    const match = rows.find(
      (row) => textMessagePublicId(row.ownerUserId, row.groupId, row.topicId, row.id) === cursor.id,
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
   * author is a known human member of this group. Departure and rejoining must
   * not hide their earlier messages from the owner. Owner-authored
   * and AI rows continue through the normal MessageModel path.
   */
  listOwnerSupplementalTextMessages = async (
    ownerUserId: string,
    groupId: string,
    topicId: string | undefined,
    page: { limit: number; offset: number } = { limit: 1000, offset: 0 },
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
          topicId ? eq(topics.id, topicId) : undefined,
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
          or(
            sql<boolean>`${messages.metadata}->>'groupSharedAttachments' = 'true'`,
            notExists(
              this.db
                .select({ fileId: messagesFiles.fileId })
                .from(messagesFiles)
                .where(eq(messagesFiles.messageId, messages.id)),
            ),
          ),
        ),
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(page.limit)
      .offset(page.offset);

    return rows.reverse().flatMap<OwnerSupplementalTextMessage>((row) =>
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

  /** Batched, group-scoped relations: shared conversations must not expose another group's work. */
  private topicBusinessAssociations = async (ownerId: string, groupId: string, ids: string[]) => {
    if (!ids.length) return new Map<string, NonNullable<ChatTopic['businessAssociations']>>();
    const { rows } = await this.db.execute<{
      topic_id: string;
      id: string;
      kind: 'goal' | 'task' | 'project';
      title: string;
    }>(sql`
      WITH RECURSIVE visible_tasks AS (
        SELECT id, name, identifier, parent_task_id, project_id, context FROM tasks
        WHERE created_by_user_id = ${ownerId} AND workspace_id IS NULL AND deleted_at IS NULL
          AND config->>'groupId' = ${groupId}
      ), topic_tasks AS (
        SELECT tt.topic_id, t.id FROM task_topics tt JOIN visible_tasks t ON t.id = tt.task_id
        WHERE tt.user_id = ${ownerId} AND tt.workspace_id IS NULL AND ${inArray(sql`tt.topic_id`, ids)}
        UNION
        SELECT t.context->'origin'->>'topicId', t.id FROM visible_tasks t
        WHERE ${inArray(sql`t.context->'origin'->>'topicId'`, ids)}
        UNION
        SELECT r.topic_id, p.id FROM topic_tasks r JOIN visible_tasks t ON t.id = r.id
          JOIN visible_tasks p ON p.id = t.parent_task_id
      ), visible_goals AS (
        SELECT id, title, subject_type, subject_id, project_id, config FROM goals
        WHERE user_id = ${ownerId} AND workspace_id IS NULL AND deleted_at IS NULL
          AND config->>'groupId' = ${groupId}
      ), topic_goals AS (
        SELECT r.topic_id, g.id FROM topic_tasks r
        JOIN visible_goals g ON (g.subject_type = 'task' AND g.subject_id = r.id)
          OR EXISTS (SELECT 1 FROM goal_nodes n WHERE n.goal_id = g.id AND n.task_id = r.id)
        UNION
        SELECT g.config->'origin'->>'topicId', g.id FROM visible_goals g
          WHERE ${inArray(sql`g.config->'origin'->>'topicId'`, ids)}
        UNION
        SELECT g.subject_id, g.id FROM visible_goals g
          WHERE g.subject_type = 'topic' AND ${inArray(sql`g.subject_id`, ids)}
      ), topic_projects AS (
        SELECT id AS topic_id, project_id FROM topics WHERE ${inArray(sql`id`, ids)}
        UNION
        SELECT r.topic_id, t.project_id FROM topic_tasks r JOIN visible_tasks t ON t.id = r.id
        UNION
        SELECT r.topic_id, g.project_id FROM topic_goals r JOIN visible_goals g ON g.id = r.id
      )
      SELECT r.topic_id, t.id, 'task' AS kind, coalesce(nullif(t.name, ''), t.identifier) AS title
        FROM topic_tasks r JOIN visible_tasks t ON t.id = r.id
      UNION
      SELECT r.topic_id, g.id, 'goal' AS kind, g.title FROM topic_goals r JOIN visible_goals g ON g.id = r.id
      UNION
      SELECT r.topic_id, p.id, 'project' AS kind, p.name FROM topic_projects r JOIN projects p ON p.id = r.project_id
        WHERE p.user_id = ${ownerId} AND p.workspace_id IS NULL AND p.deleted_at IS NULL
      ORDER BY kind, title, id
    `);
    const result = new Map<string, NonNullable<ChatTopic['businessAssociations']>>();
    for (const { topic_id, ...association } of rows) {
      const items = result.get(topic_id) ?? [];
      items.push(association);
      result.set(topic_id, items);
    }
    return result;
  };

  listAccessibleTopics = async (
    actorUserId: string,
    groupId: string,
    options: GroupConversationPageOptions = {},
  ): Promise<GroupConversationPage<AccessibleConversationTopic> & { totalCount?: number }> => {
    const limit = options.recent
      ? Math.min(pageLimit(options.limit), 20)
      : pageLimit(options.limit);
    // Search and previews share the same visibility boundary; private threads,
    // other groups and pre-membership content cannot become search side channels.
    const visibleRequest = and(
      eq(messages.groupId, chatGroups.id),
      eq(messages.topicId, topics.id),
      eq(messages.role, 'user'),
      isNull(messages.threadId),
      isNull(messages.workspaceId),
      sql<boolean>`length(trim(${messages.content})) > 0`,
      this.visibleSinceCurrentMembership(actorUserId, messages.createdAt),
      or(
        sql<boolean>`${messages.metadata}->>'groupSharedAttachments' = 'true'`,
        notExists(
          this.db
            .select({ fileId: messagesFiles.fileId })
            .from(messagesFiles)
            .where(eq(messagesFiles.messageId, messages.id)),
        ),
      ),
    );
    const latestRequest = this.db
      .select({ id: messages.id, content: messages.content, createdAt: messages.createdAt })
      .from(messages)
      .where(visibleRequest)
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(1)
      .as('latest_request');
    const rows = await this.db
      .select({
        // Window count uses the same visibility joins, before the preview limit.
        totalCount: options.recent
          ? sql<number>`count(${topics.id}) over ()`.mapWith(Number)
          : sql<number>`0`,
        latestMessage: latestRequest.content,
        latestMessageId: latestRequest.id,
        ownerId: chatGroups.userId,
        createdAt: topics.createdAt,
        updatedAt: topics.updatedAt,
        favorite: topics.favorite,
        totalCost: topics.totalCost,
        status: topics.status,
        trigger: topics.trigger,
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
          isNull(topics.deletedAt),
          this.visibleSinceCurrentMembership(actorUserId, topics.createdAt),
          options.keywords
            ? or(
                sql<boolean>`strpos(lower(${topics.title}), lower(${options.keywords})) > 0`,
                exists(
                  this.db
                    .select({ id: messages.id })
                    .from(messages)
                    .where(
                      and(
                        visibleRequest,
                        sql<boolean>`strpos(lower(${messages.content}), lower(${options.keywords})) > 0`,
                      ),
                    ),
                ),
              )
            : undefined,
          options.recent
            ? undefined
            : options.direction === 'latest'
              ? beforeTopicCursor(options.cursor)
              : afterTopicCursor(options.cursor),
        ),
      )
      .leftJoinLateral(latestRequest, options.recent ? sql`true` : sql`false`)
      .where(this.accessibleGroupWhere(actorUserId, groupId))
      .orderBy(
        ...(options.recent
          ? [desc(sql`coalesce(${latestRequest.createdAt}, ${topics.updatedAt})`), desc(topics.id)]
          : options.direction === 'latest'
            ? [desc(topics.createdAt), desc(topics.id)]
            : [asc(topics.createdAt), asc(topics.id)]),
      )
      .limit(options.recent ? limit : limit + 1);

    if (rows.length === 0) throw new GroupConversationAccessUnavailableError();

    const items = rows.flatMap<AccessibleConversationTopic>((row) => {
      if (!row.id || !row.createdAt) return [];
      return [
        {
          createdAt: row.createdAt,
          updatedAt: row.updatedAt ?? row.createdAt,
          ...(actorUserId === row.ownerId ? { favorite: row.favorite } : {}),
          cost: row.totalCost == null ? null : Number(row.totalCost),
          status: row.status,
          trigger: row.trigger,
          id: row.id,
          title: row.title,
          ...(options.recent && row.latestMessage && row.latestMessageId
            ? {
                latestMessage: row.latestMessage.trim().replaceAll(/\s+/g, ' ').slice(0, 200),
                latestMessageId:
                  actorUserId === row.ownerId
                    ? row.latestMessageId
                    : textMessagePublicId(row.ownerId, groupId, row.id, row.latestMessageId),
              }
            : {}),
        },
      ];
    });

    if (options.recent)
      return { items: items.slice(0, limit), nextCursor: null, totalCount: rows[0].totalCount };
    const page = toPage(items, limit);
    const associations = await this.topicBusinessAssociations(
      rows[0].ownerId,
      groupId,
      page.items.map(({ id }) => id),
    );
    return {
      ...page,
      items: page.items.map((item) => ({
        ...item,
        businessAssociations: associations.get(item.id) ?? [],
      })),
    };
  };

  listAccessibleTextMessages = async (
    actorUserId: string,
    groupId: string,
    topicId: string | undefined,
    options: GroupConversationPageOptions = {},
  ): Promise<GroupConversationPage<AccessibleTextMessage>> => {
    const limit = pageLimit(options.limit);
    const latestFirst = options.direction === 'latest';
    const rawCursor = options.cursor
      ? await this.resolveAccessibleTextCursor(actorUserId, groupId, topicId, options.cursor)
      : undefined;
    const rows = await this.db
      .select({
        authorUserId: messages.userId,
        authorAvatar: users.avatar,
        authorName: sql<
          string | null
        >`coalesce(nullif(trim(${users.fullName}), ''), nullif(trim(${users.username}), ''))`,
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
          latestFirst ? beforeMessageCursor(rawCursor) : afterMessageCursor(rawCursor),
          options.keywords
            ? sql<boolean>`strpos(lower(${messages.content}), lower(${options.keywords})) > 0`
            : undefined,
          or(
            sql<boolean>`${messages.metadata}->>'groupSharedAttachments' = 'true'`,
            notExists(
              this.db
                .select({ fileId: messagesFiles.fileId })
                .from(messagesFiles)
                .where(eq(messagesFiles.messageId, messages.id)),
            ),
          ),
        ),
      )
      .leftJoin(users, eq(users.id, messages.userId))
      .where(
        and(
          this.accessibleGroupWhere(actorUserId, groupId),
          topicId ? eq(topics.id, topicId) : undefined,
          eq(topics.userId, chatGroups.userId),
          isNull(topics.workspaceId),
          topicId ? this.visibleSinceCurrentMembership(actorUserId, topics.createdAt) : undefined,
        ),
      )
      .orderBy(
        latestFirst ? sql`${messages.createdAt} desc nulls last` : asc(messages.createdAt),
        latestFirst ? sql`${messages.id} desc nulls last` : asc(messages.id),
      )
      .limit(limit + 1);

    if (rows.length === 0) {
      if (topicId) throw new GroupConversationAccessUnavailableError();
      await resolveGroupConversationPrincipal(this.db, { actorUserId, groupId });
      return { items: [], nextCursor: null };
    }

    const internalItems = rows.flatMap((row) =>
      row.id && row.content && row.createdAt && row.authorUserId && row.groupId && row.ownerUserId
        ? [
            {
              authorUserId: row.authorUserId,
              authorAvatar: row.authorAvatar,
              authorName: row.authorName,
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
    const visibleItems = latestFirst ? [...result.items].reverse() : result.items;
    const sharedFiles = visibleItems.length
      ? await this.db
          .select({
            messageId: messages.id,
            id: files.id,
            name: files.name,
            fileType: files.fileType,
            size: files.size,
          })
          .from(messagesFiles)
          .innerJoin(messages, eq(messages.id, messagesFiles.messageId))
          .innerJoin(
            files,
            and(
              eq(files.id, messagesFiles.fileId),
              eq(files.userId, messages.userId),
              isNull(files.workspaceId),
            ),
          )
          .where(
            and(
              inArray(
                messages.id,
                visibleItems.map((item) => item.id),
              ),
              eq(messages.groupId, groupId),
              eq(messagesFiles.userId, messages.userId),
              sql<boolean>`${messages.metadata}->>'groupSharedAttachments' = 'true'`,
            ),
          )
          .orderBy(asc(files.id))
      : [];
    return {
      items: visibleItems.map((item) => ({
        authorKind: messageAuthorKind(actorUserId, item.ownerUserId, item.authorUserId),
        content: item.content,
        ...projectAttachments(sharedFiles.filter((file) => file.messageId === item.id)),
        publicMessageId: textMessagePublicId(item.ownerUserId, item.groupId, item.topicId, item.id),
        ...(item.authorName || item.authorAvatar
          ? {
              sender: {
                avatar: item.authorAvatar,
                fullName: item.authorName,
                id: createHash('sha256')
                  .update(JSON.stringify(['group-author:v1', item.groupId, item.authorUserId]))
                  .digest('hex'),
              },
            }
          : {}),
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
    topicId?: string,
    keywords?: string,
    includeInProgress = false,
    recent = false,
  ): Promise<AccessiblePublishedAssistantMessage[]> =>
    this.queryPublishedAssistantMessages(
      actorUserId,
      groupId,
      topicId,
      keywords,
      undefined,
      includeInProgress,
      recent,
    );

  /** Resolve a retry from a verified publication, never from a nearby human message. */
  getAccessiblePublishedAssistantRequest = async (
    actorUserId: string,
    groupId: string,
    publicMessageId: string,
  ): Promise<{ prompt: string; mentionedAgentIds: string[]; topicId: string }> => {
    let request: { prompt: string; mentionedAgentIds: string[]; topicId: string } | undefined;
    await this.queryPublishedAssistantMessages(
      actorUserId,
      groupId,
      undefined,
      undefined,
      (message, metadata) => {
        if (message.id !== publicMessageId) return;
        const original = asRecord(asRecord(metadata?.hostedGroupRun)?.originalRequest);
        if (
          typeof original?.prompt !== 'string' ||
          !original.prompt.trim() ||
          !Array.isArray(original.mentionedAgentIds) ||
          !original.mentionedAgentIds.every((id) => typeof id === 'string')
        )
          return;
        request = {
          prompt: original.prompt,
          mentionedAgentIds: original.mentionedAgentIds as string[],
          topicId: message.topicId,
        };
      },
    );
    if (!request) throw new GroupConversationAccessUnavailableError();
    return request;
  };

  private queryPublishedAssistantMessages = async (
    actorUserId: string,
    groupId: string,
    topicId: string | undefined,
    keywords?: string,
    onVerified?: (
      message: AccessiblePublishedAssistantMessage,
      metadata: Record<string, unknown> | undefined,
    ) => void,
    includeInProgress = false,
    recent = false,
  ): Promise<AccessiblePublishedAssistantMessage[]> =>
    this.db.transaction(async (tx) => {
      const principal = await resolveLockedPrincipal(tx, actorUserId, groupId);
      if (principal.kind !== 'member') throw new GroupConversationAccessUnavailableError();

      const [topic] = await tx
        .select({ id: topics.id })
        .from(topics)
        .where(
          and(
            topicId ? eq(topics.id, topicId) : undefined,
            eq(topics.groupId, principal.groupId),
            eq(topics.userId, principal.resourceOwnerUserId),
            isNull(topics.workspaceId),
          ),
        )
        .limit(1);
      if (!topic) {
        if (topicId) throw new GroupConversationAccessUnavailableError();
        return [];
      }

      const query = tx
        .select({
          agentId: sql<string | null>`case when exists (
            select 1 from ${chatGroupsAgents}
            where ${chatGroupsAgents.agentId} = ${messages.agentId}
              and ${chatGroupsAgents.chatGroupId} = ${principal.groupId}
              and ${chatGroupsAgents.userId} = ${principal.resourceOwnerUserId}
              and ${chatGroupsAgents.workspaceId} is null
              and ${chatGroupsAgents.enabled} = true
          ) then ${messages.agentId} else null end`,
          content: messages.content,
          createdAt: messages.createdAt,
          appContext: agentOperations.appContext,
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
            eq(messages.topicId, agentOperations.topicId),
            topicId ? eq(messages.topicId, topic.id) : undefined,
            eq(messages.role, 'assistant'),
            keywords
              ? sql<boolean>`strpos(lower(${messages.content}), lower(${keywords})) > 0`
              : undefined,
            isNotNull(messages.content),
            sql<boolean>`length(trim(${messages.content})) > 0`,
            isNull(messages.workspaceId),
            isNull(messages.threadId),
            isNull(messages.sessionId),
            // Archival changes presentation, not the verified publication's visibility.
            or(
              isNull(messages.messageGroupId),
              inArray(
                messages.messageGroupId,
                tx
                  .select({ id: messageGroups.id })
                  .from(messageGroups)
                  .where(
                    and(
                      eq(messageGroups.type, 'compression'),
                      eq(messageGroups.userId, principal.resourceOwnerUserId),
                      eq(messageGroups.topicId, messages.topicId),
                      isNull(messageGroups.workspaceId),
                    ),
                  ),
              ),
            ),
            isNull(messages.error),
            isNull(messages.tools),
          ),
        )
        .where(
          and(
            eq(agentOperations.userId, principal.resourceOwnerUserId),
            eq(agentOperations.chatGroupId, principal.groupId),
            topicId ? eq(agentOperations.topicId, topic.id) : undefined,
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
        .orderBy(desc(agentOperations.completedAt), desc(agentOperations.id));
      const rows = await (recent
        ? query.limit(GROUP_RECENT_MESSAGE_LIMIT)
        : keywords
          ? query.limit(50)
          : query);
      const attachedFiles = rows.length
        ? await tx
            .select({
              messageId: messagesFiles.messageId,
              boundUserId: messagesFiles.userId,
              id: files.id,
              userId: files.userId,
              workspaceId: files.workspaceId,
              name: files.name,
              fileType: files.fileType,
              size: files.size,
            })
            .from(messagesFiles)
            .innerJoin(files, eq(files.id, messagesFiles.fileId))
            .where(
              inArray(
                messagesFiles.messageId,
                rows.map((row) => row.messageId),
              ),
            )
            .orderBy(asc(files.id))
        : [];

      const published: AccessiblePublishedAssistantMessage[] = [];
      const executions: {
        message: AccessiblePublishedAssistantMessage;
        input: ExecutionMessageInput;
      }[] = [];
      for (const row of rows) {
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
          !hostedRunMatchesPublishedMarker(metadata?.hostedGroupRun, marker) ||
          createHash('sha256').update(canonicalContent, 'utf8').digest('hex') !== marker.contentHash
        ) {
          continue;
        }
        const attachments = attachedFiles.filter((file) => file.messageId === row.messageId);
        // Publish only files the verified final text already explicitly disclosed.
        if (
          attachments.some(
            (file) =>
              file.userId !== principal.resourceOwnerUserId ||
              file.boundUserId !== principal.resourceOwnerUserId ||
              file.workspaceId !== null ||
              !new RegExp(`${escapeRegExp(getFileProxyUrl(file.id))}(?=[\\s)>?#]|$)`).test(
                canonicalContent,
              ),
          )
        )
          continue;

        const message: AccessiblePublishedAssistantMessage = {
          agentId: row.agentId,
          content: canonicalContent,
          ...projectAttachments(attachments),
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
        };
        const executionMessageIds =
          marker.executionMessageIds ??
          (!keywords && !onVerified && row.appContext?.sourceMessageId
            ? await recoverExecutionMessageIds(tx as LobeChatDatabase, {
                ownerId: principal.resourceOwnerUserId,
                groupId: principal.groupId,
                topicId: row.topicId,
                sourceMessageId: row.appContext.sourceMessageId,
                joinedAt: principal.joinedAt,
                until: row.createdAt,
              })
            : undefined);
        if (executionMessageIds?.includes(row.messageId) && !keywords && !onVerified) {
          executions.push({
            message,
            input: {
              agentId: row.agentId,
              ownerId: principal.resourceOwnerUserId,
              groupId: principal.groupId,
              topicId: row.topicId,
              operationId: row.operationId,
              ids: executionMessageIds,
              joinedAt: principal.joinedAt,
              until: marker.publishedAt,
              publicId: (id) =>
                publishedAssistantPublicId(
                  principal.resourceOwnerUserId,
                  principal.groupId,
                  row.topicId!,
                  row.operationId,
                  id,
                ),
            },
          });
        }
        onVerified?.(message, metadata);
        published.push(message);
      }
      const chains = await readExecutionMessages(
        tx as LobeChatDatabase,
        executions.map(({ input }) => input),
      );
      executions.forEach(({ message }, index) => {
        message.executionMessages = chains[index];
      });
      if (includeInProgress && !keywords && !onVerified) {
        const runningQuery = tx
          .select({
            id: agentOperations.id,
            topicId: agentOperations.topicId,
            source: agentOperations.appContext,
            metadata: agentOperations.metadata,
            startedAt: agentOperations.startedAt,
          })
          .from(agentOperations)
          .innerJoin(
            topics,
            and(
              eq(topics.id, agentOperations.topicId),
              eq(topics.groupId, principal.groupId),
              eq(topics.userId, principal.resourceOwnerUserId),
              isNull(topics.workspaceId),
              isNull(topics.deletedAt),
            ),
          )
          .where(
            and(
              eq(agentOperations.userId, principal.resourceOwnerUserId),
              eq(agentOperations.chatGroupId, principal.groupId),
              isNull(agentOperations.workspaceId),
              isNull(agentOperations.parentOperationId),
              isNull(agentOperations.threadId),
              topicId ? eq(agentOperations.topicId, topicId) : undefined,
              inArray(agentOperations.status, [
                'idle',
                'running',
                'waiting_for_async_tool',
                'waiting_for_human',
              ]),
            ),
          )
          .orderBy(desc(agentOperations.startedAt), desc(agentOperations.id));
        const running = await (recent
          ? runningQuery.limit(GROUP_RECENT_MESSAGE_LIMIT)
          : runningQuery);
        for (const run of running) {
          const binding = parseHostedGroupRunSnapshot(asRecord(run.metadata)?.hostedGroupRun);
          if (
            !binding ||
            binding.groupId !== principal.groupId ||
            binding.ownerUserIdSnapshot !== principal.resourceOwnerUserId ||
            !run.topicId ||
            !run.source?.sourceMessageId
          )
            continue;
          const scope = {
            ownerId: principal.resourceOwnerUserId,
            groupId: principal.groupId,
            topicId: run.topicId,
            sourceMessageId: run.source.sourceMessageId,
            joinedAt: principal.joinedAt,
            startedAt: run.startedAt,
            until: new Date(),
          };
          const ids = await recoverExecutionMessageIds(tx as LobeChatDatabase, scope);
          if (!ids.length) continue;
          const [executionMessages] = await readExecutionMessages(tx as LobeChatDatabase, [
            {
              ...scope,
              ids,
              operationId: run.id,
              publicId: (id) =>
                publishedAssistantPublicId(scope.ownerId, scope.groupId, scope.topicId, run.id, id),
            },
          ]);
          const last = executionMessages?.at(-1);
          if (last)
            published.push({
              content: last.content,
              executionMessages,
              id: last.id,
              isGenerating: true,
              kind: 'assistant',
              topicId: run.topicId,
              visibleAt: scope.until,
            });
        }
      }
      return published;
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

      const attached = input.fileIds?.length
        ? await tx
            .select({ id: files.id, name: files.name, fileType: files.fileType })
            .from(files)
            .where(
              and(
                inArray(files.id, input.fileIds),
                eq(files.userId, actorUserId),
                isNull(files.workspaceId),
              ),
            )
            .orderBy(asc(files.id))
        : [];
      if (attached.length !== (input.fileIds?.length ?? 0))
        throw new GroupConversationAccessUnavailableError();
      const content = [
        input.content,
        ...attached.map((file) => {
          const name = file.name.replaceAll(/[[\]\\\r\n]/g, '_');
          return `${file.fileType.startsWith('image/') ? '!' : ''}[${name}](<${getFileProxyUrl(file.id)}>)`;
        }),
      ].join('\n\n');
      const request = requestIds('message', principal, input.idempotencyKey, [topic.id, content]);
      const [created] = await tx
        .insert(messages)
        .values({
          clientId: request.clientId,
          content,
          ...(attached.length ? { metadata: { groupSharedAttachments: true } } : {}),
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
        if (attached.length)
          await tx.insert(messagesFiles).values(
            attached.map((file) => ({
              fileId: file.id,
              messageId: created.id,
              userId: actorUserId,
            })),
          );
        await tx.update(topics).set({ updatedAt: new Date() }).where(eq(topics.id, topic.id));
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
        existing.content !== content ||
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
