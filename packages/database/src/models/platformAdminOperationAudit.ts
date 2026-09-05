import { and, desc, eq, gte, lt, lte, or, type SQL } from 'drizzle-orm';

import {
  type PlatformAdminOperationAction,
  type PlatformAdminOperationAuditItem,
  platformAdminOperationAudits,
  type PlatformAdminOperationPhase,
} from '../schemas/platformAdminOperationAudit';
import type { LobeChatDatabase } from '../type';

export const PLATFORM_ADMIN_OPERATION_AUDIT_CONFLICT =
  'The audit operation identifier is already used by a different event';

export class PlatformAdminOperationAuditQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformAdminOperationAuditQueryError';
  }
}

const actions = new Set<PlatformAdminOperationAction>([
  'user.banned',
  'user.password_reset_requested',
  'user.profile_updated',
  'user.sessions_revoked',
  'user.travel_group_repaired',
  'user.unbanned',
]);
const phases = new Set<PlatformAdminOperationPhase>(['failed', 'requested', 'succeeded']);

const normalizeIdentifier = (value: string, field: string, maxLength: number): string => {
  if (typeof value !== 'string') throw new Error(`${field} is invalid`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`${field} is invalid`);
  return normalized;
};

export interface RecordPlatformAdminOperationEventInput {
  action: PlatformAdminOperationAction;
  operationId: string;
  operatorUserId: string;
  phase: PlatformAdminOperationPhase;
  targetUserId: string;
}

export type RunPlatformAdminOperationInput = Omit<RecordPlatformAdminOperationEventInput, 'phase'>;

export interface ListPlatformAdminOperationEventsInput {
  action?: PlatformAdminOperationAction;
  cursor?: string;
  endAt?: Date;
  limit?: number;
  startAt?: Date;
  targetUserId?: string;
}

const cursorIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const encodeCursor = (item: PlatformAdminOperationAuditItem): string =>
  Buffer.from(JSON.stringify([item.occurredAt.toISOString(), item.id])).toString('base64url');

const decodeCursor = (cursor: string): { id: string; occurredAt: Date } => {
  if (!/^[\w-]{1,512}$/.test(cursor)) {
    throw new PlatformAdminOperationAuditQueryError('cursor is invalid');
  }
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      typeof decoded[0] !== 'string' ||
      typeof decoded[1] !== 'string' ||
      !cursorIdPattern.test(decoded[1])
    ) {
      throw new Error('invalid-cursor-payload');
    }
    const occurredAt = new Date(decoded[0]);
    if (!Number.isFinite(occurredAt.getTime()) || occurredAt.toISOString() !== decoded[0]) {
      throw new Error('invalid-cursor-time');
    }
    return { id: decoded[1], occurredAt };
  } catch {
    throw new PlatformAdminOperationAuditQueryError('cursor is invalid');
  }
};

const normalizeDate = (value: Date | undefined, field: string): Date | undefined => {
  if (value === undefined) return undefined;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new PlatformAdminOperationAuditQueryError(`${field} is invalid`);
  }
  return new Date(value.getTime());
};

/**
 * Append-only, data-minimised audit writer for platform-wide administrator actions.
 * The fixed input shape intentionally has no arbitrary metadata or sensitive payload field.
 */
export class PlatformAdminOperationAuditModel {
  constructor(private readonly db: LobeChatDatabase) {}

  async recordEvent(
    input: RecordPlatformAdminOperationEventInput,
  ): Promise<PlatformAdminOperationAuditItem> {
    if (!actions.has(input.action)) throw new Error('action is invalid');
    if (!phases.has(input.phase)) throw new Error('phase is invalid');

    const event = {
      action: input.action,
      operationId: normalizeIdentifier(input.operationId, 'operationId', 128),
      operatorUserId: normalizeIdentifier(input.operatorUserId, 'operatorUserId', 255),
      phase: input.phase,
      targetUserId: normalizeIdentifier(input.targetUserId, 'targetUserId', 255),
    };
    const [inserted] = await this.db
      .insert(platformAdminOperationAudits)
      .values(event)
      .onConflictDoNothing({
        target: [
          platformAdminOperationAudits.operationId,
          platformAdminOperationAudits.action,
          platformAdminOperationAudits.phase,
        ],
      })
      .returning();
    if (inserted) return inserted;

    const [existing] = await this.db
      .select()
      .from(platformAdminOperationAudits)
      .where(
        and(
          eq(platformAdminOperationAudits.operationId, event.operationId),
          eq(platformAdminOperationAudits.action, event.action),
          eq(platformAdminOperationAudits.phase, event.phase),
        ),
      )
      .limit(1);
    if (
      existing &&
      existing.action === event.action &&
      existing.operatorUserId === event.operatorUserId &&
      existing.targetUserId === event.targetUserId
    ) {
      return existing;
    }
    throw new Error(PLATFORM_ADMIN_OPERATION_AUDIT_CONFLICT);
  }

  async listEvents(input: ListPlatformAdminOperationEventsInput = {}) {
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new PlatformAdminOperationAuditQueryError('limit is invalid');
    }
    if (input.action !== undefined && !actions.has(input.action)) {
      throw new PlatformAdminOperationAuditQueryError('action is invalid');
    }
    let targetUserId: string | undefined;
    if (input.targetUserId !== undefined) {
      try {
        targetUserId = normalizeIdentifier(input.targetUserId, 'targetUserId', 255);
      } catch {
        throw new PlatformAdminOperationAuditQueryError('targetUserId is invalid');
      }
    }
    const startAt = normalizeDate(input.startAt, 'startAt');
    const endAt = normalizeDate(input.endAt, 'endAt');
    if (startAt && endAt && startAt.getTime() > endAt.getTime()) {
      throw new PlatformAdminOperationAuditQueryError('time range is invalid');
    }

    const filters: SQL[] = [];
    if (targetUserId) filters.push(eq(platformAdminOperationAudits.targetUserId, targetUserId));
    if (input.action) filters.push(eq(platformAdminOperationAudits.action, input.action));
    if (startAt) filters.push(gte(platformAdminOperationAudits.occurredAt, startAt));
    if (endAt) filters.push(lte(platformAdminOperationAudits.occurredAt, endAt));
    if (input.cursor !== undefined) {
      const cursor = decodeCursor(input.cursor);
      filters.push(
        or(
          lt(platformAdminOperationAudits.occurredAt, cursor.occurredAt),
          and(
            eq(platformAdminOperationAudits.occurredAt, cursor.occurredAt),
            lt(platformAdminOperationAudits.id, cursor.id),
          ),
        )!,
      );
    }

    const rows = await this.db
      .select()
      .from(platformAdminOperationAudits)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(platformAdminOperationAudits.occurredAt), desc(platformAdminOperationAudits.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items,
      nextCursor: hasMore && items.length > 0 ? encodeCursor(items.at(-1)) : null,
    };
  }

  async runOperation<T>(input: RunPlatformAdminOperationInput, operation: () => Promise<T>) {
    await this.recordEvent({ ...input, phase: 'requested' });
    try {
      const result = await operation();
      await this.recordEvent({ ...input, phase: 'succeeded' });
      return result;
    } catch (error) {
      await this.recordEvent({ ...input, phase: 'failed' });
      throw error;
    }
  }
}
