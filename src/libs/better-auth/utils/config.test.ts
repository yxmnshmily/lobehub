import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSecondaryStorage, getTrustedOrigins, normalizeOrigin } from './config';

const mocks = vi.hoisted(() => {
  const redisClient = {
    del: vi.fn(),
    eval: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  };

  return {
    appEnv: { APP_URL: 'http://localhost:3010/lobehub' },
    authEnv: {
      AUTH_ADDITIONAL_TRUSTED_ORIGINS: undefined as string | undefined,
      AUTH_TRUSTED_ORIGINS: undefined as string | undefined,
    },
    initializeRedis: vi.fn().mockResolvedValue(redisClient),
    isRedisEnabled: vi.fn(() => false),
    redisClient,
  };
});

vi.mock('@/envs/app', () => ({ appEnv: mocks.appEnv }));
vi.mock('@/envs/auth', () => ({ authEnv: mocks.authEnv }));
vi.mock('@/envs/redis', () => ({ getRedisConfig: vi.fn(() => ({})) }));
vi.mock('@/libs/redis', () => ({
  initializeRedis: mocks.initializeRedis,
  isRedisEnabled: mocks.isRedisEnabled,
}));
vi.mock('@/utils/env', () => ({ isDev: false }));

describe('Better Auth trusted origins', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appEnv.APP_URL = 'http://localhost:3010/lobehub';
    mocks.authEnv.AUTH_ADDITIONAL_TRUSTED_ORIGINS = undefined;
    mocks.authEnv.AUTH_TRUSTED_ORIGINS = undefined;
    mocks.initializeRedis.mockResolvedValue(mocks.redisClient);
    mocks.isRedisEnabled.mockReturnValue(false);
    process.env = { ...originalEnv };
    delete process.env.VERCEL_BRANCH_URL;
    delete process.env.VERCEL_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it.each([
    ['http://localhost:3010/lobehub', 'http://localhost:3010'],
    ['https://travel.example.test/lobehub', 'https://travel.example.test'],
  ])('derives the callback origin from configurable APP_URL %s', (appUrl, expectedOrigin) => {
    mocks.appEnv.APP_URL = appUrl;

    expect(getTrustedOrigins([])).toContain(expectedOrigin);
  });

  it('normalizes configured callback origins without preserving paths or duplicates', () => {
    mocks.authEnv.AUTH_TRUSTED_ORIGINS =
      'https://travel.example.test/lobehub, https://travel.example.test';

    expect(getTrustedOrigins([])).toEqual(['https://travel.example.test']);
  });

  it('appends normalized additional origins to provider-aware defaults', () => {
    mocks.authEnv.AUTH_ADDITIONAL_TRUSTED_ORIGINS = [
      'https://gateway.example.com/signin',
      'gateway.example.com/another-path',
    ].join(',');

    expect(getTrustedOrigins(['apple'])).toEqual([
      'http://localhost:3010',
      'com.lobehub.app://',
      'https://appleid.apple.com',
      'https://gateway.example.com',
    ]);
  });

  it('appends additional origins without changing override semantics', () => {
    mocks.authEnv.AUTH_TRUSTED_ORIGINS = 'https://override.example.com/callback';
    mocks.authEnv.AUTH_ADDITIONAL_TRUSTED_ORIGINS = 'https://gateway.example.com/signin';

    expect(getTrustedOrigins(['apple'])).toEqual([
      'https://override.example.com',
      'https://gateway.example.com',
    ]);
  });

  it('rejects malformed callback origins', () => {
    expect(normalizeOrigin('javascript:alert(1)')).toBeUndefined();
  });

  it('atomically consumes a Better Auth verification value from Redis', async () => {
    mocks.isRedisEnabled.mockReturnValue(true);
    mocks.redisClient.eval.mockResolvedValueOnce('serialized-verification');
    const storage = createSecondaryStorage();
    expect(storage).toBeDefined();

    const consumed = await storage!.getAndDelete('verification:token-fingerprint');

    expect(consumed).toBe('serialized-verification');
    expect(mocks.redisClient.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('DEL', KEYS[1])"),
      1,
      'better-auth:verification:token-fingerprint',
    );
    expect(mocks.redisClient.get).not.toHaveBeenCalled();
    expect(mocks.redisClient.del).not.toHaveBeenCalled();
  });
});
