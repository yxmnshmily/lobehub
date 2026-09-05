// @vitest-environment node
import { createHmac } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { session as authSessions, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { UserSessionManagementError, UserSessionManagementService } from './index';

const db: LobeChatDatabase = await getTestDB();
const actorUserId = 'user-session-management-actor';
const otherUserId = 'user-session-management-other';
const userIds = [actorUserId, otherUserId];
const currentToken = 'CURRENT_SESSION_TOKEN_MUST_NOT_LEAK';
const otherOwnToken = 'OTHER_OWN_SESSION_TOKEN_MUST_NOT_LEAK';
const otherUserToken = 'OTHER_USER_SESSION_TOKEN_MUST_NOT_LEAK';
const expiredToken = 'EXPIRED_SESSION_TOKEN_MUST_NOT_LEAK';
const opaqueIdSecret = 'test-only-hmac-secret-with-at-least-32-bytes';

const createOpaqueId = (userId: string, sessionToken: string) =>
  createHmac('sha256', opaqueIdSecret)
    .update(`user-session\0${userId}\0${sessionToken}`)
    .digest('base64url');

const cleanup = async () => {
  await db.delete(authSessions).where(inArray(authSessions.userId, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
};

beforeEach(async () => {
  await cleanup();
  await db.insert(users).values([
    { email: 'user-session-management-actor@example.com', id: actorUserId },
    { email: 'user-session-management-other@example.com', id: otherUserId },
  ]);
  await db.insert(authSessions).values([
    {
      createdAt: new Date('2026-09-01T01:00:00.000Z'),
      expiresAt: new Date('2099-09-01T01:00:00.000Z'),
      id: 'user-session-current',
      ipAddress: '192.0.2.25',
      token: currentToken,
      updatedAt: new Date('2026-09-04T01:00:00.000Z'),
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
      userId: actorUserId,
    },
    {
      createdAt: new Date('2026-09-02T01:00:00.000Z'),
      expiresAt: new Date('2099-09-02T01:00:00.000Z'),
      id: 'user-session-other-own',
      ipAddress: '2001:db8:abcd:0012::1',
      token: otherOwnToken,
      updatedAt: new Date('2026-09-03T01:00:00.000Z'),
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      userId: actorUserId,
    },
    {
      createdAt: new Date('2026-09-02T02:00:00.000Z'),
      expiresAt: new Date('2099-09-02T02:00:00.000Z'),
      id: 'user-session-other-user',
      ipAddress: '203.0.113.19',
      token: otherUserToken,
      updatedAt: new Date('2026-09-04T02:00:00.000Z'),
      userAgent: 'SECRET_OTHER_USER_AGENT',
      userId: otherUserId,
    },
    {
      createdAt: new Date('2025-09-02T02:00:00.000Z'),
      expiresAt: new Date('2025-09-03T02:00:00.000Z'),
      id: 'user-session-expired',
      ipAddress: '198.51.100.44',
      token: expiredToken,
      updatedAt: new Date('2025-09-02T03:00:00.000Z'),
      userAgent: 'EXPIRED_USER_AGENT',
      userId: actorUserId,
    },
  ]);
});

afterEach(cleanup);

const createService = (
  overrides: Partial<ConstructorParameters<typeof UserSessionManagementService>[1]> = {},
) =>
  new UserSessionManagementService(db, {
    actorUserId,
    currentSessionToken: currentToken,
    deleteSessionByToken: async (token) => {
      await db.delete(authSessions).where(eq(authSessions.token, token));
    },
    opaqueIdSecret,
    ...overrides,
  });

describe('UserSessionManagementService', () => {
  it('lists only active sessions owned by the actor using a safe projection', async () => {
    const sessions = await createService().listSessions();

    expect(sessions).toHaveLength(2);
    expect(sessions).toEqual([
      expect.objectContaining({
        browserName: 'Chrome',
        current: true,
        deviceName: 'macOS',
        maskedIp: '192.0.*.*',
      }),
      expect.objectContaining({
        browserName: 'Safari',
        current: false,
        deviceName: 'iPhone',
        maskedIp: '2001:db8:*',
      }),
    ]);
    expect(sessions.every(({ sessionId }) => /^[\w-]{43}$/.test(sessionId))).toBe(true);

    const serialized = JSON.stringify(sessions);
    expect(serialized).not.toContain(currentToken);
    expect(serialized).not.toContain(otherOwnToken);
    expect(serialized).not.toContain(otherUserToken);
    expect(serialized).not.toContain(expiredToken);
    expect(serialized).not.toContain('192.0.2.25');
    expect(serialized).not.toContain('2001:db8:abcd:0012::1');
    expect(serialized).not.toContain('Mozilla');
    expect(serialized).not.toContain('SECRET_OTHER_USER_AGENT');
  });

  it('fails closed when the authenticated current session does not belong to the actor', async () => {
    const service = createService({ currentSessionToken: otherUserToken });

    await expect(service.listSessions()).rejects.toEqual(
      new UserSessionManagementError('INVALID_AUTH_CONTEXT'),
    );
  });

  it('revokes another active session owned by the actor using its opaque id', async () => {
    const service = createService();
    const target = (await service.listSessions()).find(({ current }) => !current);
    expect(target).toBeDefined();

    await expect(service.revokeSession(target!.sessionId)).resolves.toEqual({ revoked: true });

    await expect(
      db.select().from(authSessions).where(eq(authSessions.token, otherOwnToken)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(authSessions).where(eq(authSessions.token, currentToken)),
    ).resolves.toHaveLength(1);
    await expect(
      db.select().from(authSessions).where(eq(authSessions.token, otherUserToken)),
    ).resolves.toHaveLength(1);
  });

  it('protects the current session from the per-device revoke operation', async () => {
    const service = createService();
    const current = (await service.listSessions()).find((item) => item.current);
    expect(current).toBeDefined();

    await expect(service.revokeSession(current!.sessionId)).rejects.toEqual(
      new UserSessionManagementError('CURRENT_SESSION_PROTECTED'),
    );
    await expect(
      db.select().from(authSessions).where(eq(authSessions.token, currentToken)),
    ).resolves.toHaveLength(1);
  });

  it('uses one unavailable response for forged, cross-user, expired, missing, and replayed ids', async () => {
    const actorService = createService();
    const otherService = createService({
      actorUserId: otherUserId,
      currentSessionToken: otherUserToken,
    });
    const crossUserId = (await otherService.listSessions())[0].sessionId;
    const ownTargetId = (await actorService.listSessions()).find(
      ({ current }) => !current,
    )!.sessionId;

    for (const unavailableId of [
      'forged-session-id',
      crossUserId,
      createOpaqueId(actorUserId, expiredToken),
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    ]) {
      await expect(actorService.revokeSession(unavailableId)).rejects.toEqual(
        new UserSessionManagementError('SESSION_UNAVAILABLE'),
      );
    }

    await actorService.revokeSession(ownTargetId);
    await expect(actorService.revokeSession(ownTargetId)).rejects.toEqual(
      new UserSessionManagementError('SESSION_UNAVAILABLE'),
    );
  });

  it('keeps the session and returns a safe retry error when canonical revocation fails', async () => {
    const service = createService({
      deleteSessionByToken: async () => {
        throw new Error(otherOwnToken);
      },
    });
    const target = (await service.listSessions()).find(({ current }) => !current)!;

    const promise = service.revokeSession(target.sessionId);
    await expect(promise).rejects.toEqual(
      new UserSessionManagementError('SESSION_REVOCATION_FAILED'),
    );
    await expect(promise).rejects.not.toThrow(otherOwnToken);
    await expect(
      db.select().from(authSessions).where(eq(authSessions.token, otherOwnToken)),
    ).resolves.toHaveLength(1);
  });

  it('refuses to start without a stable high-entropy opaque-id secret', () => {
    expect(() => createService({ opaqueIdSecret: 'too-short' })).toThrow(
      new UserSessionManagementError('INVALID_OPAQUE_ID_SECRET'),
    );
  });
});
