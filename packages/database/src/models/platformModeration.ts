import { and, desc, eq, gte, lt, lte, or, type SQL, sql } from 'drizzle-orm';

import {
  type PlatformModerationAuditItem,
  platformModerationAudits,
  type PlatformModerationCategory,
  type PlatformModerationCategoryFinding,
  type PlatformModerationDisposition,
  type PlatformModerationSeverity,
  type PlatformModerationSourceType,
  type PlatformModerationVerdict,
} from '../schemas/platformModeration';
import type { LobeChatDatabase } from '../type';
import { PLATFORM_ADMIN_ROLE } from './platformAdmin';
import { RbacModel } from './rbac';

export const PLATFORM_MODERATION_FORBIDDEN = '仅平台管理员可管理敏感信息审计记录';
export const PLATFORM_MODERATION_NOT_FOUND = '敏感信息审计记录不存在';

const categories = new Set([
  'credential',
  'email',
  'government_id',
  'phone',
  'provider_moderation',
]);
const severities = new Set(['critical', 'high', 'medium']);
const sourceTypes = new Set(['chat', 'copy', 'document', 'image', 'video']);
const verdicts = new Set(['allow', 'block', 'review']);
const dispositions = new Set(['reviewed', 'cleared', 'ban_recommended']);

const normalizeText = (value: string, field: string, maxLength: number) => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`${field}无效`);
  return normalized;
};

const normalizeFindings = (
  findings: PlatformModerationCategoryFinding[],
): PlatformModerationCategoryFinding[] => {
  if (!Array.isArray(findings) || findings.length > 20) throw new Error('检测分类无效');
  return findings.map((finding) => {
    if (
      !finding ||
      !categories.has(finding.category) ||
      !severities.has(finding.severity) ||
      !Number.isSafeInteger(finding.count) ||
      finding.count < 1
    ) {
      throw new Error('检测分类无效');
    }
    return { category: finding.category, count: finding.count, severity: finding.severity };
  });
};

export interface RecordPlatformModerationScanInput {
  scanResult: {
    action: PlatformModerationVerdict;
    findings: PlatformModerationCategoryFinding[];
    fingerprint: string;
    preview: string;
  };
  sourceId: string;
  sourceType: PlatformModerationSourceType;
  userId: string;
}

export class PlatformModerationAuditModel {
  constructor(private readonly db: LobeChatDatabase) {}

  async recordScanResult(
    input: RecordPlatformModerationScanInput,
  ): Promise<PlatformModerationAuditItem> {
    const userId = normalizeText(input.userId, '用户 ID', 255);
    const sourceId = normalizeText(input.sourceId, '来源 ID', 500);
    if (!sourceTypes.has(input.sourceType)) throw new Error('来源类型无效');
    if (!verdicts.has(input.scanResult.action)) throw new Error('检测结论无效');
    if (!/^[0-9a-f]{64}$/.test(input.scanResult.fingerprint)) throw new Error('内容指纹无效');
    if (typeof input.scanResult.preview !== 'string' || input.scanResult.preview.length > 240) {
      throw new Error('脱敏预览无效');
    }

    const [record] = await this.db
      .insert(platformModerationAudits)
      .values({
        categories: normalizeFindings(input.scanResult.findings),
        fingerprint: input.scanResult.fingerprint,
        redactedPreview: input.scanResult.preview,
        sourceId,
        sourceType: input.sourceType,
        userId,
        userIdSnapshot: userId,
        verdict: input.scanResult.action,
      })
      .returning();
    return record;
  }
}

export interface ListPlatformModerationRecordsInput {
  disposition?: PlatformModerationDisposition;
  limit?: number;
  offset?: number;
  userId?: string;
  verdict?: PlatformModerationVerdict;
}

export interface GetUserSafetyOverviewInput {
  category?: PlatformModerationCategory;
  cursor?: { detectedAt: Date; id: string };
  endAt?: Date;
  limit?: number;
  severity?: PlatformModerationSeverity;
  startAt?: Date;
  status?: PlatformModerationDisposition;
  userId: string;
}

