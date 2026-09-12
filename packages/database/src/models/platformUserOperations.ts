import { randomUUID } from 'node:crypto';

import { desc, eq, ilike, or, sql } from 'drizzle-orm';

import {
  session as authSessions,
  travelServiceAccounts,
  travelServiceLedgerEntries,
  users,
} from '../schemas';
import type { LobeChatDatabase } from '../type';
import { PLATFORM_ADMIN_ROLE } from './platformAdmin';
import { PlatformAdminOperationAuditModel } from './platformAdminOperationAudit';
import { RbacModel } from './rbac';

export const PLATFORM_USER_OPERATIONS_FORBIDDEN = '仅平台超级管理员可管理用户账号状态';

export type PlatformUserOperationsErrorCode =
  | 'FORBIDDEN'
  | 'INVALID_EXPIRATION'
  | 'INVALID_REASON'
  | 'INVALID_TARGET_USER_ID'
  | 'SELF_BAN_FORBIDDEN'
  | 'SELF_UNBAN_FORBIDDEN'
  | 'USER_NOT_FOUND';

export class PlatformUserOperationsError extends Error {
  constructor(
    readonly code: PlatformUserOperationsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PlatformUserOperationsError';
  }
}

export interface PlatformUserBanState {
  banExpires: Date | null;
  banned: boolean;
  banReason: string | null;
  id: string;
}

export interface BanPlatformUserInput {
  banExpires?: Date;
  operationId?: string;
  reason: string;
  targetUserId: string;
}

export interface UnbanPlatformUserInput {
  operationId?: string;
  targetUserId: string;
}

export interface ListPlatformUsersInput {
  limit?: number;
  offset?: number;
  query?: string;
}

export interface PlatformUserOperationsItem {
  avatar: string | null;
  balanceFen: number;
  banExpires: Date | null;
  banned: boolean | null;
  banReason: string | null;
  createdAt: Date;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  fullName: string | null;
  id: string;
  lastActiveAt: Date;
  latestSessionAt: Date | null;
  latestLoginAt: Date | null;
  latestSessionIp: string | null;
  totalConsumptionFen: number;
  username: string | null;
}

const normalizeLimit = (limit: number | undefined): number => {
  if (limit === undefined || !Number.isFinite(limit)) return 20;
  return Math.min(100, Math.max(1, Math.trunc(limit)));
};

const normalizeOffset = (offset: number | undefined): number => {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  return Math.max(0, Math.trunc(offset));
};

const normalizeTargetUserId = (value: string): string => {
  if (typeof value !== 'string') {
    throw new PlatformUserOperationsError('INVALID_TARGET_USER_ID', 'targetUserId is invalid');
  }
  const targetUserId = value.trim();
  if (!targetUserId || targetUserId.length > 255) {
    throw new PlatformUserOperationsError('INVALID_TARGET_USER_ID', 'targetUserId is invalid');
  }
  return targetUserId;
};

const normalizeBanReason = (value: string): string => {
  if (typeof value !== 'string') {
    throw new PlatformUserOperationsError('INVALID_REASON', 'ban reason is invalid');
  }
  const reason = value.trim();
  if (!reason || reason.length > 500) {
    throw new PlatformUserOperationsError('INVALID_REASON', 'ban reason is invalid');
  }
  return reason;
};

const normalizeBanExpiration = (value: Date | undefined): Date | null => {
  if (value === undefined) return null;
  if (
    !(value instanceof Date) ||
    !Number.isFinite(value.getTime()) ||
    value.getTime() <= Date.now()
  ) {
    throw new PlatformUserOperationsError('INVALID_EXPIRATION', 'ban expiration is invalid');
  }
  return new Date(value.getTime());
};

/**
 * Platform-wide user operations query model.
 *
 * The projection is intentionally allow-listed. Authentication credentials,
 * session tokens, provider keys and password hashes never enter the result.
 */
