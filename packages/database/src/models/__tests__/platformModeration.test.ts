// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { platformModerationAudits, roles, userRoles, users } from '../../schemas';
import {
  PLATFORM_MODERATION_FORBIDDEN,
  PlatformModerationAdminModel,
  PlatformModerationAuditModel,
} from '../platformModeration';

const db = await getTestDB();
const adminId = 'platform-moderation-model-admin';
const ordinaryId = 'platform-moderation-model-ordinary';
const userAId = 'platform-moderation-model-user-a';
const userBId = 'platform-moderation-model-user-b';
const testUserIds = [adminId, ordinaryId, userAId, userBId];

const scanResult = {
  action: 'block' as const,
  findings: [{ category: 'credential' as const, count: 1, severity: 'critical' as const }],
  fingerprint: 'a'.repeat(64),
  preview: 'OPENAI_[CREDENTIAL]',
};

beforeAll(async () => {
  await db
    .insert(users)
    .values(testUserIds.map((id) => ({ id })))
    .onConflictDoNothing();
  await db
    .insert(roles)
    .values({ displayName: 'Super Admin', isActive: true, isSystem: true, name: 'super_admin' })
    .onConflictDoNothing();
  const role = await db.query.roles.findFirst({ where: eq(roles.name, 'super_admin') });
  if (!role) throw new Error('Missing super_admin role in test setup');
  await db
    .insert(userRoles)
    .values({ roleId: role.id, userId: adminId, workspaceId: null })
    .onConflictDoNothing();
});

beforeEach(async () => {
  await db
    .delete(platformModerationAudits)
    .where(inArray(platformModerationAudits.userIdSnapshot, [userAId, userBId]));
});

afterAll(async () => {
  await db
    .delete(platformModerationAudits)
    .where(inArray(platformModerationAudits.userIdSnapshot, [userAId, userBId]));
  await db.delete(userRoles).where(eq(userRoles.userId, adminId));
  await db.delete(users).where(inArray(users.id, testUserIds));
});

describe('PlatformModerationAuditModel', () => {
  it('persists only the detector result and never copies caller-supplied raw content', async () => {
    const rawSecret = 'sk-live-RAW_SECRET_MUST_NOT_BE_STORED';
    const record = await new PlatformModerationAuditModel(db).recordScanResult({
      rawText: rawSecret,
      scanResult: {
        ...scanResult,
        providerSignal: { code: rawSecret, source: rawSecret },
        text: rawSecret,
      },
      sourceId: 'generation-safe-id',
      sourceType: 'copy',
      systemPrompt: rawSecret,
      userId: userAId,
    } as never);

    expect(record).toMatchObject({
      categories: [{ category: 'credential', count: 1, severity: 'critical' }],
      disposition: 'pending',
      fingerprint: 'a'.repeat(64),
      redactedPreview: 'OPENAI_[CREDENTIAL]',
      sourceId: 'generation-safe-id',
      sourceType: 'copy',
      userId: userAId,
      userIdSnapshot: userAId,
      verdict: 'block',
    });
    expect(JSON.stringify(record)).not.toContain(rawSecret);

    const [stored] = await db
      .select()
      .from(platformModerationAudits)
      .where(eq(platformModerationAudits.id, record.id));
    expect(JSON.stringify(stored)).not.toContain(rawSecret);
  });

  it('validates source identifiers, fingerprints, previews, and detector categories', async () => {
    const model = new PlatformModerationAuditModel(db);
    const validInput = {
      scanResult,
      sourceId: 'source-1',
      sourceType: 'chat' as const,
      userId: userAId,
    };

    await expect(model.recordScanResult({ ...validInput, sourceId: '   ' })).rejects.toThrow();
    await expect(
      model.recordScanResult({
        ...validInput,
        scanResult: { ...scanResult, fingerprint: 'not-a-sha256' },
      }),
    ).rejects.toThrow();
    await expect(
      model.recordScanResult({
        ...validInput,
        scanResult: { ...scanResult, preview: 'x'.repeat(241) },
      }),
    ).rejects.toThrow();
    await expect(
      model.recordScanResult({
        ...validInput,
        scanResult: {
          ...scanResult,
          findings: [{ category: 'unknown', count: 1, severity: 'high' }],
        },
      } as never),
    ).rejects.toThrow();
  });
});

