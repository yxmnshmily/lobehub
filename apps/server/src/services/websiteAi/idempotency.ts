import { createHash, randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const IDEMPOTENCY_TTL_SECONDS = 10 * 60;
const MAX_LOCAL_ENTRIES = 1000;

interface StoredStartResult<T> {
  fingerprint: string;
  owner: string;
  result?: T;
  state: 'ready' | 'starting';
}

interface LocalStart<T> {
  expiresAt: number;
  fingerprint: string;
  promise: Promise<T>;
}

const localStarts = new Map<string, LocalStart<unknown>>();

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

const pruneLocalStarts = () => {
  const now = Date.now();
  for (const [key, value] of localStarts) {
    if (value.expiresAt <= now) localStarts.delete(key);
  }
};

const conflict = () =>
  new TRPCError({
    code: 'CONFLICT',
    message: '幂等键已用于其他请求',
  });

const expired = () =>
  new TRPCError({
    code: 'CONFLICT',
    message: '重试状态已过期，请重新提交请求',
  });

const starting = () =>
  new TRPCError({
    code: 'TOO_MANY_REQUESTS',
    message: '相同请求正在启动，请稍后重试',
  });

const parseStored = <T>(value: string | null): StoredStartResult<T> | undefined => {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<StoredStartResult<T>>;
    if (
      typeof parsed.fingerprint === 'string' &&
      typeof parsed.owner === 'string' &&
      (parsed.state === 'ready' || parsed.state === 'starting')
    ) {
      return parsed as StoredStartResult<T>;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

/**
 * Coalesces retries per authenticated user. Redis is used whenever the agent
 * runtime is distributed; the bounded process-local promise also closes the
 * same-worker race and is the fallback for the in-memory runtime.
 */
export const runWebsiteAiStartIdempotently = async <T>(input: {
  idempotencyKey?: string;
  maxCredits?: number;
  message: string;
  requireExisting?: boolean;
  start: () => Promise<T>;
  topicId?: string;
  userId: string;
}): Promise<T> => {
  if (!input.idempotencyKey) return input.start();

  const scopeKey = `website-ai:start:v1:${digest(`${input.userId}\0${input.idempotencyKey}`)}`;
  const fingerprint = digest(
    JSON.stringify({
      maxCredits: input.maxCredits,
      message: input.message,
      topicId: input.topicId,
    }),
  );
  pruneLocalStarts();

  const local = localStarts.get(scopeKey) as LocalStart<T> | undefined;
  if (local) {
    if (local.fingerprint !== fingerprint) throw conflict();
    return local.promise;
  }
  const redis = getAgentRuntimeRedisClient();
  if (input.requireExisting && !redis) throw expired();
  if (localStarts.size >= MAX_LOCAL_ENTRIES) throw starting();

  const owner = randomUUID();
  let ownsReservation = false;
  const promise = (async () => {
    if (redis) {
      if (input.requireExisting) {
        const existing = parseStored<T>(await redis.get(scopeKey));
        if (!existing) throw expired();
        if (existing.fingerprint !== fingerprint) throw conflict();
        if (existing.state === 'ready' && existing.result !== undefined) return existing.result;
        throw starting();
      }
      const reservation: StoredStartResult<T> = { fingerprint, owner, state: 'starting' };
      const claimed = await redis.set(
        scopeKey,
        JSON.stringify(reservation),
        'EX',
        IDEMPOTENCY_TTL_SECONDS,
        'NX',
      );
      if (claimed !== 'OK') {
        const existing = parseStored<T>(await redis.get(scopeKey));
        if (!existing) throw starting();
        if (existing.fingerprint !== fingerprint) throw conflict();
        if (existing.state === 'ready' && existing.result !== undefined) return existing.result;
        throw starting();
      }
      ownsReservation = true;
    }
    return input.start();
  })();

  localStarts.set(scopeKey, {
    expiresAt: Date.now() + IDEMPOTENCY_TTL_SECONDS * 1000,
    fingerprint,
    promise,
  });

  let result: T;
  try {
    result = await promise;
  } catch (error) {
    localStarts.delete(scopeKey);
    if (redis && ownsReservation) {
      try {
        const existing = parseStored<T>(await redis.get(scopeKey));
        if (existing?.owner === owner) await redis.del(scopeKey);
      } catch {
        // Preserve the original startup error and leave the short-lived
        // reservation fail-closed if Redis cleanup is unavailable.
      }
    }
    throw error;
  }

  if (redis && ownsReservation) {
    try {
      await redis.set(
        scopeKey,
        JSON.stringify({ fingerprint, owner, result, state: 'ready' }),
        'EX',
        IDEMPOTENCY_TTL_SECONDS,
        'XX',
      );
    } catch {
      // The operation already started. Keep the local result and leave the
      // Redis reservation in "starting" state so another worker fails closed
      // instead of launching a duplicate task.
    }
  }
  return result;
};
