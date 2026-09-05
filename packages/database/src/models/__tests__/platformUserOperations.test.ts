// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  account as authAccounts,
  platformAdminOperationAudits,
  roles,
  session as authSessions,
  travelServiceAccounts,
  travelServiceLedgerEntries,
  userRoles,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  PLATFORM_USER_OPERATIONS_FORBIDDEN,
  PlatformUserOperationsModel,
} from '../platformUserOperations';

const db: LobeChatDatabase = await getTestDB();
const adminId = 'platform-user-ops-admin';
const aliceId = 'platform-user-ops-alice';
const bobId = 'platform-user-ops-bob';
const userIds = [adminId, aliceId, bobId];

const cleanup = async () => {
  await db.delete(userRoles).where(eq(userRoles.userId, adminId));
  await db.delete(travelServiceLedgerEntries).where(eq(travelServiceLedgerEntries.userId, aliceId));
  await db.delete(travelServiceAccounts).where(eq(travelServiceAccounts.userId, aliceId));
  await db.delete(authAccounts).where(eq(authAccounts.userId, aliceId));
  await db.delete(authSessions).where(inArray(authSessions.userId, userIds));
  for (const userId of userIds) await db.delete(users).where(eq(users.id, userId));
};

beforeEach(async () => {
  await cleanup();
  await db.insert(users).values([
    {
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
      email: 'admin@example.com',
      fullName: '平台管理员',
      id: adminId,
    },
    {
      avatar: 'https://example.com/alice.png',
      banExpires: new Date('2026-12-31T00:00:00.000Z'),
      banReason: '风险复核',
      banned: true,
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
      email: 'alice@example.com',
      emailVerified: true,
      fullName: 'Alice 旅行者',
      id: aliceId,
      lastActiveAt: new Date('2026-02-03T00:00:00.000Z'),
      username: 'alice-travel',
    },
    {
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      email: 'bob@example.com',
      fullName: 'Bob 旅行者',
      id: bobId,
    },
  ]);

  await db
    .insert(roles)
    .values({
      displayName: 'Super Admin',
      isActive: true,
      isSystem: true,
      name: 'super_admin',
      workspaceId: null,
    })
    .onConflictDoNothing();
  const adminRole = await db.query.roles.findFirst({
    where: eq(roles.name, 'super_admin'),
  });
  if (!adminRole) throw new Error('Missing super_admin role in test setup');
  await db
    .insert(userRoles)
    .values({ roleId: adminRole.id, userId: adminId, workspaceId: null })
    .onConflictDoNothing();

  await db.insert(authSessions).values([
    {
      createdAt: new Date('2026-02-03T08:00:00.000Z'),
      expiresAt: new Date('2027-02-03T08:00:00.000Z'),
      id: 'platform-user-ops-session-admin',
      ipAddress: '10.0.0.3',
      token: 'never-return-admin-session-token',
      updatedAt: new Date('2026-02-03T08:00:00.000Z'),
      userId: adminId,
    },
    {
      createdAt: new Date('2026-02-01T08:00:00.000Z'),
      expiresAt: new Date('2027-02-01T08:00:00.000Z'),
      id: 'platform-user-ops-session-old',
      ipAddress: '10.0.0.1',
      token: 'never-return-old-session-token',
      updatedAt: new Date('2026-02-01T08:00:00.000Z'),
      userId: aliceId,
    },
    {
      createdAt: new Date('2026-02-02T08:00:00.000Z'),
      expiresAt: new Date('2027-02-02T08:00:00.000Z'),
      id: 'platform-user-ops-session-new',
      ipAddress: '10.0.0.2',
      token: 'never-return-new-session-token',
      updatedAt: new Date('2026-02-02T08:00:00.000Z'),
      userId: aliceId,
    },
    {
      createdAt: new Date('2026-02-04T08:00:00.000Z'),
      expiresAt: new Date('2027-02-04T08:00:00.000Z'),
      id: 'platform-user-ops-session-bob',
      ipAddress: '10.0.0.4',
      token: 'never-return-bob-session-token',
      updatedAt: new Date('2026-02-04T08:00:00.000Z'),
      userId: bobId,
    },
  ]);
  await db.insert(authAccounts).values({
    accountId: 'alice-password-account',
    id: 'platform-user-ops-password-account',
    password: 'never-return-password-hash',
    providerId: 'credential',
    updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    userId: aliceId,
  });

  const [serviceAccount] = await db
    .insert(travelServiceAccounts)
    .values({ balanceFen: 9000, userId: aliceId, userIdSnapshot: aliceId })
    .returning();
  const [refundedCharge] = await db
    .insert(travelServiceLedgerEntries)
    .values({
      accountId: serviceAccount.id,
      amountFen: -3000,
      balanceAfterFen: 7000,
      idempotencyKey: 'platform-user-ops-charge-refunded',
      reason: '已退款的消费',
      type: 'service_charge',
      userId: aliceId,
    })
    .returning();
  await db.insert(travelServiceLedgerEntries).values([
    {
      accountId: serviceAccount.id,
      amountFen: 3000,
      balanceAfterFen: 10_000,
      idempotencyKey: 'platform-user-ops-refund',
      reason: '退款',
      reversalOfEntryId: refundedCharge.id,
      type: 'reversal',
      userId: aliceId,
    },
    {
      accountId: serviceAccount.id,
      amountFen: -1000,
      balanceAfterFen: 9000,
      idempotencyKey: 'platform-user-ops-charge-kept',
      reason: '实际消费',
      type: 'service_charge',
      userId: aliceId,
    },
  ]);
});

