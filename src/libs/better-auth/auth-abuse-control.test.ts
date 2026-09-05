// @vitest-environment node
import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BoundedAuthAbuseStore,
  buildAuthAbuseKeys,
  checkAuthAbuseLimit,
  normalizeRateLimitEmail,
  resolveTrustedClientIp,
} from './auth-abuse-control';

const mocks = vi.hoisted(() => ({
  authEnv: { AUTH_SECRET: 'test-only-auth-secret-with-sufficient-length' },
  getRedisConfig: vi.fn(),
  initializeRedis: vi.fn(),
  isRedisEnabled: vi.fn(),
}));

vi.mock('@/envs/redis', () => ({ getRedisConfig: mocks.getRedisConfig }));
vi.mock('@/envs/auth', () => ({ authEnv: mocks.authEnv }));
vi.mock('@/libs/redis', () => ({
  initializeRedis: mocks.initializeRedis,
  isRedisEnabled: mocks.isRedisEnabled,
}));

describe('auth abuse control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRedisConfig.mockReturnValue({ enabled: false });
    mocks.isRedisEnabled.mockReturnValue(false);
  });

  it('normalizes email identities before deriving non-PII keys', () => {
    const normalized = normalizeRateLimitEmail('  Traveler@Example.Test  ');
    const first = buildAuthAbuseKeys('/sign-in/email', '192.0.2.10', normalized);
    const second = buildAuthAbuseKeys('/sign-in/email', '192.0.2.10', 'traveler@example.test');
    const otherIp = buildAuthAbuseKeys('/sign-in/email', '192.0.2.11', normalized);

    expect(normalized).toBe('traveler@example.test');
    expect(normalizeRateLimitEmail('ＴRAVELER@EXAMPLE.TEST')).toBe('traveler@example.test');
    expect(first).toEqual(second);
    expect(first[0]).not.toBe(otherIp[0]);
    expect(first[1]).toBe(otherIp[1]);
    expect(first.join(':')).not.toContain('traveler@example.test');
    expect(first.join(':')).not.toContain('192.0.2.10');
  });

  it('accepts only trusted proxy headers and canonicalizes IPv4 and IPv6', () => {
    expect(
      resolveTrustedClientIp(
        new Headers({ 'x-real-ip': '192.0.2.10' }),
        'production',
        'x-real-ip',
      ),
    ).toBe('192.0.2.10');
    expect(
      resolveTrustedClientIp(
        new Headers({
          'x-forwarded-for': '198.51.100.2, 2001:0db8:0:0::1',
          'x-real-ip': '203.0.113.200',
        }),
        'production',
        'x-forwarded-for',
      ),
    ).toBe('2001:db8::1');
    expect(
      resolveTrustedClientIp(new Headers({ forwarded: 'for=203.0.113.9' }), 'production'),
    ).toBeNull();
    expect(
      resolveTrustedClientIp(new Headers({ 'x-real-ip': '203.0.113.9' }), 'production'),
    ).toBeNull();
    expect(resolveTrustedClientIp(new Headers(), 'development')).toBe('127.0.0.1');
  });

  it('counts concurrent attempts atomically and resets after the window', async () => {
    let now = 1_000;
    const store = new BoundedAuthAbuseStore(16, () => now);
    const attempts = await Promise.all(
      Array.from({ length: 6 }, () => store.consume(['fixture'], [5], 60)),
    );

    expect(attempts.filter((attempt) => attempt.limited)).toHaveLength(1);
    now += 60_001;
    await expect(store.consume(['fixture'], [5], 60)).resolves.toEqual({
      limited: false,
      retryAfter: 0,
    });
  });

  it('keeps different account buckets independent behind one IP', async () => {
    const store = new BoundedAuthAbuseStore(32, () => 1_000);
    const first = buildAuthAbuseKeys('/sign-in/email', '192.0.2.10', 'first@example.test');
    const second = buildAuthAbuseKeys('/sign-in/email', '192.0.2.10', 'second@example.test');

    for (let index = 0; index < 5; index++) {
      await expect(store.consume(first, [30, 5], 60)).resolves.toMatchObject({ limited: false });
    }
    await expect(store.consume(second, [30, 5], 60)).resolves.toMatchObject({ limited: false });
  });

  it('accumulates the same account bucket across different IP addresses', async () => {
    const store = new BoundedAuthAbuseStore(32, () => 1_000);
    const firstIp = buildAuthAbuseKeys('/request-password-reset', '192.0.2.10', 'same-fixture');
    const secondIp = buildAuthAbuseKeys('/request-password-reset', '192.0.2.11', 'same-fixture');

    for (let index = 0; index < 3; index++) {
      await expect(store.consume(firstIp, [20, 3], 900)).resolves.toMatchObject({ limited: false });
    }
    await expect(store.consume(secondIp, [20, 3], 900)).resolves.toMatchObject({ limited: true });
  });

  it('evicts entries at its fixed capacity instead of growing without bound', async () => {
    const store = new BoundedAuthAbuseStore(2, () => 1_000);
    await store.consume(['one'], [5], 60);
    await store.consume(['two'], [5], 60);
    await store.consume(['three'], [5], 60);

    expect(store.size).toBe(2);
  });

  it('limits normalized account variants without blocking a different account on the same IP', async () => {
    const request = (email: string) =>
      new Request('https://example.test/api/auth/sign-in/email', {
        body: JSON.stringify({ email }),
        headers: { 'content-type': 'application/json', 'x-real-ip': '192.0.2.40' },
        method: 'POST',
      });

    for (let index = 0; index < 5; index++) {
      await expect(checkAuthAbuseLimit(request('  CASE-Fixture  '))).resolves.toMatchObject({
        limited: false,
      });
    }
    await expect(checkAuthAbuseLimit(request('case-fixture'))).resolves.toMatchObject({
      limited: true,
    });
    await expect(checkAuthAbuseLimit(request('independent-fixture'))).resolves.toMatchObject({
      limited: false,
    });
  });

  it('uses one Redis script call for both IP and account buckets', async () => {
    const evalCommand = vi.fn().mockResolvedValue(0);
    mocks.isRedisEnabled.mockReturnValue(true);
    mocks.getRedisConfig.mockReturnValue({ enabled: true });
    mocks.initializeRedis.mockResolvedValue({ eval: evalCommand });
    const request = new Request('https://example.test/api/auth/sign-in/email', {
      body: JSON.stringify({ email: 'redis-fixture' }),
      headers: { 'content-type': 'application/json', 'x-real-ip': '192.0.2.20' },
      method: 'POST',
    });

    await expect(checkAuthAbuseLimit(request)).resolves.toMatchObject({ limited: false });
    expect(evalCommand).toHaveBeenCalledTimes(1);
    expect(evalCommand.mock.calls[0][1]).toBe(2);
    expect(evalCommand.mock.calls[0].slice(2, 4).every((key) => !key.includes('redis-fixture'))).toBe(
      true,
    );
  });

  it.each([
    ['/change-email', 'newEmail'],
    ['/sign-in/magic-link', 'email'],
    ['/email-otp/send-verification-otp', 'email'],
    ['/email-otp/check-verification-otp', 'email'],
    ['/email-otp/verify-email', 'email'],
    ['/sign-in/email-otp', 'email'],
    ['/email-otp/request-password-reset', 'email'],
    ['/forget-password/email-otp', 'email'],
    ['/email-otp/reset-password', 'email'],
    ['/email-otp/request-email-change', 'newEmail'],
    ['/email-otp/change-email', 'newEmail'],
  ])('routes enabled mail and OTP path %s through the same atomic limiter', async (path, field) => {
    const evalCommand = vi.fn().mockResolvedValue(0);
    mocks.isRedisEnabled.mockReturnValue(true);
    mocks.getRedisConfig.mockReturnValue({ enabled: true });
    mocks.initializeRedis.mockResolvedValue({ eval: evalCommand });
    const request = new Request(`https://example.test/api/auth${path}`, {
      body: JSON.stringify({ [field]: 'endpoint-fixture' }),
      headers: { 'content-type': 'application/json', 'x-real-ip': '192.0.2.60' },
      method: 'POST',
    });

    await expect(checkAuthAbuseLimit(request)).resolves.toMatchObject({ limited: false });
    expect(evalCommand).toHaveBeenCalledTimes(1);
    expect(evalCommand.mock.calls[0][1]).toBe(2);
  });

  it('rate-limits token-gated verification continuations by their signed email payload', async () => {
    const evalCommand = vi.fn().mockResolvedValue(0);
    mocks.isRedisEnabled.mockReturnValue(true);
    mocks.getRedisConfig.mockReturnValue({ enabled: true });
    mocks.initializeRedis.mockResolvedValue({ eval: evalCommand });
    const token = await new SignJWT({ updateTo: 'change-fixture' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(mocks.authEnv.AUTH_SECRET));
    const request = new Request(
      `https://example.test/api/auth/verify-email?token=${token}`,
      { headers: { 'x-real-ip': '192.0.2.70' } },
    );

    await expect(checkAuthAbuseLimit(request)).resolves.toMatchObject({ limited: false });
    expect(evalCommand).toHaveBeenCalledTimes(1);
    expect(evalCommand.mock.calls[0][1]).toBe(2);
  });

  it('does not let an unsigned payload consume another account verification bucket', async () => {
    const evalCommand = vi.fn().mockResolvedValue(0);
    mocks.isRedisEnabled.mockReturnValue(true);
    mocks.getRedisConfig.mockReturnValue({ enabled: true });
    mocks.initializeRedis.mockResolvedValue({ eval: evalCommand });
    const payload = Buffer.from(JSON.stringify({ updateTo: 'target-fixture' })).toString('base64url');
    const request = new Request(
      `https://example.test/api/auth/verify-email?token=fixture.${payload}.invalid`,
      { headers: { 'x-real-ip': '192.0.2.71' } },
    );

    await expect(checkAuthAbuseLimit(request)).resolves.toMatchObject({ limited: false });
    expect(evalCommand.mock.calls[0][1]).toBe(1);
  });

  it('fails safely when configured Redis cannot initialize', async () => {
    mocks.isRedisEnabled.mockReturnValue(true);
    mocks.getRedisConfig.mockReturnValue({ enabled: true });
    mocks.initializeRedis.mockRejectedValue(new Error('fixture'));
    const request = new Request('https://example.test/api/auth/request-password-reset', {
      body: JSON.stringify({ email: 'failure-fixture' }),
      headers: { 'content-type': 'application/json', 'x-real-ip': '192.0.2.30' },
      method: 'POST',
    });

    await expect(checkAuthAbuseLimit(request)).resolves.toMatchObject({ unavailable: true });
  });

  it('fails safely in production when no trusted proxy address is available', async () => {
    const originalEnvironment = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      const request = new Request('https://example.test/api/auth/sign-in/email', {
        body: 'email=form-fixture',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        method: 'POST',
      });

      await expect(checkAuthAbuseLimit(request)).resolves.toMatchObject({ unavailable: true });
    } finally {
      process.env.NODE_ENV = originalEnvironment;
    }
  });

  it('fails closed in production when Redis is not configured', async () => {
    const originalEnvironment = process.env.NODE_ENV;
    const originalTrustedHeader = process.env.AUTH_TRUSTED_IP_HEADER;
    try {
      process.env.NODE_ENV = 'production';
      process.env.AUTH_TRUSTED_IP_HEADER = 'x-real-ip';
      const request = new Request('https://example.test/api/auth/sign-in/email', {
        body: JSON.stringify({ email: 'production-fixture' }),
        headers: { 'content-type': 'application/json', 'x-real-ip': '192.0.2.50' },
        method: 'POST',
      });

      await expect(checkAuthAbuseLimit(request)).resolves.toMatchObject({ unavailable: true });
    } finally {
      process.env.NODE_ENV = originalEnvironment;
      if (originalTrustedHeader === undefined) delete process.env.AUTH_TRUSTED_IP_HEADER;
      else process.env.AUTH_TRUSTED_IP_HEADER = originalTrustedHeader;
    }
  });
});
