import { Buffer } from 'node:buffer';

import { and, count, desc, eq, gte, isNull, lt, lte, or, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { chatGroups, chatGroupsAgents } from '../schemas/chatGroup';
import { documents } from '../schemas/file';
import { travelGenerationTasks } from '../schemas/travelGeneration';
import { works } from '../schemas/work';
import type { LobeChatDatabase } from '../type';

const DEFAULT_TRAVEL_GROUP_CLIENT_ID = 'default-travel-service-group';
const DEFAULT_RECENT_LIMIT = 10;
const MAX_RECENT_LIMIT = 50;

export type PlatformTravelGroupReadiness = 'incomplete' | 'missing' | 'ready';
export type PlatformUserContentKind = 'document' | 'generation' | 'work';

export class PlatformUserContentQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformUserContentQueryError';
  }
}

export interface ListPlatformUserContentCatalogInput {
  cursor?: string;
  endAt?: Date;
  kind: PlatformUserContentKind;
  limit?: number;
  startAt?: Date;
  status?: string;
  type?: string;
}

export interface PlatformUserContentCatalogItem {
  createdAt: Date;
  filename: string | null;
  id: string;
  kind: PlatformUserContentKind;
  status: string | null;
  title: string | null;
  type: string;
  updatedAt: Date;
}

const normalizeRecentLimit = (value?: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_RECENT_LIMIT;
  return Math.min(MAX_RECENT_LIMIT, Math.max(1, Math.trunc(value!)));
};

const contentKinds = new Set<PlatformUserContentKind>(['document', 'generation', 'work']);
const contentCursorPattern = /^[\w-]{1,1024}$/;

const normalizeCatalogIdentifier = (value: string, field: string, maxLength: number): string => {
  if (typeof value !== 'string') throw new PlatformUserContentQueryError(`${field} is invalid`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new PlatformUserContentQueryError(`${field} is invalid`);
  }
  return normalized;
};

const normalizeCatalogDate = (value: Date | undefined, field: string): Date | undefined => {
  if (value === undefined) return undefined;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new PlatformUserContentQueryError(`${field} is invalid`);
  }
  return new Date(value.getTime());
};

const normalizeCatalogSummary = (value: string | null): string | null => {
  if (!value) return null;
  const normalized = value.replaceAll(/[\p{Cc}\p{Cf}]/gu, '').trim();
  return normalized ? Array.from(normalized).slice(0, 120).join('') : null;
};

const encodeContentCursor = (item: PlatformUserContentCatalogItem): string =>
  Buffer.from(JSON.stringify([item.updatedAt.toISOString(), item.id])).toString('base64url');

const decodeContentCursor = (cursor: string): { id: string; updatedAt: Date } => {
  if (!contentCursorPattern.test(cursor)) {
    throw new PlatformUserContentQueryError('cursor is invalid');
  }
  try {
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) throw new Error('non-canonical-cursor');
    const decoded: unknown = JSON.parse(bytes.toString('utf8'));
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      typeof decoded[0] !== 'string' ||
      typeof decoded[1] !== 'string' ||
      !decoded[1] ||
      decoded[1].length > 512
    ) {
      throw new Error('invalid-cursor-payload');
    }
    const updatedAt = new Date(decoded[0]);
    if (!Number.isFinite(updatedAt.getTime()) || updatedAt.toISOString() !== decoded[0]) {
      throw new Error('invalid-cursor-time');
    }
    return { id: decoded[1], updatedAt };
  } catch {
    throw new PlatformUserContentQueryError('cursor is invalid');
  }
};

const addCatalogFilters = (
  filters: SQL[],
  timestampColumn: AnyPgColumn,
  idColumn: AnyPgColumn,
  startAt: Date | undefined,
  endAt: Date | undefined,
  cursor: { id: string; updatedAt: Date } | undefined,
) => {
  if (startAt) filters.push(gte(timestampColumn, startAt));
  if (endAt) filters.push(lte(timestampColumn, endAt));
  if (cursor) {
    filters.push(
      or(
        lt(timestampColumn, cursor.updatedAt),
        and(eq(timestampColumn, cursor.updatedAt), lt(idColumn, cursor.id)),
      )!,
    );
  }
};

/**
 * Read-only administrator projection for one user's managed group and content.
 *
 * Every query selects an explicit allowlist. Prompt bodies, group instructions,
 * provider details, artifacts, document bodies, source paths and Work URLs are
 * intentionally absent from the returned contract.
 */
export class PlatformUserContentModel {
  constructor(private readonly db: LobeChatDatabase) {}

