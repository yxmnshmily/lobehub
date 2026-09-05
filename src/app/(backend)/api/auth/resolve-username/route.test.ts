// @vitest-environment node
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const mocks = vi.hoisted(() => ({
  abuseDecision: vi.fn(),
  authSignInEmail: vi.fn(),
  select: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: { api: { signInEmail: mocks.authSignInEmail } } }));
vi.mock('@/database/server', () => ({ serverDB: { select: mocks.select } }));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://travel.example.test/lobehub' } }));
vi.mock('@/libs/better-auth/auth-abuse-control', () => ({
  checkAuthAbuseLimit: mocks.abuseDecision,
}));

const request = (
  username: string,
  password = 'Valid-password-123!',
  origin = 'https://travel.example.test',
  callbackURL = '/lobehub/',
) =>
  new Request('https://travel.example.test/api/auth/resolve-username', {
    body: JSON.stringify({ callbackURL, password, username }),
    headers: { 'content-type': 'application/json', origin },
    method: 'POST',
  }) as NextRequest;

const mockUserLookup = (email?: string) => {
  mocks.select.mockReturnValueOnce({
    from: () => ({ where: () => ({ limit: async () => (email ? [{ email }] : []) }) }),
  });
};

describe('POST /api/auth/resolve-username', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.abuseDecision.mockResolvedValue({ limited: false, retryAfter: 0 });
  });

  it('never returns the email address for a valid username login', async () => {
    mockUserLookup('owner@example.test');
    mocks.authSignInEmail.mockImplementationOnce(async ({ body }) => {
      if (body.email !== 'owner@example.test' || body.password !== 'Valid-password-123!') {
        return Response.json({ code: 'INVALID_CREDENTIALS' }, { status: 401 });
      }
      return Response.json(
        { token: 'secret-token', user: { email: 'owner@example.test', id: 'user-1' } },
        { headers: { 'set-cookie': 'session=abc; HttpOnly; Path=/' }, status: 200 },
      );
    });

    const response = await POST(request('owner'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie') || '').toContain('session=abc');
    expect(payload).toEqual({ authenticated: true });
    expect(JSON.stringify(payload)).not.toContain('owner@example.test');
  });

  it('returns equivalent credential failures for known and unknown usernames', async () => {
    mocks.authSignInEmail.mockResolvedValue(
      Response.json({ code: 'INVALID_EMAIL_OR_PASSWORD' }, { status: 401 }),
    );

    mockUserLookup('known@example.test');
    const known = await POST(request('known', 'wrong-password'));

    mockUserLookup();
    const unknown = await POST(request('unknown', 'wrong-password'));

    expect(known.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await known.json()).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
    expect(await unknown.json()).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
    expect(mocks.authSignInEmail).toHaveBeenCalledTimes(2);
    expect(mocks.authSignInEmail.mock.calls[1][0].body.email).toMatch(
      /^username-[a-f\d]{64}@invalid\.example$/,
    );
  });

  it('does not forward an untrusted callback to the credential provider', async () => {
    mockUserLookup('owner@example.test');
    mocks.authSignInEmail.mockResolvedValueOnce(
      Response.json(
        { token: 'secret-token', user: { email: 'owner@example.test', id: 'user-1' } },
        { headers: { 'set-cookie': 'session=abc; HttpOnly; Path=/' }, status: 200 },
      ),
    );

    const response = await POST(
      request('owner', 'Valid-password-123!', 'https://travel.example.test', '//evil.example'),
    );

    expect(response.status).toBe(200);
    expect(mocks.authSignInEmail.mock.calls[0][0].body.callbackURL).toBe('/');
  });

  it('rejects an explicitly untrusted origin before looking up the username', async () => {
    const response = await POST(request('owner', 'Valid-password-123!', 'https://evil.example'));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: 'INVALID_ORIGIN',
      message: 'Invalid request origin',
    });
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.authSignInEmail).not.toHaveBeenCalled();
  });

  it('fails closed before looking up the username when abuse control is unavailable', async () => {
    mocks.abuseDecision.mockResolvedValueOnce({
      limited: false,
      retryAfter: 0,
      unavailable: true,
    });

    const response = await POST(request('owner'));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: 'AUTH_TEMPORARILY_UNAVAILABLE',
      message: 'Please try again later',
    });
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.authSignInEmail).not.toHaveBeenCalled();
  });

  it('returns the shared retry contract before looking up a rate-limited username', async () => {
    mocks.abuseDecision.mockResolvedValueOnce({ limited: true, retryAfter: 42 });

    const response = await POST(request('owner'));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('42');
    expect(await response.json()).toEqual({
      code: 'TOO_MANY_REQUESTS',
      message: 'Please try again later',
    });
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.authSignInEmail).not.toHaveBeenCalled();
  });
});
