// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { PlatformModerationAuditModel } from '@/database/models/platformModeration';
import { platformModerationAudits, roles, userRoles, users } from '@/database/schemas';

import { scanPlatformContent } from '../../../services/platformModeration';
import { platformModerationRouter } from '../platformModeration';

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: vi.fn((opts: any) => opts.next({ ctx: opts.ctx })),
}));

const db = await getTestDB();
const adminId = 'platform-moderation-route-admin';
const bannedAdminId = 'platform-moderation-route-banned-admin';
const ordinaryId = 'platform-moderation-route-ordinary';
const targetAId = 'platform-moderation-route-target-a';
const targetBId = 'platform-moderation-route-target-b';
const testUserIds = [adminId, bannedAdminId, ordinaryId, targetAId, targetBId];

const adminCaller = () =>
  platformModerationRouter.createCaller({ serverDB: db, userId: adminId } as any);
const ordinaryCaller = () =>
  platformModerationRouter.createCaller({ serverDB: db, userId: ordinaryId } as any);
const bannedAdminCaller = () =>
  platformModerationRouter.createCaller({ serverDB: db, userId: bannedAdminId } as any);

beforeAll(async () => {
  await db
    .insert(users)
    .values(testUserIds.map((id) => ({ banned: id === bannedAdminId, id })))
    .onConflictDoNothing();
  await db.update(users).set({ banned: true }).where(eq(users.id, bannedAdminId));
  await db
    .insert(roles)
    .values({ displayName: 'Super Admin', isActive: true, isSystem: true, name: 'super_admin' })
    .onConflictDoNothing();
  const role = await db.query.roles.findFirst({ where: eq(roles.name, 'super_admin') });
  if (!role) throw new Error('Missing super_admin role in test setup');
  await db
    .insert(userRoles)
    .values([
      { roleId: role.id, userId: adminId, workspaceId: null },
      { roleId: role.id, userId: bannedAdminId, workspaceId: null },
    ])
    .onConflictDoNothing();
});

beforeEach(async () => {
  await db
    .delete(platformModerationAudits)
    .where(inArray(platformModerationAudits.userIdSnapshot, [targetAId, targetBId]));
});

afterAll(async () => {
  await db
    .delete(platformModerationAudits)
    .where(inArray(platformModerationAudits.userIdSnapshot, [targetAId, targetBId]));
  await db.delete(userRoles).where(inArray(userRoles.userId, [adminId, bannedAdminId]));
  await db.delete(users).where(inArray(users.id, testUserIds));
});

const seedAudit = async (userId: string, sourceId: string, rawText: string) =>
  new PlatformModerationAuditModel(db).recordScanResult({
    scanResult: scanPlatformContent({ text: rawText }),
    sourceId,
    sourceType: 'copy',
    userId,
  });