  async listContentCatalog(
    userIdValue: string,
    input: ListPlatformUserContentCatalogInput,
  ): Promise<{
    counts: { documents: number; generationTasks: number; works: number };
    items: PlatformUserContentCatalogItem[];
    nextCursor: string | null;
  }> {
    const userId = normalizeCatalogIdentifier(userIdValue, 'userId', 255);
    if (!contentKinds.has(input.kind)) {
      throw new PlatformUserContentQueryError('kind is invalid');
    }
    const limit = input.limit ?? 10;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new PlatformUserContentQueryError('limit is invalid');
    }
    const type =
      input.type === undefined ? undefined : normalizeCatalogIdentifier(input.type, 'type', 100);
    const status =
      input.status === undefined
        ? undefined
        : normalizeCatalogIdentifier(input.status, 'status', 100);
    if (input.kind === 'document' && status !== undefined) {
      throw new PlatformUserContentQueryError('status is invalid for documents');
    }
    const startAt = normalizeCatalogDate(input.startAt, 'startAt');
    const endAt = normalizeCatalogDate(input.endAt, 'endAt');
    if (startAt && endAt && startAt.getTime() > endAt.getTime()) {
      throw new PlatformUserContentQueryError('time range is invalid');
    }
    const cursor = input.cursor === undefined ? undefined : decodeContentCursor(input.cursor);

    const countsPromise = Promise.all([
      this.db
        .select({ value: count(travelGenerationTasks.id) })
        .from(travelGenerationTasks)
        .where(
          and(eq(travelGenerationTasks.userId, userId), isNull(travelGenerationTasks.workspaceId)),
        ),
      this.db
        .select({ value: count(works.id) })
        .from(works)
        .where(and(eq(works.userId, userId), isNull(works.workspaceId))),
      this.db
        .select({ value: count(documents.id) })
        .from(documents)
        .where(and(eq(documents.userId, userId), isNull(documents.workspaceId))),
    ]);