export class PlatformModerationAdminModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly operatorUserId: string,
  ) {}

  private async assertAdmin() {
    if (await new RbacModel(this.db, this.operatorUserId).hasGlobalRole(PLATFORM_ADMIN_ROLE))
      return;
    throw new Error(PLATFORM_MODERATION_FORBIDDEN);
  }

  async getUserSafetyOverview(input: GetUserSafetyOverviewInput) {
    await this.assertAdmin();
    const userId = normalizeText(input.userId, 'user id', 255);
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new Error('pagination limit is invalid');
    }
    if (input.category && !categories.has(input.category)) {
      throw new Error('moderation category is invalid');
    }
    if (input.severity && !severities.has(input.severity)) {
      throw new Error('moderation severity is invalid');
    }
    if (input.status && input.status !== 'pending' && !dispositions.has(input.status)) {
      throw new Error('moderation status is invalid');
    }
    if (input.startAt && !Number.isFinite(input.startAt.getTime())) {
      throw new Error('date range is invalid');
    }
    if (input.endAt && !Number.isFinite(input.endAt.getTime())) {
      throw new Error('date range is invalid');
    }
    if (input.startAt && input.endAt && input.startAt > input.endAt) {
      throw new Error('date range is invalid');
    }

    const filters: SQL[] = [eq(platformModerationAudits.userIdSnapshot, userId)];
    if (input.category && input.severity) {
      filters.push(sql`EXISTS (
        SELECT 1
        FROM jsonb_array_elements(${platformModerationAudits.categories}) AS finding
        WHERE finding ->> 'category' = ${input.category}
          AND finding ->> 'severity' = ${input.severity}
      )`);
    } else if (input.category) {
      filters.push(sql`EXISTS (
        SELECT 1
        FROM jsonb_array_elements(${platformModerationAudits.categories}) AS finding
        WHERE finding ->> 'category' = ${input.category}
      )`);
    } else if (input.severity) {
      filters.push(sql`EXISTS (
        SELECT 1
        FROM jsonb_array_elements(${platformModerationAudits.categories}) AS finding
        WHERE finding ->> 'severity' = ${input.severity}
      )`);
    }
    if (input.status) filters.push(eq(platformModerationAudits.disposition, input.status));
    if (input.startAt) filters.push(gte(platformModerationAudits.detectedAt, input.startAt));
    if (input.endAt) filters.push(lte(platformModerationAudits.detectedAt, input.endAt));
    const filteredWhere = and(...filters);

    const pageFilters = [...filters];
    if (input.cursor) {
      if (!Number.isFinite(input.cursor.detectedAt.getTime())) {
        throw new Error('pagination cursor is invalid');
      }
      const cursorId = normalizeText(input.cursor.id, 'cursor id', 64);
      pageFilters.push(
        or(
          lt(platformModerationAudits.detectedAt, input.cursor.detectedAt),
          and(
            eq(platformModerationAudits.detectedAt, input.cursor.detectedAt),
            lt(platformModerationAudits.id, cursorId),
          ),
        )!,
      );
    }

    const [rows, totals] = await Promise.all([
      this.db
        .select({
          categories: platformModerationAudits.categories,
          detectedAt: platformModerationAudits.detectedAt,
          disposedAt: platformModerationAudits.disposedAt,
          disposition: platformModerationAudits.disposition,
          id: platformModerationAudits.id,
          sourceType: platformModerationAudits.sourceType,
          verdict: platformModerationAudits.verdict,
        })
        .from(platformModerationAudits)
        .where(and(...pageFilters))
        .orderBy(desc(platformModerationAudits.detectedAt), desc(platformModerationAudits.id))
        .limit(limit + 1),
      this.db
        .select({
          allow: sql<number>`count(*) filter (where ${platformModerationAudits.verdict} = 'allow')`,
          banRecommended: sql<number>`count(*) filter (where ${platformModerationAudits.disposition} = 'ban_recommended')`,
          block: sql<number>`count(*) filter (where ${platformModerationAudits.verdict} = 'block')`,
          cleared: sql<number>`count(*) filter (where ${platformModerationAudits.disposition} = 'cleared')`,
          pending: sql<number>`count(*) filter (where ${platformModerationAudits.disposition} = 'pending')`,
          review: sql<number>`count(*) filter (where ${platformModerationAudits.verdict} = 'review')`,
          reviewed: sql<number>`count(*) filter (where ${platformModerationAudits.disposition} = 'reviewed')`,
          total: sql<number>`count(*)`,
        })
        .from(platformModerationAudits)
        .where(filteredWhere),
    ]);

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const lastItem = items.at(-1);
    const counts = totals[0];
    return {
      items,
      nextCursor: hasMore && lastItem ? { detectedAt: lastItem.detectedAt, id: lastItem.id } : null,
      summary: {
        allow: Number(counts?.allow ?? 0),
        banRecommended: Number(counts?.banRecommended ?? 0),
        block: Number(counts?.block ?? 0),
        cleared: Number(counts?.cleared ?? 0),
        pending: Number(counts?.pending ?? 0),
        review: Number(counts?.review ?? 0),
        reviewed: Number(counts?.reviewed ?? 0),
        total: Number(counts?.total ?? 0),
      },
    };
  }

  async listRecords(input: ListPlatformModerationRecordsInput = {}) {
    await this.assertAdmin();
    const limit = input.limit ?? 20;
    const offset = input.offset ?? 0;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('分页数量无效');
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('分页偏移无效');

    const filters: SQL[] = [];
    if (input.userId) {
      filters.push(
        eq(platformModerationAudits.userIdSnapshot, normalizeText(input.userId, '用户 ID', 255)),
      );
    }
    if (input.verdict) {
      if (!verdicts.has(input.verdict)) throw new Error('检测结论无效');
      filters.push(eq(platformModerationAudits.verdict, input.verdict));
    }
    if (input.disposition) {
      if (input.disposition !== 'pending' && !dispositions.has(input.disposition)) {
        throw new Error('处置状态无效');
      }
      filters.push(eq(platformModerationAudits.disposition, input.disposition));
    }
    const where = filters.length > 0 ? and(...filters) : undefined;
    const [items, totals] = await Promise.all([
      this.db
        .select()
        .from(platformModerationAudits)
        .where(where)
        .orderBy(desc(platformModerationAudits.detectedAt), desc(platformModerationAudits.id))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(platformModerationAudits)
        .where(where),
    ]);
    return { items, limit, offset, total: Number(totals[0]?.count ?? 0) };
  }

  async getRecord(id: string): Promise<PlatformModerationAuditItem> {
    await this.assertAdmin();
    const [record] = await this.db
      .select()
      .from(platformModerationAudits)
      .where(eq(platformModerationAudits.id, normalizeText(id, '记录 ID', 64)))
      .limit(1);
    if (!record) throw new Error(PLATFORM_MODERATION_NOT_FOUND);
    return record;
  }

  async setDisposition(input: {
    disposition: Exclude<PlatformModerationDisposition, 'pending'>;
    id: string;
  }): Promise<PlatformModerationAuditItem> {
    await this.assertAdmin();
    if (!dispositions.has(input.disposition)) throw new Error('处置状态无效');
    const [record] = await this.db
      .update(platformModerationAudits)
      .set({
        disposedAt: new Date(),
        disposition: input.disposition,
        operatorUserId: normalizeText(this.operatorUserId, '管理员用户 ID', 255),
      })
      .where(eq(platformModerationAudits.id, normalizeText(input.id, '记录 ID', 64)))
      .returning();
    if (!record) throw new Error(PLATFORM_MODERATION_NOT_FOUND);
    return record;
  }
}
