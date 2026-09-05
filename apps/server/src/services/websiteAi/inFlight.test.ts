import { describe, expect, it } from 'vitest';

import { createWebsiteAiInFlightLimiter } from './inFlight';

class FakeLeaseRedis {
  failEval = false;
  failSet = false;
  now = 1_000;
  readonly values = new Map<string, { expiresAt: number; value: string }>();

  private expireKey(key: string) {
    const entry = this.values.get(key);
    if (entry && entry.expiresAt <= this.now) this.values.delete(key);
  }

  async eval(_script: string, _keys: number, key: string, owner: string, ttl?: string) {
    if (this.failEval) throw new Error('redis unavailable');
    this.expireKey(key);
    const entry = this.values.get(key);
    if (entry?.value !== owner) return 0;
    if (ttl) {
      entry.expiresAt = this.now + Number(ttl) * 1000;
      return 1;
    }
    this.values.delete(key);
    return 1;
  }

  async set(key: string, value: string, _expiry: 'EX', ttl: number, _mode: 'NX') {
    if (this.failSet) throw new Error('redis unavailable');
    this.expireKey(key);
    if (this.values.has(key)) return null;
    this.values.set(key, { expiresAt: this.now + ttl * 1000, value });
    return 'OK';
  }
}

describe('website AI in-flight limiter', () => {
  it('holds one local fallback lease per user without blocking another user', async () => {
    const limiter = createWebsiteAiInFlightLimiter({ getRedis: () => null });
    const first = await limiter.acquire('user-a');

    expect(first).toBeDefined();
    await expect(limiter.acquire('user-a')).resolves.toBeUndefined();
    await expect(limiter.acquire('user-b')).resolves.toBeDefined();

    await first?.release();
    await expect(limiter.acquire('user-a')).resolves.toBeDefined();
  });

  it('fails closed at the configured local fallback capacity', async () => {
    const limiter = createWebsiteAiInFlightLimiter({ getRedis: () => null, maxEntries: 2 });

    await expect(limiter.acquire('user-a')).resolves.toBeDefined();
    await expect(limiter.acquire('user-b')).resolves.toBeDefined();
    await expect(limiter.acquire('user-c')).resolves.toBeUndefined();
  });

  it('expires stale local leases and prevents an old release from deleting a replacement', async () => {
    let now = 1_000;
    const limiter = createWebsiteAiInFlightLimiter({
      getRedis: () => null,
      now: () => now,
      ttlMs: 100,
    });
    const expired = await limiter.acquire('user-a');

    now = 1_101;
    const replacement = await limiter.acquire('user-a');
    await expired?.release();

    expect(replacement).toBeDefined();
    await expect(limiter.acquire('user-a')).resolves.toBeUndefined();
    await replacement?.release();
    await expect(limiter.acquire('user-a')).resolves.toBeDefined();
  });

  it('refreshes an active local lease without allocating another entry', async () => {
    let now = 1_000;
    const limiter = createWebsiteAiInFlightLimiter({
      getRedis: () => null,
      now: () => now,
      ttlMs: 100,
    });
    const lease = await limiter.acquire('user-a');

    now = 1_090;
    await expect(lease?.refresh()).resolves.toBe(true);
    now = 1_150;
    await expect(limiter.acquire('user-a')).resolves.toBeUndefined();
    now = 1_191;
    await expect(limiter.acquire('user-a')).resolves.toBeDefined();
    await expect(lease?.refresh()).resolves.toBe(false);
  });

  it('keeps finite local bounds when factory options are unsafe', async () => {
    let now = 1_000;
    const limiter = createWebsiteAiInFlightLimiter({
      getRedis: () => null,
      maxEntries: Number.POSITIVE_INFINITY,
      now: () => now,
      ttlMs: Number.MAX_VALUE,
    });
    const first = await limiter.acquire('user-0');
    for (let index = 1; index < 256; index += 1) {
      await expect(limiter.acquire(`user-${index}`)).resolves.toBeDefined();
    }

    await expect(limiter.acquire('over-capacity')).resolves.toBeUndefined();
    now = 181_001;
    await expect(limiter.acquire('user-0')).resolves.toBeDefined();
    await expect(first?.refresh()).resolves.toBe(false);
  });

  it('allows only one of two process instances to acquire the same Redis lease', async () => {
    const redis = new FakeLeaseRedis();
    const firstInstance = createWebsiteAiInFlightLimiter({
      getRedis: () => redis as any,
      ownerToken: () => 'owner-a',
    });
    const secondInstance = createWebsiteAiInFlightLimiter({
      getRedis: () => redis as any,
      ownerToken: () => 'owner-b',
    });

    const [first, second] = await Promise.all([
      firstInstance.acquire('private-user-id'),
      secondInstance.acquire('private-user-id'),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect([...redis.values.keys()]).toEqual([
      expect.stringMatching(/^website-ai:stream:v1:[a-f0-9]{64}$/),
    ]);
    expect([...redis.values.keys()].join('')).not.toContain('private-user-id');
  });

  it('lets a second instance take over after TTL without granting the old owner control', async () => {
    const redis = new FakeLeaseRedis();
    const firstInstance = createWebsiteAiInFlightLimiter({
      getRedis: () => redis as any,
      now: () => redis.now,
      ownerToken: () => 'owner-a',
      ttlMs: 1_000,
    });
    const secondInstance = createWebsiteAiInFlightLimiter({
      getRedis: () => redis as any,
      now: () => redis.now,
      ownerToken: () => 'owner-b',
      ttlMs: 1_000,
    });
    const first = await firstInstance.acquire('user-a');

    redis.now = 2_001;
    const replacement = await secondInstance.acquire('user-a');

    expect(replacement).toBeDefined();
    await expect(first?.refresh()).resolves.toBe(false);
    await first?.release();
    await expect(secondInstance.acquire('user-a')).resolves.toBeUndefined();
    await replacement?.release();
    await expect(secondInstance.acquire('user-a')).resolves.toBeDefined();
  });

  it('fails closed on Redis acquisition errors and recovers without leaking a local slot', async () => {
    const redis = new FakeLeaseRedis();
    const limiter = createWebsiteAiInFlightLimiter({ getRedis: () => redis as any });
    redis.failSet = true;

    await expect(limiter.acquire('user-a')).resolves.toBeUndefined();

    redis.failSet = false;
    await expect(limiter.acquire('user-a')).resolves.toBeDefined();
  });

  it('fails refresh closed and leaves a Redis lease to expire when atomic cleanup errors', async () => {
    const redis = new FakeLeaseRedis();
    const limiter = createWebsiteAiInFlightLimiter({ getRedis: () => redis as any });
    const lease = await limiter.acquire('user-a');
    redis.failEval = true;

    await expect(lease?.refresh()).resolves.toBe(false);
    await expect(lease?.release()).resolves.toBeUndefined();
    expect(redis.values.size).toBe(1);

    redis.failEval = false;
    await expect(limiter.acquire('user-a')).resolves.toBeUndefined();
  });
});