export class PlatformUserOperationsModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly operatorUserId: string,
  ) {}

  private async assertPlatformAdmin(): Promise<void> {
    const isPlatformAdmin = await new RbacModel(this.db, this.operatorUserId).hasGlobalRole(
      PLATFORM_ADMIN_ROLE,
    );
    if (!isPlatformAdmin) {
      throw new PlatformUserOperationsError('FORBIDDEN', PLATFORM_USER_OPERATIONS_FORBIDDEN);
    }
  }

  async banUser(input: BanPlatformUserInput): Promise<PlatformUserBanState> {
    await this.assertPlatformAdmin();
    const targetUserId = normalizeTargetUserId(input.targetUserId);
    if (targetUserId === this.operatorUserId) {
      throw new PlatformUserOperationsError(
        'SELF_BAN_FORBIDDEN',
        'An administrator cannot ban their own account',
      );
    }
    const banReason = normalizeBanReason(input.reason);
    const banExpires = normalizeBanExpiration(input.banExpires);

    return new PlatformAdminOperationAuditModel(this.db).runOperation(
      {
        action: 'user.banned',
        operationId: input.operationId ?? randomUUID(),
        operatorUserId: this.operatorUserId,
        targetUserId,
      },
      () =>
        this.db.transaction(async (tx) => {
          const [target] = await tx
            .update(users)
            .set({ banExpires, banned: true, banReason })
            .where(eq(users.id, targetUserId))
            .returning({
              banExpires: users.banExpires,
              banned: users.banned,
              banReason: users.banReason,
              id: users.id,
            });
          if (!target) {
            throw new PlatformUserOperationsError('USER_NOT_FOUND', 'Target user was not found');
          }

          // Keep DB-backed session rows synchronized with the account state. The
          // server route completes secondary-storage and OIDC revocation before
          // reporting success.
          await tx.delete(authSessions).where(eq(authSessions.userId, targetUserId));

          return {
            banExpires: target.banExpires,
            banned: target.banned === true,
            banReason: target.banReason,
            id: target.id,
          };
        }),
    );
  }

  async unbanUser(input: UnbanPlatformUserInput): Promise<PlatformUserBanState> {
    await this.assertPlatformAdmin();
    const targetUserId = normalizeTargetUserId(input.targetUserId);
    if (targetUserId === this.operatorUserId) {
      throw new PlatformUserOperationsError(
        'SELF_UNBAN_FORBIDDEN',
        'An administrator cannot unban their own account',
      );
    }
    return new PlatformAdminOperationAuditModel(this.db).runOperation(
      {
        action: 'user.unbanned',
        operationId: input.operationId ?? randomUUID(),
        operatorUserId: this.operatorUserId,
        targetUserId,
      },
      async () => {
        const [target] = await this.db
          .update(users)
          .set({ banExpires: null, banned: false, banReason: null })
          .where(eq(users.id, targetUserId))
          .returning({
            banExpires: users.banExpires,
            banned: users.banned,
            banReason: users.banReason,
            id: users.id,
          });
        if (!target) {
          throw new PlatformUserOperationsError('USER_NOT_FOUND', 'Target user was not found');
        }
        return {
          banExpires: target.banExpires,
          banned: target.banned === true,
          banReason: target.banReason,
          id: target.id,
        };
      },
    );
  }

  async listUsers(input: ListPlatformUsersInput = {}): Promise<{
    items: PlatformUserOperationsItem[];
    limit: number;
    offset: number;
    total: number;
  }> {
    await this.assertPlatformAdmin();

    const limit = normalizeLimit(input.limit);
    const offset = normalizeOffset(input.offset);
    const query = input.query?.trim().slice(0, 200);
    const search = query
      ? or(
          ilike(users.id, `%${query}%`),
          ilike(users.email, `%${query}%`),
          ilike(users.username, `%${query}%`),
          ilike(users.fullName, `%${query}%`),
        )
      : undefined;

    const [rows, countRows] = await Promise.all([
      this.db
        .select({
          avatar: users.avatar,
          balanceFen: sql<number>`coalesce(${travelServiceAccounts.balanceFen}, 0)`,
          banExpires: users.banExpires,
          banReason: users.banReason,
          banned: users.banned,
          createdAt: users.createdAt,
          email: users.email,
          emailVerified: users.emailVerified,
          phone: users.phone,
          fullName: users.fullName,
          id: users.id,
          lastActiveAt: users.lastActiveAt,
          latestLoginAt: sql<Date | null>`(
              select max(${authSessions.createdAt})
              from ${authSessions}
              where ${authSessions.userId} = ${users.id}
            )`.mapWith(authSessions.createdAt),
          latestSessionAt: sql<Date | null>`(
              select ${authSessions.updatedAt}
              from ${authSessions}
              where ${authSessions.userId} = ${users.id}
              order by ${authSessions.updatedAt} desc, ${authSessions.id} desc
              limit 1
            )`.mapWith(authSessions.updatedAt),
          latestSessionIp: sql<string | null>`(
            select ${authSessions.ipAddress}
            from ${authSessions}
            where ${authSessions.userId} = ${users.id}
            order by ${authSessions.updatedAt} desc, ${authSessions.id} desc
            limit 1
          )`,
          totalConsumptionFen: sql<number>`coalesce((
            select -sum(
              case
                when entry.type = 'service_charge' then entry.amount_fen
                when entry.type = 'reversal' and exists (
                  select 1
                  from ${travelServiceLedgerEntries} original
                  where original.id = entry.reversal_of_entry_id
                    and original.type = 'service_charge'
                ) then entry.amount_fen
                else 0
              end
            )
            from ${travelServiceLedgerEntries} entry
            where entry.user_id = ${users.id}
          ), 0)`,
          username: users.username,
        })
        .from(users)
        .leftJoin(travelServiceAccounts, eq(travelServiceAccounts.userId, users.id))
        .where(search)
        .orderBy(desc(users.createdAt), desc(users.id))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ total: sql<number>`count(*)` })
        .from(users)
        .where(search),
    ]);

    return {
      items: rows.map((row) => ({
        ...row,
        balanceFen: Number(row.balanceFen),
        totalConsumptionFen: Number(row.totalConsumptionFen),
      })),
      limit,
      offset,
      total: Number(countRows[0]?.total ?? 0),
    };
  }
}