    let items: PlatformUserContentCatalogItem[];
    if (input.kind === 'generation') {
      const filters: SQL[] = [
        eq(travelGenerationTasks.userId, userId),
        isNull(travelGenerationTasks.workspaceId),
      ];
      if (type) filters.push(eq(travelGenerationTasks.type, type));
      if (status) filters.push(eq(travelGenerationTasks.status, status));
      addCatalogFilters(
        filters,
        travelGenerationTasks.updatedAt,
        travelGenerationTasks.id,
        startAt,
        endAt,
        cursor,
      );
      const rows = await this.db
        .select({
          createdAt: travelGenerationTasks.createdAt,
          id: travelGenerationTasks.id,
          status: travelGenerationTasks.status,
          type: travelGenerationTasks.type,
          updatedAt: travelGenerationTasks.updatedAt,
        })
        .from(travelGenerationTasks)
        .where(and(...filters))
        .orderBy(desc(travelGenerationTasks.updatedAt), desc(travelGenerationTasks.id))
        .limit(limit + 1);
      items = rows.map((row) => ({
        ...row,
        filename: null,
        kind: 'generation',
        title: null,
      }));
    } else if (input.kind === 'work') {
      const filters: SQL[] = [eq(works.userId, userId), isNull(works.workspaceId)];
      if (type) filters.push(eq(works.type, type as typeof works.$inferSelect.type));
      if (status) filters.push(eq(works.status, status));
      addCatalogFilters(filters, works.updatedAt, works.id, startAt, endAt, cursor);
      const rows = await this.db
        .select({
          createdAt: works.createdAt,
          id: works.id,
          status: works.status,
          title: works.title,
          type: works.type,
          updatedAt: works.updatedAt,
        })
        .from(works)
        .where(and(...filters))
        .orderBy(desc(works.updatedAt), desc(works.id))
        .limit(limit + 1);
      items = rows.map((row) => ({
        ...row,
        filename: null,
        kind: 'work',
        title: normalizeCatalogSummary(row.title),
      }));
    } else {
      const filters: SQL[] = [eq(documents.userId, userId), isNull(documents.workspaceId)];
      if (type) filters.push(eq(documents.fileType, type));
      addCatalogFilters(filters, documents.updatedAt, documents.id, startAt, endAt, cursor);
      const rows = await this.db
        .select({
          createdAt: documents.createdAt,
          filename: documents.filename,
          id: documents.id,
          title: documents.title,
          type: documents.fileType,
          updatedAt: documents.updatedAt,
        })
        .from(documents)
        .where(and(...filters))
        .orderBy(desc(documents.updatedAt), desc(documents.id))
        .limit(limit + 1);
      items = rows.map((row) => ({
        ...row,
        filename: normalizeCatalogSummary(row.filename),
        kind: 'document',
        status: null,
        title: normalizeCatalogSummary(row.title),
      }));
    }

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const [[generationCount], [workCount], [documentCount]] = await countsPromise;
    return {
      counts: {
        documents: Number(documentCount?.value ?? 0),
        generationTasks: Number(generationCount?.value ?? 0),
        works: Number(workCount?.value ?? 0),
      },
      items: page,
      nextCursor: hasMore && page.length > 0 ? encodeContentCursor(page.at(-1)!) : null,
    };
  }

  async getOverview(
    userId: string,
    options: { recentLimit?: number; travelGroupClientId?: string } = {},
  ) {
    const recentLimit = normalizeRecentLimit(options.recentLimit);
    const travelGroupClientId =
      options.travelGroupClientId?.trim() || DEFAULT_TRAVEL_GROUP_CLIENT_ID;

    const [group] = await this.db
      .select({
        config: chatGroups.config,
        content: chatGroups.content,
        id: chatGroups.id,
        title: chatGroups.title,
        updatedAt: chatGroups.updatedAt,
        visibility: chatGroups.visibility,
      })
      .from(chatGroups)
      .where(
        and(
          eq(chatGroups.userId, userId),
          eq(chatGroups.clientId, travelGroupClientId),
          isNull(chatGroups.workspaceId),
          eq(chatGroups.visibility, 'private'),
        ),
      )
      .limit(1);

    const [memberships, generationStatusRows, recentGenerationRows, recentWorks, recentDocuments] =
      await Promise.all([
        group
          ? this.db
              .select({ agentId: chatGroupsAgents.agentId, role: chatGroupsAgents.role })
              .from(chatGroupsAgents)
              .where(
                and(
                  eq(chatGroupsAgents.chatGroupId, group.id),
                  eq(chatGroupsAgents.enabled, true),
                  eq(chatGroupsAgents.userId, userId),
                  isNull(chatGroupsAgents.workspaceId),
                ),
              )
          : Promise.resolve([]),
        this.db
          .select({ count: count(travelGenerationTasks.id), status: travelGenerationTasks.status })
          .from(travelGenerationTasks)
          .where(
            and(
              eq(travelGenerationTasks.userId, userId),
              isNull(travelGenerationTasks.workspaceId),
            ),
          )
          .groupBy(travelGenerationTasks.status)
          .orderBy(travelGenerationTasks.status),
        this.db
          .select({
            createdAt: travelGenerationTasks.createdAt,
            id: travelGenerationTasks.id,
            status: travelGenerationTasks.status,
            type: travelGenerationTasks.type,
            updatedAt: travelGenerationTasks.updatedAt,
          })
          .from(travelGenerationTasks)
          .where(
            and(
              eq(travelGenerationTasks.userId, userId),
              isNull(travelGenerationTasks.workspaceId),
            ),
          )
          .orderBy(desc(travelGenerationTasks.updatedAt), desc(travelGenerationTasks.id))
          .limit(recentLimit),
        this.db
          .select({
            createdAt: works.createdAt,
            id: works.id,
            resourceType: works.resourceType,
            status: works.status,
            title: works.title,
            type: works.type,
            updatedAt: works.updatedAt,
          })
          .from(works)
          .where(and(eq(works.userId, userId), isNull(works.workspaceId)))
          .orderBy(desc(works.updatedAt), desc(works.id))
          .limit(recentLimit),
        this.db
          .select({
            createdAt: documents.createdAt,
            fileType: documents.fileType,
            id: documents.id,
            parentId: documents.parentId,
            title: documents.title,
            totalCharCount: documents.totalCharCount,
            totalLineCount: documents.totalLineCount,
            updatedAt: documents.updatedAt,
          })
          .from(documents)
          .where(and(eq(documents.userId, userId), isNull(documents.workspaceId)))
          .orderBy(desc(documents.updatedAt), desc(documents.id))
          .limit(recentLimit),
      ]);

    const generationStatusCounts = generationStatusRows.map((row) => ({
      count: Number(row.count),
      status: row.status,
    }));
    const generationTotal = generationStatusCounts.reduce((total, row) => total + row.count, 0);
    const recentGenerationTasks = recentGenerationRows.map((task) => ({ ...task, title: null }));

    if (!group) {
      return {
        generation: { statusCounts: generationStatusCounts, total: generationTotal },
        recentDocuments,
        recentGenerationTasks,
        recentWorks,
        travelGroup: {
          expectedMemberCount: 0,
          id: null,
          memberCount: 0,
          readiness: 'missing' as const,
          ready: false,
          supervisorCount: 0,
          title: null,
          updatedAt: null,
        },
      };
    }

    const slots = group.config?.memberSlots ?? [];
    const expectedMemberCount = slots.length;
    const activeAgentIds = new Set(memberships.map(({ agentId }) => agentId));
    const supervisorMemberships = memberships.filter(({ role }) => role === 'supervisor');
    const supervisorSlots = slots.filter(({ role }) => role === 'supervisor');
    const everySlotReady =
      slots.length > 0 &&
      slots.every(
        ({ agentId, status }) =>
          status === 'configured' && Boolean(agentId) && activeAgentIds.has(agentId!),
      );
    const supervisorReady =
      supervisorMemberships.length === 1 &&
      supervisorSlots.length === 1 &&
      Boolean(supervisorSlots[0].agentId) &&
      supervisorMemberships[0].agentId === supervisorSlots[0].agentId;
    const ready =
      group.visibility === 'private' &&
      Boolean(group.content?.trim()) &&
      everySlotReady &&
      supervisorReady;

    return {
      generation: { statusCounts: generationStatusCounts, total: generationTotal },
      recentDocuments,
      recentGenerationTasks,
      recentWorks,
      travelGroup: {
        expectedMemberCount,
        id: group.id,
        memberCount: memberships.length,
        readiness: (ready ? 'ready' : 'incomplete') as PlatformTravelGroupReadiness,
        ready,
        supervisorCount: supervisorMemberships.length,
        title: group.title,
        updatedAt: group.updatedAt,
      },
    };
  }
}