describe('platform moderation tRPC authorization and projections', () => {
  it('rejects every read and disposition action from ordinary users', async () => {
    const record = await seedAudit(targetAId, 'forbidden-record', '联系邮箱 user@example.com');
    const caller = ordinaryCaller();

    await expect(caller.listRecords()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.getUserSafetyOverview({ targetUserId: targetAId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(caller.getRecord({ id: record.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.markReviewed({ id: record.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(caller.clear({ id: record.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.recommendBan({ id: record.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('rejects a banned administrator and returns 404 for an unknown target user', async () => {
    await expect(
      bannedAdminCaller().getUserSafetyOverview({ targetUserId: targetAId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      adminCaller().getUserSafetyOverview({ targetUserId: 'missing-moderation-target' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Target user was not found' });
  });

  it('returns only safe target-scoped summary counts and keyset events', async () => {
    const rawSecret = 'sk-live-OVERVIEW_SECRET_MUST_NOT_LEAK';
    const record = await seedAudit(targetAId, 'safe-overview-source', rawSecret);
    const olderRecord = await seedAudit(
      targetAId,
      'older-overview-source',
      'sk-live-OLDER_SECRET_MUST_NOT_LEAK',
    );
    await seedAudit(targetBId, 'other-user-source', '电话 13812345678');
    await Promise.all([
      db
        .update(platformModerationAudits)
        .set({ detectedAt: new Date('2026-09-03T10:00:00.000Z') })
        .where(eq(platformModerationAudits.id, record.id)),
      db
        .update(platformModerationAudits)
        .set({ detectedAt: new Date('2026-09-03T09:00:00.000Z') })
        .where(eq(platformModerationAudits.id, olderRecord.id)),
    ]);

    const result = await adminCaller().getUserSafetyOverview({
      category: 'credential',
      endAt: new Date('2026-09-04T00:00:00.000Z'),
      limit: 1,
      severity: 'critical',
      startAt: new Date('2026-09-01T00:00:00.000Z'),
      status: 'pending',
      targetUserId: targetAId,
    });

    expect(result.summary).toMatchObject({ block: 2, pending: 2, total: 2 });
    expect(result.items).toEqual([
      expect.objectContaining({
        categories: [{ category: 'credential', count: 1, severity: 'critical' }],
        disposition: 'pending',
        id: record.id,
        sourceType: 'copy',
        verdict: 'block',
      }),
    ]);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(Object.keys(result.items[0]).sort()).toEqual([
      'categories',
      'detectedAt',
      'disposedAt',
      'disposition',
      'id',
      'sourceType',
      'verdict',
    ]);
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      rawSecret,
      'other-user-source',
      'redactedPreview',
      'fingerprint',
      'prompt',
      'message',
      'email',
      'ipAddress',
      'token',
      'providerKey',
      'operatorUserId',
      'sourceId',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    const secondPage = await adminCaller().getUserSafetyOverview({
      category: 'credential',
      cursor: result.nextCursor!,
      endAt: new Date('2026-09-04T00:00:00.000Z'),
      limit: 1,
      severity: 'critical',
      startAt: new Date('2026-09-01T00:00:00.000Z'),
      status: 'pending',
      targetUserId: targetAId,
    });
    expect(secondPage.items.map((item) => item.id)).toEqual([olderRecord.id]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('paginates by user and exposes only the list allowlist', async () => {
    const rawSecret = 'sk-live-ROUTE_SECRET_MUST_NOT_LEAK';
    await seedAudit(targetAId, 'target-a-record', rawSecret);
    await seedAudit(targetBId, 'target-b-record', '电话 13812345678');

    const result = await adminCaller().listRecords({ limit: 1, offset: 0, userId: targetAId });
    expect(result).toMatchObject({ limit: 1, offset: 0, total: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      categories: [{ category: 'credential', count: 1, severity: 'critical' }],
      disposition: 'pending',
      sourceType: 'copy',
      userId: targetAId,
      verdict: 'block',
    });
    expect(Object.keys(result.items[0]).sort()).toEqual([
      'categories',
      'detectedAt',
      'disposedAt',
      'disposition',
      'id',
      'sourceType',
      'userId',
      'verdict',
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(rawSecret);
    expect(serialized).not.toContain('target-b-record');
    expect(serialized).not.toContain('fingerprint');
    expect(serialized).not.toContain('operatorUserId');
    expect(serialized).not.toContain('redactedPreview');
    expect(serialized).not.toContain('sourceId');
    expect(serialized).not.toContain('userIdSnapshot');
  });

  it('returns redacted detail and records review-only dispositions without banning accounts', async () => {
    const rawSecret = 'sk-live-DETAIL_SECRET_MUST_NOT_LEAK';
    const record = await seedAudit(targetAId, 'detail-record', rawSecret);
    const caller = adminCaller();

    const detail = await caller.getRecord({ id: record.id });
    expect(detail).toMatchObject({
      redactedPreview: '[CREDENTIAL]',
      userId: targetAId,
    });
    expect(Object.keys(detail).sort()).toEqual([
      'categories',
      'detectedAt',
      'disposedAt',
      'disposition',
      'id',
      'redactedPreview',
      'sourceType',
      'userId',
      'verdict',
    ]);
    const serializedDetail = JSON.stringify(detail);
    expect(serializedDetail).not.toContain(rawSecret);
    expect(serializedDetail).not.toContain('fingerprint');
    expect(serializedDetail).not.toContain('operatorUserId');
    expect(serializedDetail).not.toContain('sourceId');

    await expect(caller.markReviewed({ id: record.id })).resolves.toMatchObject({
      disposition: 'reviewed',
    });
    await expect(caller.clear({ id: record.id })).resolves.toMatchObject({
      disposition: 'cleared',
    });
    await expect(caller.recommendBan({ id: record.id })).resolves.toMatchObject({
      disposition: 'ban_recommended',
    });
    const [target] = await db.select().from(users).where(eq(users.id, targetAId));
    expect(target.banned).not.toBe(true);
  });

  it('has no content-upload or rescan procedure and rejects loose inputs', async () => {
    expect((platformModerationRouter as any)._def.procedures).not.toHaveProperty('scan');
    expect((platformModerationRouter as any)._def.procedures).not.toHaveProperty('record');
    await expect(
      adminCaller().listRecords({ limit: 101, unknown: true } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      adminCaller().getUserSafetyOverview({
        cursor: 'not-a-valid-cursor',
        targetUserId: targetAId,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(adminCaller().getRecord({ id: 'not-a-uuid' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});
