import { createHash, randomUUID } from 'node:crypto';

import type Redis from 'ioredis';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

export interface WebsiteAiInFlightLease {
  refresh: () => Promise<boolean>;
  release: () => Promise<void>;
}

type WebsiteAiLeaseRedis = Pick<Redis, 'eval' | 'set'>;

interface WebsiteAiInFlightLimiterOptions {
  getRedis?: () => WebsiteAiLeaseRedis | null;
  maxEntries?: number;
  now?: () => number;
  ownerToken?: () => string;
  ttlMs?: number;
}

interface LocalInFlightEntry {
  expiresAt: number;
  token: symbol;
}

interface LocalInFlightLease {
  refresh: () => boolean;
  release: () => void;
}

const DEFAULT_MAX_ENTRIES = 256;
const DEFAULT_TTL_MS = 180_000;
const REDIS_KEY_PREFIX = 'website-ai:stream:v1:';
const REFRESH_OWNED_LEASE_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end";
const RELEASE_OWNED_LEASE_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

const createLocalLimiter = (capacity: number, leaseTtlMs: number, now: () => number) => {
  const entries = new Map<string, LocalInFlightEntry>();

  const pruneExpired = (timestamp: number) => {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= timestamp) entries.delete(key);
    }
  };

  return {
    acquire(key: string): LocalInFlightLease | undefined {
      const timestamp = now();
      pruneExpired(timestamp);
      if (entries.has(key) || entries.size >= capacity) return undefined;

      const token = Symbol();
      entries.set(key, { expiresAt: timestamp + leaseTtlMs, token });

      return {
        refresh: () => {
          const entry = entries.get(key);
          if (entry?.token !== token) return false;
          entry.expiresAt = now() + leaseTtlMs;
          return true;
        },
        release: () => {
          if (entries.get(key)?.token === token) entries.delete(key);
        },
      };
    },
  };
};

export const createWebsiteAiInFlightLimiter = ({
  getRedis = getAgentRuntimeRedisClient,
  maxEntries = DEFAULT_MAX_ENTRIES,
  now = Date.now,
  ownerToken = randomUUID,
  ttlMs = DEFAULT_TTL_MS,
}: WebsiteAiInFlightLimiterOptions = {}) => {
  const capacity =
    Number.isInteger(maxEntries) && Number.isFinite(maxEntries) && maxEntries > 0
      ? Math.min(maxEntries, DEFAULT_MAX_ENTRIES)
      : DEFAULT_MAX_ENTRIES;
  const leaseTtlMs =
    Number.isFinite(ttlMs) && ttlMs > 0 ? Math.min(ttlMs, DEFAULT_TTL_MS) : DEFAULT_TTL_MS;
  const redisTtlSeconds = Math.max(1, Math.ceil(leaseTtlMs / 1000));
  const localLimiter = createLocalLimiter(capacity, leaseTtlMs, now);

  return {
    async acquire(userId: string): Promise<WebsiteAiInFlightLease | undefined> {
      const scope = digest(userId);
      const localLease = localLimiter.acquire(scope);
      if (!localLease) return undefined;

      let redis: WebsiteAiLeaseRedis | null;
      try {
        redis = getRedis();
      } catch {
        localLease.release();
        return undefined;
      }

      if (!redis) {
        return {
          refresh: async () => localLease.refresh(),
          release: async () => localLease.release(),
        };
      }

      const key = `${REDIS_KEY_PREFIX}${scope}`;
      let owner: string;
      try {
        owner = ownerToken();
        const claimed = await redis.set(key, owner, 'EX', redisTtlSeconds, 'NX');
        if (claimed !== 'OK') {
          localLease.release();
          return undefined;
        }
      } catch {
        localLease.release();
        return undefined;
      }

      let releasePromise: Promise<void> | undefined;
      return {
        refresh: async () => {
          if (releasePromise) return false;
          try {
            const refreshed = await redis.eval(
              REFRESH_OWNED_LEASE_SCRIPT,
              1,
              key,
              owner,
              String(redisTtlSeconds),
            );
            if (Number(refreshed) !== 1) {
              localLease.release();
              return false;
            }
            return localLease.refresh();
          } catch {
            return false;
          }
        },
        release: () => {
          releasePromise ??= (async () => {
            try {
              await redis.eval(RELEASE_OWNED_LEASE_SCRIPT, 1, key, owner);
            } catch {
              // Fail closed: keep the Redis owner until its short TTL expires.
            } finally {
              localLease.release();
            }
          })();
          return releasePromise;
        },
      };
    },
  };
};

export const websiteAiInFlightLimiter = createWebsiteAiInFlightLimiter();
