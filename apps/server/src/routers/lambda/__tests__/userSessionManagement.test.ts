// @vitest-environment node
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { session as authSessions, users } from '@/database/schemas';

import { userSessionManagementRouter } from '../userSessionManagement';

const mocks = vi.hoisted(() => ({
  deleteSession: vi.fn<(token: string) => Promise<void>>(),
  getActiveSession: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ cookie: 'better-auth.session_token=signed' })),
}));

vi.mock('@/auth', () => ({
  auth: {
    $context: Promise.resolve({ internalAdapter: { deleteSession: mocks.deleteSession } }),
  },
}));

vi.mock('@/envs/auth', () => ({
  authEnv: { AUTH_SECRET: 'session-router-test-secret-with-at-least-32-bytes' },
}));

vi.mock('@/libs/better-auth/getActiveSession', () => ({
  getActiveSession: mocks.getActiveSession,
}));

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: vi.fn((opts: any) => opts.next({ ctx: opts.ctx })),
}));

const db = await getTestDB();
const actorUserId = 'user-session-router-actor';
const otherUserId = 'user-session-router-other';
const currentToken = 'CURRENT_SESSION_ROUTER_TOKEN';
const otherOwnToken = 'OTHER_OWN_SESSION_ROUTER_TOKEN';
const otherUserToken = 'OTHER_USER_SESSION_ROUTER_TOKEN';
const secret = 'session-router-test-secret-with-at-least-32-bytes';

const sessionFor = (userId: string, token: string) => ({
  session: {
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    expiresAt: new Date('2099-09-01T00:00:00.000Z'),
    id: `active-${userId}`,
    ipAddress: '192.0.2.1',
    token,
    updatedAt: new Date('2026-09-04T00:00:00.000Z'),
    userAgent: 'Chrome',
    userId,
  },
  user: {
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    email: `${userId}@example.com`,
    emailVerified: true,
    id: userId,
    image: null,
    name: userId,
    updatedAt: new Date('2026-09-04T00:00:00.000Z'),
  },
});

const opaqueIdFor = (userId: string, token: string) =>
  createHmac('sha256', secret).update(`user-session\0${userId}\0${token}`).digest('base64url');

const callerFor = (userId: string | null) =>
  userSessionManagementRouter.createCaller({ serverDB: db, userId } as any);

const cleanup = async () => {
  await db.delete(authSessions).where(inArray(authSessions.userId, [actorUserId, otherUserId]));
  await db.delete(users).where(inArray(users.id, [actorUserId, otherUserId]));
};

beforeEach(async () => {
  await cleanup();
  await db.insert(users).values([
    { email: `${actorUserId}@example.com`, id: actorUserId },
    { email: `${otherUserId}@example.com`, id: otherUserId },
  ]);
  await db.insert(authSessions).values([
    {
      expiresAt: new Date('2099-09-01T00:00:00.000Z'),
      id: 'session-router-current',
      ipAddress: '192.0.2.25',
      token: currentToken,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/128.0.0.0 Safari/537.36',
      userId: actorUserId,
    },
    {
      expiresAt: new Date('2099-09-01T00:00:00.000Z'),
      id: 'session-router-other-own',
      ipAddress: '2001:db8:abcd::1',
      token: otherOwnToken,
      userAgent: 'Mozilla/5.0 (iPhone) Version/17.0 Mobile Safari/604.1',
      userId: actorUserId,
    },
    {
      expiresAt: new Date('2099-09-01T00:00:00.000Z'),
      id: 'session-router-other-user',
      ipAddress: '203.0.113.19',
      token: otherUserToken,
      userAgent: 'SECRET_OTHER_USER_AGENT',
      userId: otherUserId,
    },
  ]);

  mocks.getActiveSession.mockResolvedValue(sessionFor(actorUserId, currentToken));
  mocks.deleteSession.mockImplementation(async (token) => {
    await db.delete(authSessions).where(eq(authSessions.token, token));
  });
});

afterEach(async () => {
  vi.clearAllMocks();
  await cleanup();
});

describe('user session management tRPC authorization', () => {
  it('registers the dedicated current-user session router once', async () => {
    const source = await readFile(new URL('../index.ts', import.meta.url), 'utf8');
    expect(
      source.match(/import \{ userSessionManagementRouter \} from '\.\/userSessionManagement';/gu),
    ).toHaveLength(1);
    expect(source.match(/userSessionManagement: userSessionManagementRouter,/gu)).toHaveLength(1);
  });

  it('requires authentication for every procedure', async () => {
    await expect(callerFor(null).listSessions()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(
      callerFor(null).revokeSession({ sessionId: opaqueIdFor(actorUserId, otherOwnToken) }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('lists only the authenticated user sessions using the safe service projection', async () => {
    const result = await callerFor(actorUserId).listSessions();

    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ current: true, maskedIp: '192.0.*.*' }),
        expect.objectContaining({ current: false, maskedIp: '2001:db8:*' }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain(currentToken);
    expect(JSON.stringify(result)).not.toContain(otherOwnToken);
    expect(JSON.stringify(result)).not.toContain(otherUserToken);
    expect(JSON.stringify(result)).not.toContain('SECRET_OTHER_USER_AGENT');
  });

  it('rejects an auth context that does not match the current Better Auth session', async () => {
    mocks.getActiveSession.mockResolvedValue(sessionFor(otherUserId, otherUserToken));

    await expect(callerFor(actorUserId).listSessions()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Authenticated session is unavailable',
    });
  });

  it('strictly rejects caller-supplied identity fields and malformed opaque ids', async () => {
    await expect(
      (callerFor(actorUserId).listSessions as any)({ targetUserId: otherUserId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      callerFor(actorUserId).revokeSession({
        sessionId: opaqueIdFor(actorUserId, otherOwnToken),
        targetUserId: otherUserId,
      } as any),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      callerFor(actorUserId).revokeSession({ sessionId: 'not-an-opaque-session-id' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('protects the current session with an explicit forbidden response', async () => {
    await expect(
      callerFor(actorUserId).revokeSession({
        sessionId: opaqueIdFor(actorUserId, currentToken),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'The current session is protected' });

    await expect(
      db.select().from(authSessions).where(eq(authSessions.token, currentToken)),
    ).resolves.toHaveLength(1);
  });

  it('uses the same unavailable response for cross-user, missing, and replayed ids', async () => {
    const caller = callerFor(actorUserId);
    const unavailableIds = [
      opaqueIdFor(otherUserId, otherUserToken),
      opaqueIdFor(actorUserId, 'MISSING_SESSION_TOKEN'),
    ];

    for (const sessionId of unavailableIds) {
      await expect(caller.revokeSession({ sessionId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Session is unavailable',
      });
    }

    const ownSessionId = opaqueIdFor(actorUserId, otherOwnToken);
    await expect(caller.revokeSession({ sessionId: ownSessionId })).resolves.toEqual({
      revoked: true,
    });
    await expect(caller.revokeSession({ sessionId: ownSessionId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Session is unavailable',
    });
    await expect(
      db.select().from(authSessions).where(eq(authSessions.token, otherUserToken)),
    ).resolves.toHaveLength(1);
  });
});
