import { TRPCError } from '@trpc/server';
import {
  and,
  type AnyColumn,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { z } from 'zod';

import { PlatformCreditModel } from '@/database/models/platformCredit';
import { PlatformUserContentModel } from '@/database/models/platformUserContent';
import {
  type AvailableNumber,
  type PlatformUsageMetrics,
  PlatformUserUsageModel,
} from '@/database/models/platformUserUsage';
import { asyncTasks } from '@/database/schemas/asyncTask';
import { documents } from '@/database/schemas/file';
import { generationBatches, generations, generationTopics } from '@/database/schemas/generation';
import type {
  PlatformCreditAccountItem,
  PlatformCreditEntryItem,
} from '@/database/schemas/platformCredit';
import { platformCreditEntries } from '@/database/schemas/platformCredit';
import { travelServiceOrders } from '@/database/schemas/serviceLedger';
import { travelGenerationTasks } from '@/database/schemas/travelGeneration';
import { works } from '@/database/schemas/work';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { isSafeArtifactIdentifier } from '@/server/services/travelGeneration/artifactSafety';
import {
  buildPlatformImageSettlementIdentity,
  PLATFORM_IMAGE_SETTLEMENT_GENERATION_TYPE,
} from '@/server/services/travelGeneration/platformImageSettlementIdentity';
import { buildPlatformTextSettlementIdentity } from '@/server/services/travelGeneration/platformTextSettlementIdentity';
import { toPublicTravelGenerationTask } from '@/server/services/travelGeneration/public';

const customerCenterProcedure = authedProcedure.use(serverDatabase);

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 50;
const CUSTOMER_GENERATION_TYPES = ['copy', 'document', 'image', 'video'] as const;
const CUSTOMER_RESULT_GENERATION_TYPES = ['copy', 'document', 'image'] as const;
const CUSTOMER_NATIVE_GENERATION_TYPES = ['image', 'video'] as const;
const CUSTOMER_GENERATION_STATUSES = ['failed', 'processing', 'succeeded', 'unavailable'] as const;

type CustomerGenerationType = (typeof CUSTOMER_GENERATION_TYPES)[number];
type CustomerResultGenerationType = (typeof CUSTOMER_RESULT_GENERATION_TYPES)[number];
type CustomerNativeGenerationType = (typeof CUSTOMER_NATIVE_GENERATION_TYPES)[number];
type CustomerGenerationStatusFilter = (typeof CUSTOMER_GENERATION_STATUSES)[number];

interface CustomerGenerationFilters {
  dateFrom?: Date;
  dateTo?: Date;
  status?: CustomerGenerationStatusFilter;
  type?: CustomerGenerationType;
}

const pageInput = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    dateFrom: z.string().datetime({ offset: true }).optional(),
    dateTo: z.string().datetime({ offset: true }).optional(),
    kind: z.enum(['generation', 'ledger', 'order', 'work']),
    limit: z.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
    status: z.enum(CUSTOMER_GENERATION_STATUSES).optional(),
    type: z.enum(CUSTOMER_GENERATION_TYPES).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      (input.kind === 'ledger' || input.kind === 'order') &&
      (input.dateFrom || input.dateTo || input.status || input.type)
    ) {
      context.addIssue({ code: 'custom', message: '账单分页不接受生成筛选条件' });
    }
    if (input.dateFrom && input.dateTo && new Date(input.dateFrom) > new Date(input.dateTo)) {
      context.addIssue({ code: 'custom', message: '开始日期不能晚于结束日期' });
    }
  });

interface CustomerCenterCursorItem {
  id: string;
  updatedAt: Date | string;
}

const cursorPayload = z.object({
  id: z.string().min(1).max(255),
  updatedAt: z.string().datetime({ offset: true }),
});

export const encodeCustomerCenterCursor = ({ id, updatedAt }: CustomerCenterCursorItem): string =>
  Buffer.from(
    JSON.stringify({
      id,
      updatedAt: (updatedAt instanceof Date ? updatedAt : new Date(updatedAt)).toISOString(),
    }),
  ).toString('base64url');

export const decodeCustomerCenterCursor = (cursor: string): { id: string; updatedAt: Date } => {
  try {
    const payload = cursorPayload.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()));
    return { id: payload.id, updatedAt: new Date(payload.updatedAt) };
  } catch {
    throw new TRPCError({ code: 'BAD_REQUEST', message: '分页游标无效' });
  }
};

