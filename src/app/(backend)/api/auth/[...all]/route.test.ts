// @vitest-environment node
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from './route';

type RouteHandler = (request: Request) => Promise<Response>;

const mocks = vi.hoisted(() => ({
  checkAbuse: vi.fn(),
  findUserByUsername: vi.fn(),
  getSession: vi.fn(),
  hasGlobalRole: vi.fn(),
  get: vi.fn<RouteHandler>(async () => Response.json({ ok: true })),
  post: vi.fn<RouteHandler>(async () => Response.json({ ok: true })),
}));

vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: vi.fn(() => ({
    GET: mocks.get,
    POST: mocks.post,
  })),
}));

vi.mock('@/auth', () => ({
  auth: {},
}));

vi.mock('@/libs/better-auth/getActiveSession', () => ({
  getActiveSession: mocks.getSession,
}));

vi.mock('@/libs/better-auth/auth-abuse-control', () => ({
  checkAuthAbuseLimit: mocks.checkAbuse,
}));

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'http://localhost:3010' },
}));

vi.mock('@lobechat/database', () => ({
  serverDB: {
    query: {
      users: { findFirst: mocks.findUserByUsername },
    },
  },
}));

vi.mock('@/database/models/rbac', () => ({
  RbacModel: vi.fn(() => ({ hasGlobalRole: mocks.hasGlobalRole })),
}));

const createPostRequest = (body: string, contentType = 'application/json') =>
  new Request('https://localhost/api/auth/sign-in/email', {
    body,
    headers: { 'Content-Type': contentType },
    method: 'POST',
  }) as NextRequest;

const createSensitivePostRequest = (
  pathname: string,
  origin?: string,
  body: Record<string, unknown> = { fixture: true },
) =>
  new Request(`https://localhost${pathname}`, {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...(origin && { Origin: origin }),
    },
    method: 'POST',
  }) as NextRequest;

