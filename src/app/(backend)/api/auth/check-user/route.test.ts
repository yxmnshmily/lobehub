// @vitest-environment node
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const mocks = vi.hoisted(() => ({
  abuseDecision: vi.fn(),
}));

vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://travel.example.test/lobehub' } }));
vi.mock('@/libs/better-auth/auth-abuse-control', () => ({
  checkAuthAbuseLimit: mocks.abuseDecision,
}));
const request = (email: string, origin = 'https://travel.example.test') =>
  new Request('https://travel.example.test/api/auth/check-user', {
    body: JSON.stringify({ email }),
    headers: { 'content-type': 'application/json', origin },
    method: 'POST',
  }) as NextRequest;

describe('POST /api/auth/check-user', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.abuseDecision.mockResolvedValue({ limited: false, retryAfter: 0 });
  });

  it('returns the same non-enumerating response for existing and unknown emails', async () => {
    const existing = await POST(request('known@example.test'));

    const unknown = await POST(request('unknown@example.test'));

    expect(existing.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await existing.json()).toEqual({ canAttemptSignIn: true });
    expect(await unknown.json()).toEqual({ canAttemptSignIn: true });
  });

  it('rejects an explicitly untrusted browser origin', async () => {
    const response = await POST(request('user@example.test', 'https://evil.example'));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: 'INVALID_ORIGIN',
      message: 'Invalid request origin',
    });
  });

  it('fails closed when the shared auth abuse limiter is unavailable', async () => {
    mocks.abuseDecision.mockResolvedValueOnce({
      limited: false,
      retryAfter: 0,
      unavailable: true,
    });

    const response = await POST(request('user@example.test'));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: 'AUTH_TEMPORARILY_UNAVAILABLE',
      message: 'Please try again later',
    });
  });

  it('returns the shared retry contract when the lookup is rate limited', async () => {
    mocks.abuseDecision.mockResolvedValueOnce({ limited: true, retryAfter: 42 });

    const response = await POST(request('user@example.test'));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('42');
    expect(await response.json()).toEqual({
      code: 'TOO_MANY_REQUESTS',
      message: 'Please try again later',
    });
  });
});