const compareCustomerCenterRows = (
  left: CustomerCenterCursorItem,
  right: CustomerCenterCursorItem,
) => {
  const timeDelta = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  return timeDelta || right.id.localeCompare(left.id);
};

export const buildCustomerCenterPage = <T extends CustomerCenterCursorItem>(
  rows: T[],
  limit: number,
  cursor?: string,
): { items: T[]; nextCursor: null | string } => {
  const decodedCursor = cursor ? decodeCustomerCenterCursor(cursor) : undefined;
  const seenIds = new Set<string>();
  const uniqueRows = [...rows].sort(compareCustomerCenterRows).filter((row) => {
    if (seenIds.has(row.id)) return false;
    seenIds.add(row.id);
    return !decodedCursor || compareCustomerCenterRows(row, decodedCursor) > 0;
  });
  const items = uniqueRows.slice(0, limit);

  return {
    items,
    nextCursor: uniqueRows.length > limit ? encodeCustomerCenterCursor(items.at(-1)!) : null,
  };
};

const isProcessingStatus = (status: string): boolean =>
  status === 'pending' || status === 'queued' || status === 'running';

const isCustomerVisibleGeneration = ({ status, type }: { status: string; type: string }): boolean =>
  CUSTOMER_GENERATION_TYPES.includes(type as CustomerGenerationType) &&
  (type !== 'video' || status === 'failed' || status === 'unavailable');

const customerGenerationTitle: Record<CustomerGenerationType, string> = {
  copy: '文案生成',
  document: '文稿生成',
  image: '图片生成',
  video: '视频生成',
};

export const buildCustomerGenerationPage = <
  T extends CustomerCenterCursorItem & {
    createdAt: Date | string;
    status: string;
    type: string;
  },
>(
  rows: T[],
  limit: number,
  cursor?: string,
  filters: CustomerGenerationFilters = {},
) => {
  const filtered = rows
    .filter(isCustomerVisibleGeneration)
    .filter((row) => !filters.type || row.type === filters.type)
    .filter(
      (row) =>
        !filters.status ||
        (filters.status === 'processing'
          ? isProcessingStatus(row.status)
          : row.status === filters.status),
    )
    .filter((row) => !filters.dateFrom || new Date(row.updatedAt) >= filters.dateFrom)
    .filter((row) => !filters.dateTo || new Date(row.updatedAt) <= filters.dateTo)
    .map((row) => ({
      createdAt: row.createdAt,
      id: row.id,
      status: row.status,
      title: customerGenerationTitle[row.type as CustomerGenerationType],
      type: row.type as CustomerGenerationType,
      updatedAt: row.updatedAt,
    }));

  return buildCustomerCenterPage(filtered, limit, cursor);
};

interface CustomerGenerationDetailSource extends CustomerCenterCursorItem {
  artifacts?: unknown[] | null;
  code?: null | string;
  createdAt: Date | string;
  status: string;
  type: string;
  workspaceId?: null | string;
}

const safeImageSettlementGenerationIds = (task: CustomerGenerationDetailSource): string[] => {
  if (task.type !== 'image' || !Array.isArray(task.artifacts)) return [];

  return [
    ...new Set(
      task.artifacts.flatMap((artifact) => {
        if (!artifact || typeof artifact !== 'object') return [];
        const value = artifact as Record<string, unknown>;
        return value.type === 'image' && isSafeArtifactIdentifier(value.generationId)
          ? [value.generationId]
          : [];
      }),
    ),
  ];
};

interface CustomerSettlementIdentity {
  generationId: string;
  generationType: string;
}

const settlementIdentityKey = ({ generationId, generationType }: CustomerSettlementIdentity) =>
  `${generationType}\0${generationId}`;

const customerSettlementIdentities = (
  task: CustomerGenerationDetailSource,
): CustomerSettlementIdentity[] => {
  if (task.type === 'copy' || task.type === 'document') {
    return [
      buildPlatformTextSettlementIdentity(task.id),
      { generationId: task.id, generationType: task.type },
    ];
  }
  if (task.type === 'image') {
    return [
      ...safeImageSettlementGenerationIds(task).map(buildPlatformImageSettlementIdentity),
      { generationId: task.id, generationType: task.type },
    ];
  }
  return [{ generationId: task.id, generationType: task.type }];
};