describe('/api/auth/[...all] route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkAbuse.mockResolvedValue({ limited: false, retryAfter: 0 });
    mocks.findUserByUsername.mockResolvedValue(undefined);
    mocks.getSession.mockResolvedValue({ user: { id: 'ordinary-user' } });
    mocks.hasGlobalRole.mockResolvedValue(false);
    mocks.get.mockResolvedValue(Response.json({ ok: true }));
    mocks.post.mockResolvedValue(Response.json({ ok: true }));
  });

  it('returns 400 for malformed JSON auth requests before Better Auth handles them', async () => {
    const response = await POST(
      createPostRequest('{"email":"user@example.com","password":"secret",}'),
    );

    await expect(response.json()).resolves.toEqual({
      code: 'INVALID_JSON',
      message: 'Malformed JSON request body',
    });
    expect(response.status).toBe(400);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('passes valid JSON auth requests through without consuming the original body', async () => {
    mocks.post.mockImplementationOnce(async (request: Request) =>
      Response.json(await request.json()),
    );

    const response = await POST(
      createPostRequest(JSON.stringify({ email: 'user@example.com', password: 'secret' })),
    );

    await expect(response.json()).resolves.toEqual({
      email: 'user@example.com',
      password: 'secret',
    });
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('forces every password change to revoke sessions created under the old password', async () => {
    mocks.post.mockImplementationOnce(async (request: Request) =>
      Response.json(await request.json()),
    );

    const response = await POST(
      createSensitivePostRequest('/api/auth/change-password', 'http://localhost:3010', {
        currentPassword: 'old-password',
        newPassword: 'new-password',
        revokeOtherSessions: false,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ revokeOtherSessions: true });
  });

  it('resolves a password-reset username only on the server and keeps the response neutral', async () => {
    const forwardedBodies: Record<string, unknown>[] = [];
    let limitedIdentifier: unknown;
    mocks.findUserByUsername.mockResolvedValueOnce({ email: 'registered@example.test' });
    mocks.checkAbuse.mockImplementationOnce(async (request: Request) => {
      limitedIdentifier = (await request.clone().json()).email;
      return { limited: false, retryAfter: 0 };
    });
    mocks.post.mockImplementationOnce(async (request: Request) => {
      forwardedBodies.push(await request.json());
      return Response.json({ status: true });
    });

    const response = await POST(
      createSensitivePostRequest('/api/auth/request-password-reset', 'http://localhost:3010', {
        email: 'traveler_name',
        redirectTo: '/lobehub/reset-password?email=traveler_name',
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: true });
    expect(limitedIdentifier).toBe('traveler_name');
    expect(mocks.findUserByUsername).toHaveBeenCalledWith(
      expect.objectContaining({ columns: { email: true } }),
    );
    expect(forwardedBodies).toEqual([
      {
        email: 'registered@example.test',
        redirectTo: '/lobehub/reset-password?email=traveler_name',
      },
    ]);
  });

  it('uses the same neutral password-reset response for an unknown username', async () => {
    let forwardedBody: Record<string, unknown> | undefined;
    mocks.post.mockImplementationOnce(async (request: Request) => {
      forwardedBody = await request.json();
      return Response.json({ status: true });
    });

    const response = await POST(
      createSensitivePostRequest('/api/auth/request-password-reset', 'http://localhost:3010', {
        email: 'unknown_traveler',
        redirectTo: '/lobehub/reset-password?email=unknown_traveler',
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: true });
    expect(forwardedBody).toEqual({
      email: expect.stringMatching(/^username-[a-f0-9]{64}@invalid\.example$/),
      redirectTo: '/lobehub/reset-password?email=unknown_traveler',
    });
  });

  it('passes an email password-reset identifier through without a username lookup', async () => {
    let forwardedBody: Record<string, unknown> | undefined;
    mocks.post.mockImplementationOnce(async (request: Request) => {
      forwardedBody = await request.json();
      return Response.json({ status: true });
    });

    const response = await POST(
      createSensitivePostRequest('/api/auth/request-password-reset', 'http://localhost:3010', {
        email: 'traveler@example.test',
        redirectTo: '/lobehub/reset-password?email=traveler%40example.test',
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.findUserByUsername).not.toHaveBeenCalled();
    expect(forwardedBody).toEqual({
      email: 'traveler@example.test',
      redirectTo: '/lobehub/reset-password?email=traveler%40example.test',
    });
  });

  it.each([
    '/api/auth/sign-up/email',
    '/api/auth/sign-in/email',
    '/api/auth/request-password-reset',
    '/api/auth/reset-password',
    '/api/auth/change-email',
    '/api/auth/change-password',
    '/api/auth/sign-out',
    '/api/auth/revoke-other-sessions',
    '/api/auth/revoke-sessions',
    '/api/auth/sign-in/magic-link',
    '/api/auth/email-otp/send-verification-otp',
    '/api/auth/email-otp/check-verification-otp',
    '/api/auth/email-otp/verify-email',
    '/api/auth/sign-in/email-otp',
    '/api/auth/email-otp/request-password-reset',
    '/api/auth/forget-password/email-otp',
    '/api/auth/email-otp/reset-password',
    '/api/auth/email-otp/request-email-change',
    '/api/auth/email-otp/change-email',
    '/lobehub/api/auth/change-email',
  ])('rejects an untrusted browser Origin before sensitive write %s', async (pathname) => {
    const response = await POST(
      createSensitivePostRequest(pathname, 'https://untrusted.example.test'),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_ORIGIN' });
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('allows native clients without Origin and same-origin browser writes', async () => {
    const nativeResponse = await POST(createSensitivePostRequest('/api/auth/sign-in/email'));
    const browserResponse = await POST(
      createSensitivePostRequest('/api/auth/sign-in/email', 'http://localhost:3010'),
    );

    expect(nativeResponse.status).toBe(200);
    expect(browserResponse.status).toBe(200);
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it.each(['known-fixture', 'unknown-fixture'])(
    'returns the same generic response for a limited account class',
    async (email) => {
      mocks.checkAbuse.mockResolvedValueOnce({ limited: true, retryAfter: 60 });
      const response = await POST(
        createSensitivePostRequest('/api/auth/sign-in/email', undefined, { email }),
      );

      expect(response.status).toBe(429);
      expect(response.headers.get('retry-after')).toBe('60');
      await expect(response.json()).resolves.toEqual({
        code: 'TOO_MANY_REQUESTS',
        message: 'Please try again later',
      });
      expect(mocks.post).not.toHaveBeenCalled();
    },
  );

  it('fails safely when configured rate-limit storage is unavailable', async () => {
    mocks.checkAbuse.mockResolvedValueOnce({ limited: false, retryAfter: 0, unavailable: true });

    const response = await POST(
      createSensitivePostRequest('/api/auth/request-password-reset', undefined, {
        email: 'limited_traveler',
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: 'AUTH_TEMPORARILY_UNAVAILABLE',
      message: 'Please try again later',
    });
    expect(mocks.findUserByUsername).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it.each([
    { code: 'USER_NOT_FOUND', status: 400 },
    { code: 'INVALID_OTP', status: 400 },
    { code: 'OTP_EXPIRED', status: 400 },
    { code: 'TOO_MANY_ATTEMPTS', status: 403 },
  ])('normalizes OTP account and guessing failures', async ({ code, status }) => {
    mocks.post.mockResolvedValueOnce(Response.json({ code, message: 'fixture' }, { status }));

    const response = await POST(createSensitivePostRequest('/api/auth/sign-in/email-otp'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: 'INVALID_OTP',
      message: 'Invalid or expired verification code',
    });
  });

  it('delegates non-JSON auth requests to Better Auth', async () => {
    const response = await POST(
      createPostRequest(
        'email=user%40example.com&password=secret',
        'application/x-www-form-urlencoded',
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('delegates GET requests to Better Auth', async () => {
    const request = new Request('https://localhost/api/auth/get-session') as NextRequest;

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mocks.get).toHaveBeenCalledWith(request);
  });

  it('applies the shared limiter before a token-gated verification continuation', async () => {
    mocks.checkAbuse.mockResolvedValueOnce({ limited: true, retryAfter: 60 });
    const request = new Request(
      'https://localhost/api/auth/verify-email?token=opaque-fixture',
    ) as NextRequest;

    const response = await GET(request);

    expect(response.status).toBe(429);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('returns an anonymous session when the current database account is inactive', async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const request = new Request('https://localhost/api/auth/get-session') as NextRequest;

    const response = await GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('rejects ordinary customers from Better Auth user-management endpoints', async () => {
    const getResponse = await GET(
      new Request('https://localhost/api/auth/admin/list-users') as NextRequest,
    );
    const postResponse = await POST(
      new Request('https://localhost/api/auth/admin/create-user', {
        body: JSON.stringify({ email: 'new@example.com', name: 'New User', password: 'secret' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }) as NextRequest,
    );

    expect(getResponse.status).toBe(403);
    expect(postResponse.status).toBe(403);
  });

  it('rejects unauthenticated user-management requests', async () => {
    mocks.getSession.mockResolvedValueOnce(null);

    const response = await GET(
      new Request('https://localhost/api/auth/admin/list-users') as NextRequest,
    );

    expect(response.status).toBe(401);
  });

  it('allows a global super_admin to use Better Auth user management', async () => {
    mocks.hasGlobalRole.mockResolvedValueOnce(true);

    const response = await GET(
      new Request('https://localhost/api/auth/admin/list-users') as NextRequest,
    );

    expect(response.status).toBe(200);
  });
});
