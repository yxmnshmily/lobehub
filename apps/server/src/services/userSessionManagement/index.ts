import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

import type { LobeChatDatabase } from '@lobechat/database';
import { and, desc, eq, gt } from 'drizzle-orm';

import { auth } from '@/auth';
import { session as authSessions } from '@/database/schemas';

export type UserSessionManagementErrorCode =
  | 'CURRENT_SESSION_PROTECTED'
  | 'INVALID_AUTH_CONTEXT'
  | 'INVALID_OPAQUE_ID_SECRET'
  | 'SESSION_REVOCATION_FAILED'
  | 'SESSION_UNAVAILABLE';

const errorMessages: Record<UserSessionManagementErrorCode, string> = {
  CURRENT_SESSION_PROTECTED: 'The current session cannot be revoked here.',
  INVALID_AUTH_CONTEXT: 'Authenticated session context is unavailable.',
  INVALID_OPAQUE_ID_SECRET: 'Session identifier protection is unavailable.',
  SESSION_REVOCATION_FAILED: 'The session could not be revoked. Retry the operation.',
  SESSION_UNAVAILABLE: 'Session is unavailable.',
};

export class UserSessionManagementError extends Error {
  constructor(readonly code: UserSessionManagementErrorCode) {
    super(errorMessages[code]);
    this.name = 'UserSessionManagementError';
  }
}

export interface UserSessionManagementOptions {
  actorUserId: string;
  currentSessionToken: string;
  deleteSessionByToken?: (token: string) => Promise<unknown>;
  now?: () => Date;
  opaqueIdSecret: string;
}

export interface SafeUserSession {
  browserName: string;
  createdAt: Date;
  current: boolean;
  deviceName: string;
  expiresAt: Date;
  maskedIp: string | null;
  sessionId: string;
  updatedAt: Date;
}

interface SessionRecord {
  createdAt: Date;
  expiresAt: Date;
  id: string;
  ipAddress: string | null;
  token: string;
  updatedAt: Date;
  userAgent: string | null;
  userId: string;
}

const OPAQUE_ID_PATTERN = /^[\w-]{43}$/;
const MINIMUM_SECRET_BYTES = 32;

const maskIpAddress = (value: string | null): string | null => {
  if (!value) return null;

  const ipVersion = isIP(value);
  if (ipVersion === 4) {
    const [first, second] = value.split('.');
    return `${first}.${second}.*.*`;
  }
  if (ipVersion === 6) {
    const visibleSegments = value.split(':').filter(Boolean).slice(0, 2);
    return visibleSegments.length === 2 ? `${visibleSegments.join(':')}:*` : 'IPv6';
  }

  return null;
};

const describeUserAgent = (userAgent: string | null) => {
  if (!userAgent) return { browserName: 'Unknown browser', deviceName: 'Unknown device' };

  const browserName = userAgent.includes('Edg/')
    ? 'Edge'
    : userAgent.includes('Firefox/')
      ? 'Firefox'
      : userAgent.includes('Chrome/') || userAgent.includes('CriOS/')
        ? 'Chrome'
        : userAgent.includes('Safari/')
          ? 'Safari'
          : 'Unknown browser';
  const deviceName = userAgent.includes('iPhone')
    ? 'iPhone'
    : userAgent.includes('iPad')
      ? 'iPad'
      : userAgent.includes('Android')
        ? 'Android'
        : userAgent.includes('Mac OS X')
          ? 'macOS'
          : userAgent.includes('Windows')
            ? 'Windows'
            : userAgent.includes('Linux')
              ? 'Linux'
              : 'Unknown device';

  return { browserName, deviceName };
};

export class UserSessionManagementService {
  private readonly deleteSessionByToken: (token: string) => Promise<unknown>;
  private readonly now: () => Date;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly options: UserSessionManagementOptions,
  ) {
    if (Buffer.byteLength(options.opaqueIdSecret, 'utf8') < MINIMUM_SECRET_BYTES) {
      throw new UserSessionManagementError('INVALID_OPAQUE_ID_SECRET');
    }
    this.now = options.now ?? (() => new Date());
    this.deleteSessionByToken =
      options.deleteSessionByToken ??
      (async (token) => {
        const context = await auth.$context;
        await context.internalAdapter.deleteSession(token);
      });
  }

  async listSessions(): Promise<SafeUserSession[]> {
    const records = await this.getAuthenticatedActorSessions();
    return records.map((record) => {
      const device = describeUserAgent(record.userAgent);
      return {
        ...device,
        createdAt: record.createdAt,
        current: record.token === this.options.currentSessionToken,
        expiresAt: record.expiresAt,
        maskedIp: maskIpAddress(record.ipAddress),
        sessionId: this.createOpaqueId(record.token),
        updatedAt: record.updatedAt,
      };
    });
  }

  async revokeSession(sessionId: string): Promise<{ revoked: true }> {
    if (!OPAQUE_ID_PATTERN.test(sessionId)) {
      throw new UserSessionManagementError('SESSION_UNAVAILABLE');
    }

    const records = await this.getAuthenticatedActorSessions();
    const target = records.find((record) => this.matchesOpaqueId(sessionId, record.token));
    if (!target) throw new UserSessionManagementError('SESSION_UNAVAILABLE');
    if (target.token === this.options.currentSessionToken) {
      throw new UserSessionManagementError('CURRENT_SESSION_PROTECTED');
    }

    try {
      await this.deleteSessionByToken(target.token);
    } catch {
      throw new UserSessionManagementError('SESSION_REVOCATION_FAILED');
    }

    const [remaining] = await this.db
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(and(eq(authSessions.id, target.id), eq(authSessions.userId, this.options.actorUserId)))
      .limit(1);
    if (remaining) throw new UserSessionManagementError('SESSION_REVOCATION_FAILED');

    return { revoked: true };
  }

  private createOpaqueId(sessionToken: string) {
    return createHmac('sha256', this.options.opaqueIdSecret)
      .update(`user-session\0${this.options.actorUserId}\0${sessionToken}`)
      .digest('base64url');
  }

  private async getAuthenticatedActorSessions(): Promise<SessionRecord[]> {
    const now = this.now();
    const records = await this.db
      .select({
        createdAt: authSessions.createdAt,
        expiresAt: authSessions.expiresAt,
        id: authSessions.id,
        ipAddress: authSessions.ipAddress,
        token: authSessions.token,
        updatedAt: authSessions.updatedAt,
        userAgent: authSessions.userAgent,
        userId: authSessions.userId,
      })
      .from(authSessions)
      .where(
        and(eq(authSessions.userId, this.options.actorUserId), gt(authSessions.expiresAt, now)),
      )
      .orderBy(desc(authSessions.updatedAt), desc(authSessions.id));

    if (!records.some((record) => record.token === this.options.currentSessionToken)) {
      throw new UserSessionManagementError('INVALID_AUTH_CONTEXT');
    }

    return records;
  }

  private matchesOpaqueId(candidate: string, sessionToken: string) {
    const expected = this.createOpaqueId(sessionToken);
    const candidateBuffer = Buffer.from(candidate, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    return (
      candidateBuffer.length === expectedBuffer.length &&
      timingSafeEqual(candidateBuffer, expectedBuffer)
    );
  }
}