const isCustomerGenerationSettled = (
  task: CustomerGenerationDetailSource,
  settledIdentities: Set<string>,
) => {
  const hasSettlement = (identity: CustomerSettlementIdentity) =>
    settledIdentities.has(settlementIdentityKey(identity));
  if (hasSettlement({ generationId: task.id, generationType: task.type })) return true;
  if (task.type === 'copy' || task.type === 'document') {
    return hasSettlement(buildPlatformTextSettlementIdentity(task.id));
  }
  if (task.type === 'image') {
    const artifactIds = safeImageSettlementGenerationIds(task);
    return (
      artifactIds.length > 0 &&
      artifactIds.every((id) => hasSettlement(buildPlatformImageSettlementIdentity(id)))
    );
  }
  return false;
};

export const projectCustomerGenerationDetail = (
  task: CustomerGenerationDetailSource,
  options: { isSettled?: boolean } = {},
) => {
  const publicTask = toPublicTravelGenerationTask({
    ...task,
    input: {},
    owner: {
      groupId: '',
      userId: '',
      workspaceId: task.workspaceId || undefined,
    },
  } as never);
  const settlementStatus =
    task.status === 'failed' || task.status === 'unavailable'
      ? ('not_applicable' as const)
      : options.isSettled
        ? ('settled' as const)
        : ('pending' as const);
  return {
    artifacts: settlementStatus === 'settled' ? publicTask.artifacts : [],
    code: publicTask.code === 'CAPABILITY_UNAVAILABLE' ? publicTask.code : undefined,
    createdAt: task.createdAt,
    id: publicTask.id,
    settlementStatus,
    status: publicTask.status,
    type: publicTask.type,
    updatedAt: task.updatedAt,
  };
};

interface CustomerWorkSource extends CustomerCenterCursorItem {
  asset?: unknown;
  fileId?: null | string;
  fileType?: string;
  resourceType?: string;
  source: 'document' | 'generation' | 'work';
  status?: null | string;
  title?: null | string;
  topicId?: string;
  type?: string;
}

const isPlatformManagedNativeImage = (row: {
  metadata?: unknown;
  type?: null | string;
}): boolean => {
  if (row.type !== 'image' || !row.metadata || typeof row.metadata !== 'object') return false;
  if (Array.isArray(row.metadata)) return false;

  return (row.metadata as Record<string, unknown>).platformAiRuntime === true;
};

export const buildCustomerWorkPage = (
  rows: CustomerWorkSource[],
  limit: number,
  cursor?: string,
  filters: CustomerGenerationFilters = {},
) => {
  const filtered = rows.flatMap((row) => {
    if (row.source === 'generation') {
      const isCompleteAsset =
        row.asset !== null &&
        typeof row.asset === 'object' &&
        !Array.isArray(row.asset) &&
        Object.keys(row.asset).length > 0;
      const type = CUSTOMER_NATIVE_GENERATION_TYPES.includes(
        row.type as CustomerNativeGenerationType,
      )
        ? (row.type as CustomerNativeGenerationType)
        : undefined;

      if (!type || row.status !== 'success' || !row.fileId || !row.topicId || !isCompleteAsset) {
        return [];
      }
      if (filters.type && type !== filters.type) return [];
      if (filters.status && filters.status !== 'succeeded') return [];
      if (filters.dateFrom && new Date(row.updatedAt) < filters.dateFrom) return [];
      if (filters.dateTo && new Date(row.updatedAt) > filters.dateTo) return [];

      return [
        {
          id: row.id,
          source: row.source,
          title: row.title || null,
          topicId: row.topicId,
          type,
          updatedAt: row.updatedAt,
        },
      ];
    }

    const type =
      row.source === 'document'
        ? 'document'
        : CUSTOMER_RESULT_GENERATION_TYPES.includes(
              row.resourceType as CustomerResultGenerationType,
            )
          ? (row.resourceType as CustomerResultGenerationType)
          : CUSTOMER_RESULT_GENERATION_TYPES.includes(row.type as CustomerResultGenerationType)
            ? (row.type as CustomerResultGenerationType)
            : undefined;
    const succeeded =
      row.source === 'document' || row.status === 'completed' || row.status === 'succeeded';

    if (!type || !succeeded) return [];
    if (filters.type && type !== filters.type) return [];
    if (filters.status && filters.status !== 'succeeded') return [];
    if (filters.dateFrom && new Date(row.updatedAt) < filters.dateFrom) return [];
    if (filters.dateTo && new Date(row.updatedAt) > filters.dateTo) return [];

    return [
      {
        id: row.id,
        source: row.source,
        status: 'succeeded' as const,
        title: row.title || null,
        type,
        updatedAt: row.updatedAt,
      },
    ];
  });

  return buildCustomerCenterPage(filtered, limit, cursor);
};