describe('PlatformModerationAdminModel', () => {
  it('returns a target-scoped safe overview with bounded keyset filters', async () => {
    const audit = new PlatformModerationAuditModel(db);
    const newest = await audit.recordScanResult({
      scanResult,
      sourceId: 'safe-source-newest',
      sourceType: 'copy',
      userId: userAId,
    });
    const reviewed = await audit.recordScanResult({
      scanResult: {
        ...scanResult,
        findings: [{ category: 'phone', count: 2, severity: 'high' }],
        fingerprint: 'b'.repeat(64),
      },
      sourceId: 'safe-source-reviewed',
      sourceType: 'chat',
      userId: userAId,
    });
    const oldest = await audit.recordScanResult({
      scanResult: {
        ...scanResult,
        action: 'review',
        findings: [{ category: 'phone', count: 1, severity: 'medium' }],
        fingerprint: 'c'.repeat(64),
      },
      sourceId: 'safe-source-oldest',
      sourceType: 'document',
      userId: userAId,
    });
    const mixedFinding = await audit.recordScanResult({
      scanResult: {
        ...scanResult,
        findings: [
          { category: 'phone', count: 1, severity: 'medium' },
          { category: 'email', count: 1, severity: 'high' },
        ],
        fingerprint: 'e'.repeat(64),
      },
      sourceId: 'safe-source-mixed-finding',
      sourceType: 'chat',
      userId: userAId,
    });
    await audit.recordScanResult({
      scanResult: { ...scanResult, fingerprint: 'd'.repeat(64) },
      sourceId: 'other-user-source',
      sourceType: 'video',
      userId: userBId,
    });
    await Promise.all([
      db
        .update(platformModerationAudits)
        .set({ detectedAt: new Date('2026-09-03T03:00:00.000Z') })
        .where(eq(platformModerationAudits.id, newest.id)),
      db
        .update(platformModerationAudits)
        .set({
          detectedAt: new Date('2026-09-03T02:00:00.000Z'),
          disposedAt: new Date('2026-09-03T02:30:00.000Z'),
          disposition: 'reviewed',
          operatorUserId: adminId,
        })
        .where(eq(platformModerationAudits.id, reviewed.id)),
      db
        .update(platformModerationAudits)
        .set({ detectedAt: new Date('2026-09-03T01:00:00.000Z') })
        .where(eq(platformModerationAudits.id, oldest.id)),
      db
        .update(platformModerationAudits)
        .set({
          detectedAt: new Date('2026-09-03T01:45:00.000Z'),
          disposedAt: new Date('2026-09-03T01:50:00.000Z'),
          disposition: 'reviewed',
          operatorUserId: adminId,
        })
        .where(eq(platformModerationAudits.id, mixedFinding.id)),
    ]);

    const admin = new PlatformModerationAdminModel(db, adminId);
    const firstPage = await admin.getUserSafetyOverview({ limit: 1, userId: userAId });
    expect(firstPage.items.map((item) => item.id)).toEqual([newest.id]);
    expect(firstPage.nextCursor).toEqual({
      detectedAt: new Date('2026-09-03T03:00:00.000Z'),
      id: newest.id,
    });
    expect(firstPage.summary).toEqual({
      allow: 0,
      banRecommended: 0,
      block: 3,
      cleared: 0,
      pending: 2,
      review: 1,
      reviewed: 2,
      total: 4,
    });

    const secondPage = await admin.getUserSafetyOverview({
      cursor: firstPage.nextCursor!,
      limit: 1,
      userId: userAId,
    });
    expect(secondPage.items.map((item) => item.id)).toEqual([reviewed.id]);
    expect(JSON.stringify(secondPage)).not.toContain('other-user-source');

    const filtered = await admin.getUserSafetyOverview({
      category: 'phone',
      endAt: new Date('2026-09-03T02:59:59.999Z'),
      limit: 10,
      severity: 'high',
      startAt: new Date('2026-09-03T01:30:00.000Z'),
      status: 'reviewed',
      userId: userAId,
    });
    expect(filtered.summary).toMatchObject({ block: 1, reviewed: 1, total: 1 });
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]).toEqual({
      categories: [{ category: 'phone', count: 2, severity: 'high' }],
      detectedAt: new Date('2026-09-03T02:00:00.000Z'),
      disposedAt: new Date('2026-09-03T02:30:00.000Z'),
      disposition: 'reviewed',
      id: reviewed.id,
      sourceType: 'chat',
      verdict: 'block',
    });
    expect(Object.keys(filtered.items[0]).sort()).toEqual([
      'categories',
      'detectedAt',
      'disposedAt',
      'disposition',
      'id',
      'sourceType',
      'verdict',
    ]);
  });

  it('rejects invalid safety-overview bounds', async () => {
    const admin = new PlatformModerationAdminModel(db, adminId);
    await expect(admin.getUserSafetyOverview({ limit: 51, userId: userAId })).rejects.toThrow(
      'pagination limit',
    );
    await expect(
      admin.getUserSafetyOverview({
        endAt: new Date('2026-09-01T00:00:00.000Z'),
        startAt: new Date('2026-09-02T00:00:00.000Z'),
        userId: userAId,
      }),
    ).rejects.toThrow('date range');
  });

  it('rejects ordinary users and filters paginated records by the user snapshot', async () => {
    const audit = new PlatformModerationAuditModel(db);
    await audit.recordScanResult({
      scanResult,
      sourceId: 'source-a',
      sourceType: 'copy',
      userId: userAId,
    });
    await audit.recordScanResult({
      scanResult: { ...scanResult, fingerprint: 'b'.repeat(64) },
      sourceId: 'source-b',
      sourceType: 'image',
      userId: userBId,
    });

    await expect(
      new PlatformModerationAdminModel(db, ordinaryId).listRecords({ userId: userAId }),
    ).rejects.toThrow(PLATFORM_MODERATION_FORBIDDEN);

    const result = await new PlatformModerationAdminModel(db, adminId).listRecords({
      limit: 1,
      offset: 0,
      userId: userAId,
    });
    expect(result).toMatchObject({ limit: 1, offset: 0, total: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].userIdSnapshot).toBe(userAId);
  });

  it.each(['reviewed', 'cleared', 'ban_recommended'] as const)(
    'records the %s disposition without changing the user account',
    async (disposition) => {
      const record = await new PlatformModerationAuditModel(db).recordScanResult({
        scanResult,
        sourceId: `source-${disposition}`,
        sourceType: 'document',
        userId: userAId,
      });
      const admin = new PlatformModerationAdminModel(db, adminId);

      const updated = await admin.setDisposition({ disposition, id: record.id });

      expect(updated).toMatchObject({ disposition, operatorUserId: adminId });
      expect(updated.disposedAt).toBeInstanceOf(Date);
      const [user] = await db.select().from(users).where(eq(users.id, userAId));
      expect(user).toBeDefined();
      expect(user.banned).not.toBe(true);
    },
  );
});
