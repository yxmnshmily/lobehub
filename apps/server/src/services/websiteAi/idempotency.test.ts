import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runWebsiteAiStartIdempotently } from './idempotency';

const redisState = vi.hoisted(() => ({
  available: true,
  values: new Map<string, string>(),
}));

const redis = vi.hoisted(() => ({
  del: vi.fn(async (key: string) => Number(redisState.values.delete(key))),
  get: vi.fn(async (key: string) => redisState.values.get(key) ?? null),
  set: vi.fn(async (key: string, value: string, ...options: string[]) => {
    if (options.includes('NX') && redisState.values.has(key)) return null;
    if (options.includes('XX') && !redisState.values.has(key)) return null;
    redisState.values.set(key, value);
    return 'OK';
  }),
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => (redisState.available ? redis : null),
}));

describe('runWebsiteAiStartIdempotently', () => {
  beforeEach(() => {
    redisState.available = true;
    redisState.values.clear();
    vi.clearAllMocks();
  });

  it('stores only a digest of the user, key and prompt while reusing the result', async () => {
    const start = vi.fn(async () => ({ operationId: 'operation-safe-to-store' }));
    const input = {
      idempotencyKey: 'raw-browser-key',
      message: 'private customer prompt',
      start,
      userId: 'private-user-id',
    };

    await expect(runWebsiteAiStartIdempotently(input)).resolves.toEqual({
      operationId: 'operation-safe-to-store',
    });
    await expect(runWebsiteAiStartIdempotently(input)).resolves.toEqual({
      operationId: 'operation-safe-to-store',
    });

    expect(start).toHaveBeenCalledTimes(1);
    const persisted = JSON.stringify([...redisState.values]);
    expect(persisted).not.toMatch(/raw-browser-key|private customer prompt|private-user-id/);
  });

  it('does not deduplicate two authenticated users that send the same key and prompt', async () => {
    const firstStart = vi.fn(async () => ({ operationId: 'operation-1' }));
    const secondStart = vi.fn(async () => ({ operationId: 'operation-2' }));

    await runWebsiteAiStartIdempotently({
      idempotencyKey: 'shared-browser-key',
      message: '同一内容',
      start: firstStart,
      userId: 'user-a',
    });
    await runWebsiteAiStartIdempotently({
      idempotencyKey: 'shared-browser-key',
      message: '同一内容',
      start: secondStart,
      userId: 'user-b',
    });

    expect(firstStart).toHaveBeenCalledTimes(1);
    expect(secondStart).toHaveBeenCalledTimes(1);
    expect(redisState.values.size).toBe(2);
  });

  it('treats different trusted limits as different idempotency material', async () => {
    const firstStart = vi.fn(async () => ({ operationId: 'operation-1' }));
    const secondStart = vi.fn(async () => ({ operationId: 'operation-2' }));

    await runWebsiteAiStartIdempotently({
      idempotencyKey: 'same-key',
      maxCredits: 1000,
      message: '制作行程',
      start: firstStart,
      userId: 'user-1',
    });
    await expect(
      runWebsiteAiStartIdempotently({
        idempotencyKey: 'same-key',
        maxCredits: 2000,
        message: '制作行程',
        start: secondStart,
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(firstStart).toHaveBeenCalledOnce();
    expect(secondStart).not.toHaveBeenCalled();
  });

  it('coalesces concurrent duplicate starts onto the same pending operation', async () => {
    redisState.available = false;
    let release: ((value: { operationId: string }) => void) | undefined;
    const start = vi.fn(
      async () =>
        await new Promise<{ operationId: string }>((resolve) => {
          release = resolve;
        }),
    );
    const input = {
      idempotencyKey: 'concurrent-browser-key',
      message: '并发重复请求',
      start,
      userId: 'user-concurrent',
    };

    const first = runWebsiteAiStartIdempotently(input);
    const duplicate = runWebsiteAiStartIdempotently(input);
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    release?.({ operationId: 'operation-shared' });

    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      { operationId: 'operation-shared' },
      { operationId: 'operation-shared' },
    ]);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('prunes an expired local fallback record before accepting a reused key', async () => {
    vi.useFakeTimers();
    redisState.available = false;
    try {
      const firstStart = vi.fn(async () => ({ operationId: 'operation-expired' }));
      await runWebsiteAiStartIdempotently({
        idempotencyKey: 'expired-local-key',
        message: '旧请求',
        start: firstStart,
        userId: 'user-expiry',
      });

      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1);
      const replacementStart = vi.fn(async () => ({ operationId: 'operation-new' }));
      await expect(
        runWebsiteAiStartIdempotently({
          idempotencyKey: 'expired-local-key',
          message: '过期后重新提交',
          start: replacementStart,
          userId: 'user-expiry',
        }),
      ).resolves.toEqual({ operationId: 'operation-new' });

      expect(firstStart).toHaveBeenCalledOnce();
      expect(replacementStart).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails closed without starting when a configured Redis reservation is unavailable', async () => {
    redis.set.mockRejectedValueOnce(new Error('redis transport unavailable'));
    const start = vi.fn(async () => ({ operationId: 'must-not-start' }));

    await expect(
      runWebsiteAiStartIdempotently({
        idempotencyKey: 'redis-error-key',
        message: 'Redis 报错时不重复启动',
        start,
        userId: 'user-redis-error',
      }),
    ).rejects.toThrow('redis transport unavailable');

    expect(start).not.toHaveBeenCalled();
  });

  it('bounds distinct local fallback keys and prunes them after the TTL', async () => {
    vi.useFakeTimers();
    redisState.available = false;
    try {
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1);
      for (let index = 0; index < 1000; index += 1) {
        await runWebsiteAiStartIdempotently({
          idempotencyKey: `capacity-key-${index}`,
          message: '容量测试',
          start: async () => ({ operationId: `operation-${index}` }),
          userId: 'capacity-attacker',
        });
      }
      const overflowStart = vi.fn(async () => ({ operationId: 'overflow' }));

      await expect(
        runWebsiteAiStartIdempotently({
          idempotencyKey: 'capacity-overflow',
          message: '容量测试',
          start: overflowStart,
          userId: 'capacity-attacker',
        }),
      ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
      expect(overflowStart).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1);
      await expect(
        runWebsiteAiStartIdempotently({
          idempotencyKey: 'capacity-after-expiry',
          message: '容量释放',
          start: async () => ({ operationId: 'after-expiry' }),
          userId: 'capacity-attacker',
        }),
      ).resolves.toEqual({ operationId: 'after-expiry' });
    } finally {
      vi.useRealTimers();
    }
  });
});