const cursorCondition = (
  updatedAt: SQL,
  id: AnyColumn,
  cursor?: { id: string; updatedAt: Date },
) =>
  cursor
    ? or(lt(updatedAt, cursor.updatedAt), and(eq(updatedAt, cursor.updatedAt), lt(id, cursor.id)))
    : undefined;

// The app and database workspaces currently resolve separate physical copies of
// Drizzle. SQL objects are runtime-compatible, but their private TypeScript
// brands differ, so queries cross that workspace boundary through this adapter.
const asDatabaseExpression = <T>(expression: T): never => expression as never;
const asQueryColumn = (column: unknown): AnyColumn => column as AnyColumn;
const customerWorkspaceCondition = (column: unknown, workspaceId?: null | string) =>
  workspaceId ? eq(asQueryColumn(column), workspaceId) : isNull(asQueryColumn(column));

const overviewInput = z
  .object({
    ledgerLimit: z.number().int().min(1).max(200).optional(),
    recentLimit: z.number().int().min(1).max(50).optional(),
  })
  .strict()
  .optional();

const assertIntegerCredits = (value: number): number => {
  if (!Number.isSafeInteger(value)) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Credits ledger contains invalid data',
    });
  }
  return value;
};

const toSafeCreditAccount = (account: PlatformCreditAccountItem) => {
  const balanceCredits = assertIntegerCredits(account.balanceCredits);
  if (balanceCredits < 0) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Credits balance contains invalid data',
    });
  }

  return { balanceCredits, updatedAt: account.updatedAt };
};

const toSafeCreditEntry = (entry: PlatformCreditEntryItem) => ({
  amountCredits: assertIntegerCredits(entry.amountCredits),
  balanceAfterCredits: assertIntegerCredits(entry.balanceAfterCredits),
  createdAt: entry.createdAt,
  id: entry.id,
  type: entry.type,
  updatedAt: entry.updatedAt,
});

const toSafeAvailableNumber = ({ available, value }: AvailableNumber): AvailableNumber => ({
  available,
  value,
});

const toSafeUsageMetrics = (metrics: PlatformUsageMetrics): PlatformUsageMetrics => ({
  costUsd: toSafeAvailableNumber(metrics.costUsd),
  totalInputTokens: toSafeAvailableNumber(metrics.totalInputTokens),
  totalOutputTokens: toSafeAvailableNumber(metrics.totalOutputTokens),
  totalTokens: toSafeAvailableNumber(metrics.totalTokens),
});

type UsageOverview = Awaited<ReturnType<PlatformUserUsageModel['getUsage']>>;

const toSafeUsageOverview = (usage: UsageOverview) => ({
  canonicalTotals: toSafeUsageMetrics(usage.canonicalTotals),
});

type ContentOverview = Awaited<ReturnType<PlatformUserContentModel['getOverview']>>;

const toSafeCreationsOverview = (content: ContentOverview) => ({
  generation: {
    statusCounts: content.generation.statusCounts.map(({ count, status }) => ({ count, status })),
    total: content.generation.total,
  },
  recentDocuments: content.recentDocuments.map((document) => ({
    createdAt: document.createdAt,
    fileType: document.fileType,
    id: document.id,
    parentId: document.parentId,
    title: document.title,
    totalCharCount: document.totalCharCount,
    totalLineCount: document.totalLineCount,
    updatedAt: document.updatedAt,
  })),
  recentGenerationTasks: content.recentGenerationTasks.map((task) => ({
    createdAt: task.createdAt,
    id: task.id,
    status: task.status,
    title: task.title,
    type: task.type,
    updatedAt: task.updatedAt,
  })),
  recentWorks: content.recentWorks.map((work) => ({
    createdAt: work.createdAt,
    id: work.id,
    resourceType: work.resourceType,
    status: work.status,
    title: work.title,
    type: work.type,
    updatedAt: work.updatedAt,
  })),
});

