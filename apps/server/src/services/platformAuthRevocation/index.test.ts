// @vitest-environment node
import { getTestInstance } from 'better-auth/test';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { PlatformUserOperationsModel } from '@/database/models/platformUserOperations';
import {
  oidcAccessTokens,
  oidcRefreshTokens,
  oidcSessions,
  platformAdminOperationAudits,
  roles,
  userRoles,
  users,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import {
  PLATFORM_AUTH_REVOCATION_RETRY_MESSAGE,
  PlatformAuthRevocationError,
  PlatformAuthRevocationService,
} from './index';

const db: LobeChatDatabase = await getTestDB();
const adminUserId = 'platform-auth-revocation-admin';
const targetUserId = 'platform-auth-revocation-target';
const otherUserId = 'platform-auth-revocation-other';
const userIds = [adminUserId, targetUserId, otherUserId];
const expiresAt = new Date('2027-09-02T00:00:00.000Z');

const cleanup = async () => {
  await db.delete(oidcAccessTokens).where(inArray(oidcAccessTokens.userId, userIds));
  await db.delete(oidcRefreshTokens).where(inArray(oidcRefreshTokens.userId, userIds));
  await db.delete(oidcSessions).where(inArray(oidcSessions.userId, userIds));
  await db.delete(userRoles).where(eq(userRoles.userId, adminUserId));
  await db.delete(users).where(inArray(users.id, userIds));
};

beforeEach(async () => {
  await cleanup();
  await db.insert(users).values([
    { email: 'platform-auth-revocation-admin@example.com', id: adminUserId },
    {
      banReason: '临时封禁',
      banned: true,
      email: 'platform-auth-revocation-target@example.com',
      id: targetUserId,
    },
    { email: 'platform-auth-revocation-other@example.com', id: otherUserId },
  ]);
  await db
    .insert(roles)
    .values({ displayName: 'Super Admin', isActive: true, isSystem: true, name: 'super_admin' })
    .onConflictDoNothing();
  const role = await db.query.roles.findFirst({ where: eq(roles.name, 'super_admin') });
  if (!role) throw new Error('Missing super_admin role in test setup');
  await db.insert(userRoles).values({ roleId: role.id, userId: adminUserId, workspaceId: null });
  await db.insert(oidcAccessTokens).values([
    {
      clientId: 'platform-auth-revocation-client',
      data: { token: 'TARGET_OIDC_ACCESS_TOKEN_MUST_NOT_LEAK' },
      expiresAt,
      id: 'platform-auth-revocation-target-access',
      userId: targetUserId,
    },
    {
      clientId: 'platform-auth-revocation-client',
      data: { token: 'OTHER_OIDC_ACCESS_TOKEN' },
      expiresAt,
      id: 'platform-auth-revocation-other-access',
      userId: otherUserId,
    },
  ]);
  await db.insert(oidcRefreshTokens).values([
    {
      clientId: 'platform-auth-revocation-client',
      data: { token: 'TARGET_OIDC_REFRESH_TOKEN_MUST_NOT_LEAK' },
      expiresAt,
      id: 'platform-auth-revocation-target-refresh',
      userId: targetUserId,
    },
    {
      clientId: 'platform-auth-revocation-client',
      data: { token: 'OTHER_OIDC_REFRESH_TOKEN' },
      expiresAt,
      id: 'platform-auth-revocation-other-refresh',
      userId: otherUserId,
    },
  ]);
  await db.insert(oidcSessions).values([
    {
      data: { secret: 'TARGET_OIDC_SESSION_MUST_NOT_LEAK' },
      expiresAt,
      id: 'platform-auth-revocation-target-session',
      userId: targetUserId,
    },
    {
      data: { secret: 'OTHER_OIDC_SESSION' },
      expiresAt,
      id: 'platform-auth-revocation-other-session',
      userId: otherUserId,
    },
  ]);
});

afterEach(cleanup);

const createBetterAuthFixture = async () => {
  const secondaryStorage = new Map<string, string>();
  const instance = await getTestInstance(
    {
      emailAndPassword: { enabled: true },
      secondaryStorage: {
        delete: async (key) => {
          secondaryStorage.delete(key);
        },
        get: async (key) => secondaryStorage.get(key) ?? null,
        set: async (key, value) => {
          secondaryStorage.set(key, value);
        },
      },
      session: { storeSessionInDatabase: true },
    },
    { disableTestUser: true },
  );
  const context = await instance.auth.$context;
  const target = await context.internalAdapter.createUser({
    email: 'platform-auth-revocation-target@example.com',
    emailVerified: true,
    id: targetUserId,
    name: 'Target',
  });
  const other = await context.internalAdapter.createUser({
    email: 'platform-auth-revocation-other@example.com',
    emailVerified: true,
    id: otherUserId,
    name: 'Other',
  });
  const targetSessions = await Promise.all([
    context.internalAdapter.createSession(target.id),
    context.internalAdapter.createSession(target.id),
  ]);
  const otherSession = await context.internalAdapter.createSession(other.id);

  return { context, otherSession, secondaryStorage, targetSessions };
};

describe('PlatformAuthRevocationService', () => {
  it('uses Better Auth canonical revocation and removes only the target Redis and OIDC artifacts', async () => {
    const fixture = await createBetterAuthFixture();
    const service = new PlatformAuthRevocationService(db, {
      getAuthContext: async () => fixture.context,
    });

    expect(fixture.secondaryStorage.has(`active-sessions-${targetUserId}`)).toBe(true);
    expect(fixture.secondaryStorage.has(fixture.targetSessions[0].token)).toBe(true);
    expect(fixture.secondaryStorage.has(fixture.otherSession.token)).toBe(true);

    const operationId = 'platform-auth-revocation-success';
    await service.revokeUser(targetUserId, { operationId, operatorUserId: adminUserId });

    expect(fixture.secondaryStorage.has(`active-sessions-${targetUserId}`)).toBe(false);
    expect(fixture.secondaryStorage.has(fixture.targetSessions[0].token)).toBe(false);
    expect(fixture.secondaryStorage.has(fixture.targetSessions[1].token)).toBe(false);
    expect(fixture.secondaryStorage.has(`active-sessions-${otherUserId}`)).toBe(true);
    expect(fixture.secondaryStorage.has(fixture.otherSession.token)).toBe(true);
    await expect(
      db.select().from(oidcAccessTokens).where(eq(oidcAccessTokens.userId, targetUserId)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(oidcRefreshTokens).where(eq(oidcRefreshTokens.userId, targetUserId)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(oidcSessions).where(eq(oidcSessions.userId, targetUserId)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(oidcRefreshTokens).where(eq(oidcRefreshTokens.userId, otherUserId)),
    ).resolves.toHaveLength(1);
    const auditEvents = await db
      .select()
      .from(platformAdminOperationAudits)
      .where(eq(platformAdminOperationAudits.operationId, operationId));
    expect(auditEvents.map(({ action, phase }) => ({ action, phase }))).toEqual([
      { action: 'user.sessions_revoked', phase: 'requested' },
      { action: 'user.sessions_revoked', phase: 'succeeded' },
    ]);
    expect(JSON.stringify(auditEvents)).not.toMatch(/token|ipAddress|metadata|TARGET_OIDC/i);

    await new PlatformUserOperationsModel(db, adminUserId).unbanUser({ targetUserId });

    const [target] = await db.select().from(users).where(eq(users.id, targetUserId));
    expect(target.banned).toBe(false);
    expect(fixture.secondaryStorage.has(`active-sessions-${targetUserId}`)).toBe(false);
    expect(fixture.secondaryStorage.has(fixture.targetSessions[0].token)).toBe(false);
    await expect(
      db.select().from(oidcRefreshTokens).where(eq(oidcRefreshTokens.userId, targetUserId)),
    ).resolves.toHaveLength(0);
  });

  it('still revokes OIDC artifacts and throws a safe retryable error when session revocation fails', async () => {
    const service = new PlatformAuthRevocationService(db, {
      getAuthContext: async () => ({
        internalAdapter: {
          deleteUserSessions: async () => {
            throw new Error('SESSION_TOKEN_MUST_NOT_LEAK');
          },
        },
      }),
    });

    const operationId = 'platform-auth-revocation-failed';
    const promise = service.revokeUser(targetUserId, {
      operationId,
      operatorUserId: adminUserId,
    });

    await expect(promise).rejects.toEqual(new PlatformAuthRevocationError(['better-auth-session']));
    await expect(promise).rejects.toThrow(PLATFORM_AUTH_REVOCATION_RETRY_MESSAGE);
    await expect(
      db.select().from(oidcRefreshTokens).where(eq(oidcRefreshTokens.userId, targetUserId)),
    ).resolves.toHaveLength(0);
    expect(JSON.stringify(await promise.catch((error) => error))).not.toContain(
      'SESSION_TOKEN_MUST_NOT_LEAK',
    );
    const auditEvents = await db
      .select()
      .from(platformAdminOperationAudits)
      .where(eq(platformAdminOperationAudits.operationId, operationId));
    expect(auditEvents.map(({ action, phase }) => ({ action, phase }))).toEqual([
      { action: 'user.sessions_revoked', phase: 'requested' },
      { action: 'user.sessions_revoked', phase: 'failed' },
    ]);
    expect(JSON.stringify(auditEvents)).not.toContain('SESSION_TOKEN_MUST_NOT_LEAK');
  });
});