afterEach(cleanup);

describe('PlatformUserOperationsModel', () => {
  it('rejects callers without the active global super_admin role', async () => {
    const model = new PlatformUserOperationsModel(db, bobId);

    await expect(model.listUsers()).rejects.toThrow(PLATFORM_USER_OPERATIONS_FORBIDDEN);
    await expect(model.banUser({ reason: '滥用风险', targetUserId: aliceId })).rejects.toThrow(
      PLATFORM_USER_OPERATIONS_FORBIDDEN,
    );
    await expect(model.unbanUser({ targetUserId: aliceId })).rejects.toThrow(
      PLATFORM_USER_OPERATIONS_FORBIDDEN,
    );
  });

  it('atomically bans a target, deletes every target session, and leaves other users isolated', async () => {
    const model = new PlatformUserOperationsModel(db, adminId);
    const banExpires = new Date(Date.now() + 86_400_000);
    const operationId = 'platform-user-ops-ban-success';

    const result = await model.banUser({
      banExpires,
      operationId,
      reason: '  异常账号风险  ',
      targetUserId: bobId,
    });

    expect(result).toEqual({
      banExpires,
      banned: true,
      banReason: '异常账号风险',
      id: bobId,
    });
    const [target] = await db.select().from(users).where(eq(users.id, bobId));
    expect(target).toMatchObject({
      banExpires,
      banned: true,
      banReason: '异常账号风险',
    });
    await expect(
      db.select().from(authSessions).where(eq(authSessions.userId, bobId)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(authSessions).where(eq(authSessions.userId, aliceId)),
    ).resolves.toHaveLength(2);
    await expect(
      db.select().from(authSessions).where(eq(authSessions.userId, adminId)),
    ).resolves.toHaveLength(1);
    expect(Object.keys(result).sort()).toEqual(['banExpires', 'banReason', 'banned', 'id']);
    expect(JSON.stringify(result)).not.toMatch(/token|password|session/i);
    const auditEvents = await db
      .select()
      .from(platformAdminOperationAudits)
      .where(eq(platformAdminOperationAudits.operationId, operationId));
    expect(auditEvents.map(({ action, phase }) => ({ action, phase }))).toEqual([
      { action: 'user.banned', phase: 'requested' },
      { action: 'user.banned', phase: 'succeeded' },
    ]);
    expect(JSON.stringify(auditEvents)).not.toMatch(/异常账号风险|token|password|10\.0\.0\./i);
  });

  it('refuses self-banning without changing the administrator or its sessions', async () => {
    const model = new PlatformUserOperationsModel(db, adminId);

    await expect(model.banUser({ reason: '误操作', targetUserId: adminId })).rejects.toThrow(
      /self|administrator|admin/i,
    );

    const [admin] = await db.select().from(users).where(eq(users.id, adminId));
    expect(admin.banned).not.toBe(true);
    await expect(
      db.select().from(authSessions).where(eq(authSessions.userId, adminId)),
    ).resolves.toHaveLength(1);
  });

  it('refuses self-unbanning so a blocked administrator cannot restore their own access', async () => {
    const model = new PlatformUserOperationsModel(db, adminId);
    const banExpires = new Date(Date.now() + 86_400_000);
    await db
      .update(users)
      .set({ banExpires, banned: true, banReason: '另一位管理员封禁' })
      .where(eq(users.id, adminId));

    await expect(model.unbanUser({ targetUserId: adminId })).rejects.toThrow(
      /self|administrator|admin/i,
    );

    const [admin] = await db.select().from(users).where(eq(users.id, adminId));
    expect(admin).toMatchObject({
      banExpires,
      banned: true,
      banReason: '另一位管理员封禁',
    });
    await expect(
      db.select().from(authSessions).where(eq(authSessions.userId, adminId)),
    ).resolves.toHaveLength(1);
  });

  it('validates the target, reason, and future expiration before mutating state', async () => {
    const model = new PlatformUserOperationsModel(db, adminId);

    await expect(model.banUser({ reason: '   ', targetUserId: bobId })).rejects.toThrow(/reason/i);
    await expect(model.banUser({ reason: '风险', targetUserId: ' '.repeat(3) })).rejects.toThrow(
      /target/i,
    );
    await expect(
      model.banUser({
        banExpires: new Date(Date.now() - 1000),
        reason: '风险',
        targetUserId: bobId,
      }),
    ).rejects.toThrow(/expiration/i);
    await expect(
      model.banUser({
        banExpires: new Date(Number.NaN),
        reason: '风险',
        targetUserId: bobId,
      }),
    ).rejects.toThrow(/expiration/i);

    const [target] = await db.select().from(users).where(eq(users.id, bobId));
    expect(target.banned).not.toBe(true);
    await expect(
      db.select().from(authSessions).where(eq(authSessions.userId, bobId)),
    ).resolves.toHaveLength(1);
  });

  it('unbans an account without restoring the sessions removed by the ban', async () => {
    const model = new PlatformUserOperationsModel(db, adminId);
    await model.banUser({
      operationId: 'platform-user-ops-ban-before-unban',
      reason: '临时封禁',
      targetUserId: bobId,
    });

    const operationId = 'platform-user-ops-unban-success';
    const result = await model.unbanUser({ operationId, targetUserId: bobId });

    expect(result).toEqual({ banExpires: null, banned: false, banReason: null, id: bobId });
    await expect(
      db.select().from(authSessions).where(eq(authSessions.userId, bobId)),
    ).resolves.toHaveLength(0);
    const auditEvents = await db
      .select()
      .from(platformAdminOperationAudits)
      .where(eq(platformAdminOperationAudits.operationId, operationId));
    expect(auditEvents.map(({ action, phase }) => ({ action, phase }))).toEqual([
      { action: 'user.unbanned', phase: 'requested' },
      { action: 'user.unbanned', phase: 'succeeded' },
    ]);
  });

  it('returns searchable user operations data without authentication secrets', async () => {
    const model = new PlatformUserOperationsModel(db, adminId);

    const result = await model.listUsers({ limit: 10, query: 'ALICE' });

    expect(result).toEqual({
      items: [
        {
          avatar: 'https://example.com/alice.png',
          balanceFen: 9000,
          banExpires: new Date('2026-12-31T00:00:00.000Z'),
          banReason: '风险复核',
          banned: true,
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
          email: 'alice@example.com',
          emailVerified: true,
          fullName: 'Alice 旅行者',
          id: aliceId,
          lastActiveAt: new Date('2026-02-03T00:00:00.000Z'),
          latestSessionAt: new Date('2026-02-02T08:00:00.000Z'),
          latestSessionIp: '10.0.0.2',
          totalConsumptionFen: 1000,
          username: 'alice-travel',
        },
      ],
      limit: 10,
      offset: 0,
      total: 1,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('never-return-new-session-token');
    expect(serialized).not.toContain('never-return-old-session-token');
    expect(serialized).not.toContain('never-return-password-hash');
  });

  it('paginates all users deterministically and normalizes unsafe limits', async () => {
    const model = new PlatformUserOperationsModel(db, adminId);

    const firstPage = await model.listUsers({ limit: 1, offset: 1 });
    const clampedPage = await model.listUsers({ limit: 999, offset: -4 });

    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0].id).toBe(aliceId);
    expect(firstPage).toMatchObject({ limit: 1, offset: 1, total: 3 });
    expect(clampedPage).toMatchObject({ limit: 100, offset: 0, total: 3 });
  });
});