const projectContentOrNull = <T>(
  content: ContentOverview,
  project: (value: ContentOverview) => T,
): T | null => {
  try {
    return project(content);
  } catch {
    return null;
  }
};

export const customerCenterRouter = router({
  getGenerationDetail: customerCenterProcedure
    .input(z.object({ id: z.string().min(1).max(255) }).strict())
    .query(async ({ ctx, input }) => {
      const [task] = await ctx.serverDB
        .select({
          artifacts: travelGenerationTasks.artifacts,
          code: travelGenerationTasks.code,
          createdAt: travelGenerationTasks.createdAt,
          id: travelGenerationTasks.id,
          status: travelGenerationTasks.status,
          type: travelGenerationTasks.type,
          updatedAt: travelGenerationTasks.updatedAt,
          workspaceId: travelGenerationTasks.workspaceId,
        })
        .from(travelGenerationTasks)
        .where(
          asDatabaseExpression(
            and(
              eq(asQueryColumn(travelGenerationTasks.id), input.id),
              eq(asQueryColumn(travelGenerationTasks.userId), ctx.userId),
              customerWorkspaceCondition(travelGenerationTasks.workspaceId, ctx.workspaceId),
            ),
          ),
        )
        .limit(1);

      if (!task || !isCustomerVisibleGeneration(task)) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '生成记录不存在' });
      }

      const settlementIdentities = customerSettlementIdentities(task);
      const settlements =
        task.status === 'succeeded'
          ? await ctx.serverDB
              .select({
                generationId: platformCreditEntries.generationId,
                generationType: platformCreditEntries.generationType,
              })
              .from(platformCreditEntries)
              .where(
                asDatabaseExpression(
                  and(
                    or(
                      ...settlementIdentities.map((identity) =>
                        and(
                          eq(
                            asQueryColumn(platformCreditEntries.generationId),
                            identity.generationId,
                          ),
                          eq(
                            asQueryColumn(platformCreditEntries.generationType),
                            identity.generationType,
                          ),
                        ),
                      ),
                    ),
                    eq(asQueryColumn(platformCreditEntries.userIdSnapshot), ctx.userId),
                    eq(asQueryColumn(platformCreditEntries.actorUserIdSnapshot), ctx.userId),
                    eq(asQueryColumn(platformCreditEntries.type), 'usage_charge'),
                    customerWorkspaceCondition(platformCreditEntries.workspaceId, ctx.workspaceId),
                  ),
                ),
              )
              .limit(settlementIdentities.length)
          : [];

      const settledIdentities = new Set(
        settlements.flatMap(({ generationId, generationType }) =>
          typeof generationId === 'string' && typeof generationType === 'string'
            ? [settlementIdentityKey({ generationId, generationType })]
            : [],
        ),
      );
      return projectCustomerGenerationDetail(task, {
        isSettled: isCustomerGenerationSettled(task, settledIdentities),
      });
    }),
  getPage: customerCenterProcedure.input(pageInput).query(async ({ ctx, input }) => {
    const cursor = input.cursor ? decodeCustomerCenterCursor(input.cursor) : undefined;
    const queryLimit = input.limit + 1;

    if (input.kind === 'ledger') {
      const updatedAt = sql<Date>`date_trunc('milliseconds', ${platformCreditEntries.updatedAt})`;
      const rows = await ctx.serverDB
        .select({
          amountCredits: platformCreditEntries.amountCredits,
          balanceAfterCredits: platformCreditEntries.balanceAfterCredits,
          createdAt: platformCreditEntries.createdAt,
          id: platformCreditEntries.id,
          type: platformCreditEntries.type,
          updatedAt: platformCreditEntries.updatedAt,
        })
        .from(platformCreditEntries)
        .where(
          asDatabaseExpression(
            and(
              eq(asQueryColumn(platformCreditEntries.userIdSnapshot), ctx.userId),
              customerWorkspaceCondition(platformCreditEntries.workspaceId, ctx.workspaceId),
              cursorCondition(updatedAt, asQueryColumn(platformCreditEntries.id), cursor),
            ),
          ),
        )
        .orderBy(
          asDatabaseExpression(desc(updatedAt)),
          asDatabaseExpression(desc(asQueryColumn(platformCreditEntries.id))),
        )
        .limit(queryLimit);

      return {
        kind: input.kind,
        ...buildCustomerCenterPage(
          rows.map((entry) => ({
            amountCredits: assertIntegerCredits(entry.amountCredits),
            balanceAfterCredits: assertIntegerCredits(entry.balanceAfterCredits),
            createdAt: entry.createdAt,
            id: entry.id,
            type: entry.type,
            updatedAt: entry.updatedAt,
          })),
          input.limit,
        ),
      };
    }

    if (input.kind === 'order') {
      const updatedAt = sql<Date>`date_trunc('milliseconds', ${travelServiceOrders.updatedAt})`;
      const rows = await ctx.serverDB
        .select({
          amountFen: travelServiceOrders.amountFen,
          createdAt: travelServiceOrders.createdAt,
          id: travelServiceOrders.id,
          status: travelServiceOrders.status,
          title: travelServiceOrders.title,
          updatedAt: travelServiceOrders.updatedAt,
        })
        .from(travelServiceOrders)
        .where(
          asDatabaseExpression(
            and(
              eq(asQueryColumn(travelServiceOrders.userId), ctx.userId),
              cursorCondition(updatedAt, asQueryColumn(travelServiceOrders.id), cursor),
            ),
          ),
        )
        .orderBy(
          asDatabaseExpression(desc(updatedAt)),
          asDatabaseExpression(desc(asQueryColumn(travelServiceOrders.id))),
        )
        .limit(queryLimit);

      return {
        kind: input.kind,
        ...buildCustomerCenterPage(
          rows.map((order) => ({
            amountFen: order.amountFen,
            createdAt: order.createdAt,
            id: order.id,
            status: order.status,
            title: order.title,
            updatedAt: order.updatedAt,
          })),
          input.limit,
        ),
      };
    }

    if (input.kind === 'generation') {
      const updatedAt = sql<Date>`date_trunc('milliseconds', ${travelGenerationTasks.updatedAt})`;
      const generationConditions = [
        eq(asQueryColumn(travelGenerationTasks.userId), ctx.userId),
        customerWorkspaceCondition(travelGenerationTasks.workspaceId, ctx.workspaceId),
        or(
          inArray(asQueryColumn(travelGenerationTasks.type), CUSTOMER_RESULT_GENERATION_TYPES),
          and(
            eq(asQueryColumn(travelGenerationTasks.type), 'video'),
            inArray(asQueryColumn(travelGenerationTasks.status), ['failed', 'unavailable']),
          ),
        ),
        cursorCondition(updatedAt, asQueryColumn(travelGenerationTasks.id), cursor),
        input.type ? eq(asQueryColumn(travelGenerationTasks.type), input.type) : undefined,
        input.status === 'processing'
          ? inArray(asQueryColumn(travelGenerationTasks.status), ['pending', 'queued', 'running'])
          : input.status
            ? eq(asQueryColumn(travelGenerationTasks.status), input.status)
            : undefined,
        input.dateFrom ? gte(updatedAt, new Date(input.dateFrom)) : undefined,
        input.dateTo ? lte(updatedAt, new Date(input.dateTo)) : undefined,
      ];
      const rows = await ctx.serverDB
        .select({
          createdAt: travelGenerationTasks.createdAt,
          id: travelGenerationTasks.id,
          status: travelGenerationTasks.status,
          type: travelGenerationTasks.type,
          updatedAt: travelGenerationTasks.updatedAt,
        })
        .from(travelGenerationTasks)
        .where(asDatabaseExpression(and(...generationConditions)))
        .orderBy(
          asDatabaseExpression(desc(updatedAt)),
          asDatabaseExpression(desc(asQueryColumn(travelGenerationTasks.id))),
        )
        .limit(queryLimit);

      return {
        kind: input.kind,
        ...buildCustomerGenerationPage(rows, input.limit, undefined, {
          dateFrom: input.dateFrom ? new Date(input.dateFrom) : undefined,
          dateTo: input.dateTo ? new Date(input.dateTo) : undefined,
          status: input.status,
          type: input.type,
        }),
      };
    }

    if (input.status && input.status !== 'succeeded') {
      return { items: [], kind: input.kind, nextCursor: null };
    }

    const workUpdatedAt = sql<Date>`date_trunc('milliseconds', ${works.updatedAt})`;
    const documentUpdatedAt = sql<Date>`date_trunc('milliseconds', ${documents.updatedAt})`;
    const nativeGenerationUpdatedAt = sql<Date>`date_trunc('milliseconds', ${generations.updatedAt})`;
    const workConditions = [
      eq(asQueryColumn(works.userId), ctx.userId),
      customerWorkspaceCondition(works.workspaceId, ctx.workspaceId),
      inArray(asQueryColumn(works.resourceType), CUSTOMER_RESULT_GENERATION_TYPES),
      inArray(asQueryColumn(works.status), ['completed', 'succeeded']),
      cursorCondition(workUpdatedAt, asQueryColumn(works.id), cursor),
      input.type ? eq(asQueryColumn(works.resourceType), input.type) : undefined,
      input.dateFrom ? gte(workUpdatedAt, new Date(input.dateFrom)) : undefined,
      input.dateTo ? lte(workUpdatedAt, new Date(input.dateTo)) : undefined,
    ];
    const documentConditions = [
      eq(asQueryColumn(documents.userId), ctx.userId),
      customerWorkspaceCondition(documents.workspaceId, ctx.workspaceId),
      cursorCondition(documentUpdatedAt, asQueryColumn(documents.id), cursor),
      input.dateFrom ? gte(documentUpdatedAt, new Date(input.dateFrom)) : undefined,
      input.dateTo ? lte(documentUpdatedAt, new Date(input.dateTo)) : undefined,
    ];
    const nativeGenerationConditions = [
      eq(asQueryColumn(generations.userId), ctx.userId),
      customerWorkspaceCondition(generations.workspaceId, ctx.workspaceId),
      eq(asQueryColumn(generationBatches.userId), ctx.userId),
      customerWorkspaceCondition(generationBatches.workspaceId, ctx.workspaceId),
      eq(asQueryColumn(generationTopics.userId), ctx.userId),
      customerWorkspaceCondition(generationTopics.workspaceId, ctx.workspaceId),
      eq(asQueryColumn(asyncTasks.userId), ctx.userId),
      customerWorkspaceCondition(asyncTasks.workspaceId, ctx.workspaceId),
      eq(asQueryColumn(asyncTasks.status), 'success'),
      isNotNull(asQueryColumn(generations.fileId)),
      isNotNull(asQueryColumn(generations.asset)),
      or(
        and(
          eq(asQueryColumn(generationTopics.type), 'image'),
          eq(asQueryColumn(asyncTasks.type), 'image_generation'),
        ),
        and(
          eq(asQueryColumn(generationTopics.type), 'video'),
          eq(asQueryColumn(asyncTasks.type), 'video_generation'),
        ),
      ),
      cursorCondition(nativeGenerationUpdatedAt, asQueryColumn(generations.id), cursor),
      input.type && CUSTOMER_NATIVE_GENERATION_TYPES.includes(input.type as never)
        ? eq(asQueryColumn(generationTopics.type), input.type)
        : undefined,
      input.dateFrom ? gte(nativeGenerationUpdatedAt, new Date(input.dateFrom)) : undefined,
      input.dateTo ? lte(nativeGenerationUpdatedAt, new Date(input.dateTo)) : undefined,
    ];
    const shouldQueryNativeGenerations =
      !input.type || CUSTOMER_NATIVE_GENERATION_TYPES.includes(input.type as never);
    const [workRows, documentRows, nativeGenerationRows] = await Promise.all([
      ctx.serverDB
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
        .where(asDatabaseExpression(and(...workConditions)))
        .orderBy(
          asDatabaseExpression(desc(workUpdatedAt)),
          asDatabaseExpression(desc(asQueryColumn(works.id))),
        )
        .limit(queryLimit),
      input.type && input.type !== 'document'
        ? Promise.resolve([])
        : ctx.serverDB
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
            .where(asDatabaseExpression(and(...documentConditions)))
            .orderBy(
              asDatabaseExpression(desc(documentUpdatedAt)),
              asDatabaseExpression(desc(asQueryColumn(documents.id))),
            )
            .limit(queryLimit),
      shouldQueryNativeGenerations
        ? ctx.serverDB
            .select({
              asset: generations.asset,
              fileId: generations.fileId,
              id: generations.id,
              metadata: asyncTasks.metadata,
              status: asyncTasks.status,
              title: generationTopics.title,
              topicId: generationTopics.id,
              type: generationTopics.type,
              updatedAt: generations.updatedAt,
            })
            .from(generations)
            .innerJoin(
              generationBatches,
              asDatabaseExpression(
                eq(
                  asQueryColumn(generationBatches.id),
                  asQueryColumn(generations.generationBatchId),
                ),
              ),
            )
            .innerJoin(
              generationTopics,
              asDatabaseExpression(
                eq(
                  asQueryColumn(generationTopics.id),
                  asQueryColumn(generationBatches.generationTopicId),
                ),
              ),
            )
            .innerJoin(
              asyncTasks,
              asDatabaseExpression(
                eq(asQueryColumn(asyncTasks.id), asQueryColumn(generations.asyncTaskId)),
              ),
            )
            .where(asDatabaseExpression(and(...nativeGenerationConditions)))
            .orderBy(
              asDatabaseExpression(desc(nativeGenerationUpdatedAt)),
              asDatabaseExpression(desc(asQueryColumn(generations.id))),
            )
            .limit(queryLimit)
        : Promise.resolve([]),
    ]);

    const platformManagedImageIds = nativeGenerationRows
      .filter(isPlatformManagedNativeImage)
      .map(({ id }) => id);
    const settledPlatformImageIds = new Set<string>();

    if (platformManagedImageIds.length > 0) {
      const settlementRows = await ctx.serverDB
        .select({ generationId: platformCreditEntries.generationId })
        .from(platformCreditEntries)
        .where(
          asDatabaseExpression(
            and(
              eq(asQueryColumn(platformCreditEntries.type), 'usage_charge'),
              eq(
                asQueryColumn(platformCreditEntries.generationType),
                PLATFORM_IMAGE_SETTLEMENT_GENERATION_TYPE,
              ),
              inArray(asQueryColumn(platformCreditEntries.generationId), platformManagedImageIds),
              eq(asQueryColumn(platformCreditEntries.userIdSnapshot), ctx.userId),
              eq(asQueryColumn(platformCreditEntries.actorUserIdSnapshot), ctx.userId),
              customerWorkspaceCondition(platformCreditEntries.workspaceId, ctx.workspaceId),
            ),
          ),
        )
        .limit(platformManagedImageIds.length);

      for (const { generationId } of settlementRows) {
        if (generationId) settledPlatformImageIds.add(generationId);
      }
    }

    const customerVisibleNativeGenerations = nativeGenerationRows.filter(
      (row) => !isPlatformManagedNativeImage(row) || settledPlatformImageIds.has(row.id),
    );

    return {
      kind: input.kind,
      ...buildCustomerWorkPage(
        [
          ...workRows.map((row) => ({ ...row, source: 'work' as const })),
          ...documentRows.map((row) => ({ ...row, source: 'document' as const })),
          ...customerVisibleNativeGenerations.map((row) => ({
            ...row,
            source: 'generation' as const,
          })),
        ],
        input.limit,
        undefined,
        {
          dateFrom: input.dateFrom ? new Date(input.dateFrom) : undefined,
          dateTo: input.dateTo ? new Date(input.dateTo) : undefined,
          status: input.status,
          type: input.type,
        },
      ),
    };
  }),
  getOverview: customerCenterProcedure.input(overviewInput).query(async ({ ctx, input }) => {
    const creditModel = new PlatformCreditModel(ctx.serverDB, ctx.userId);
    const usageModel = new PlatformUserUsageModel(ctx.serverDB, ctx.userId);
    const contentModel = new PlatformUserContentModel(ctx.serverDB);

    const [account, entries, usage, content] = await Promise.allSettled([
      creditModel.getAccount().then(toSafeCreditAccount),
      creditModel
        .listEntries(input?.ledgerLimit)
        .then((ledgerEntries) => ledgerEntries.map(toSafeCreditEntry)),
      usageModel.getUsage({ recentLimit: input?.recentLimit }).then(toSafeUsageOverview),
      contentModel.getOverview(ctx.userId, { recentLimit: input?.recentLimit }),
    ]);

    const contentValue = content.status === 'fulfilled' ? content.value : null;

    return {
      content: {
        creations: contentValue
          ? projectContentOrNull(contentValue, toSafeCreationsOverview)
          : null,
      },
      credits: {
        account: account.status === 'fulfilled' ? account.value : null,
        entries: entries.status === 'fulfilled' ? entries.value : null,
      },
      usage: usage.status === 'fulfilled' ? usage.value : null,
    };
  }),
});
