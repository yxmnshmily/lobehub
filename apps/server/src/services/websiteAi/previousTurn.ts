import { createHash, randomUUID } from 'node:crypto';

import type Redis from 'ioredis';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import type { TravelProductionIntent } from '@/server/services/travelOrchestration';

export interface WebsiteAiPreviousTurn {
  confirmedIntents: readonly TravelProductionIntent[];
  taskStatus: 'succeeded';
}

export interface WebsiteAiPreviousTurnHandle {
  key: string;
  owner: string;
}

export interface WebsiteAiPreviousTurnScope {
  groupId: string;
  topicId: string;
  userId: string;
  workspaceId?: string;
}

type PreviousTurnRedis = Pick<Redis, 'eval' | 'get' | 'set'>;

interface StoredPreviousTurn {
  confirmedIntents: TravelProductionIntent[];
  owner: string;
  taskStatus: 'running' | 'succeeded';
  version: 1;
}

interface LocalPreviousTurn {
  expiresAt: number;
  value: StoredPreviousTurn;
}

interface PreviousTurnStoreOptions {
  getRedis?: () => PreviousTurnRedis | null;
  maxEntries?: number;
  now?: () => number;
  ownerToken?: () => string;
  ttlMs?: number;
}

const DEFAULT_MAX_ENTRIES = 1024;
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const KEY_PREFIX = 'website-ai:previous-turn:v1:';
const VALID_INTENTS = new Set<TravelProductionIntent>(['copy', 'image', 'video', 'document']);
const STORED_KEYS = new Set(['confirmedIntents', 'owner', 'taskStatus', 'version']);
const HANDLE_KEY_PATTERN = /^website-ai:previous-turn:v1:[a-f0-9]{64}$/;
const SETTLE_OWNED_CONTEXT_SCRIPT = `
local raw = redis.call('get', KEYS[1])
if not raw then return 0 end
local ok, current = pcall(cjson.decode, raw)
if not ok or current.owner ~= ARGV[1] then return 0 end
if ARGV[2] ~= 'succeeded' then return redis.call('del', KEYS[1]) end
current.taskStatus = 'succeeded'
return redis.call('set', KEYS[1], cjson.encode(current), 'EX', ARGV[3])
`;

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

const scopeKey = ({ groupId, topicId, userId, workspaceId }: WebsiteAiPreviousTurnScope) =>
  `${KEY_PREFIX}${digest(`${userId}\0${workspaceId ?? 'personal'}\0${groupId}\0${topicId}`)}`;

const parseIntents = (
  value: unknown,
  allowInformational = false,
): TravelProductionIntent[] | undefined => {
  if (
    !Array.isArray(value) ||
    (!allowInformational && value.length === 0) ||
    value.length > VALID_INTENTS.size
  ) {
    return undefined;
  }
  const intents = [...new Set(value)];
  if (
    intents.length !== value.length ||
    intents.some((intent) => typeof intent !== 'string' || !VALID_INTENTS.has(intent as never))
  ) {
    return undefined;
  }
  return intents as TravelProductionIntent[];
};

const parseStored = (raw: unknown): StoredPreviousTurn | undefined => {
  if (typeof raw !== 'string') return undefined;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !STORED_KEYS.has(key)) ||
      value.version !== 1 ||
      typeof value.owner !== 'string' ||
      value.owner.length === 0 ||
      value.owner.length > 128 ||
      (value.taskStatus !== 'running' && value.taskStatus !== 'succeeded')
    ) {
      return undefined;
    }
    const confirmedIntents = parseIntents(value.confirmedIntents, true);
    return confirmedIntents
      ? {
          confirmedIntents,
          owner: value.owner,
          taskStatus: value.taskStatus,
          version: 1,
        }
      : undefined;
  } catch {
    return undefined;
  }
};

const validHandle = (handle: WebsiteAiPreviousTurnHandle) =>
  HANDLE_KEY_PATTERN.test(handle.key) && handle.owner.length > 0 && handle.owner.length <= 128;

export const createWebsiteAiPreviousTurnStore = ({
  getRedis = getAgentRuntimeRedisClient,
  maxEntries = DEFAULT_MAX_ENTRIES,
  now = Date.now,
  ownerToken = randomUUID,
  ttlMs = DEFAULT_TTL_MS,
}: PreviousTurnStoreOptions = {}) => {
  const capacity =
    Number.isInteger(maxEntries) && Number.isFinite(maxEntries) && maxEntries > 0
      ? Math.min(maxEntries, DEFAULT_MAX_ENTRIES)
      : DEFAULT_MAX_ENTRIES;
  const contextTtlMs =
    Number.isFinite(ttlMs) && ttlMs > 0 ? Math.min(ttlMs, DEFAULT_TTL_MS) : DEFAULT_TTL_MS;
  const redisTtlSeconds = Math.max(1, Math.ceil(contextTtlMs / 1000));
  const local = new Map<string, LocalPreviousTurn>();

  const pruneLocal = () => {
    const timestamp = now();
    for (const [key, entry] of local) {
      if (entry.expiresAt <= timestamp) local.delete(key);
    }
  };

  return {
    async begin(
      scope: WebsiteAiPreviousTurnScope,
      confirmedIntents: readonly TravelProductionIntent[],
    ): Promise<WebsiteAiPreviousTurnHandle | undefined> {
      const intents = parseIntents(confirmedIntents, true);
      if (!intents) return undefined;
      const key = scopeKey(scope);
      const owner = ownerToken();
      if (!owner || owner.length > 128) return undefined;
      const value: StoredPreviousTurn = {
        confirmedIntents: intents,
        owner,
        taskStatus: 'running',
        version: 1,
      };

      let redis: PreviousTurnRedis | null;
      try {
        redis = getRedis();
      } catch {
        return undefined;
      }
      if (redis) {
        try {
          const stored = await redis.set(key, JSON.stringify(value), 'EX', redisTtlSeconds);
          return stored === 'OK' ? { key, owner } : undefined;
        } catch {
          return undefined;
        }
      }

      pruneLocal();
      if (!local.has(key) && local.size >= capacity) return undefined;
      local.set(key, { expiresAt: now() + contextTtlMs, value });
      return { key, owner };
    },

    async read(scope: WebsiteAiPreviousTurnScope): Promise<WebsiteAiPreviousTurn | undefined> {
      const key = scopeKey(scope);
      let redis: PreviousTurnRedis | null;
      try {
        redis = getRedis();
      } catch {
        return undefined;
      }

      let stored: StoredPreviousTurn | undefined;
      if (redis) {
        try {
          stored = parseStored(await redis.get(key));
        } catch {
          return undefined;
        }
      } else {
        pruneLocal();
        stored = local.get(key)?.value;
      }
      return stored?.taskStatus === 'succeeded' && stored.confirmedIntents.length > 0
        ? { confirmedIntents: stored.confirmedIntents, taskStatus: 'succeeded' }
        : undefined;
    },

    async settle(
      handle: WebsiteAiPreviousTurnHandle,
      taskStatus: 'failed' | 'succeeded',
    ): Promise<boolean> {
      if (!validHandle(handle)) return false;
      let redis: PreviousTurnRedis | null;
      try {
        redis = getRedis();
      } catch {
        return false;
      }
      if (redis) {
        try {
          return (
            Number(
              await redis.eval(
                SETTLE_OWNED_CONTEXT_SCRIPT,
                1,
                handle.key,
                handle.owner,
                taskStatus,
                String(redisTtlSeconds),
              ),
            ) === 1
          );
        } catch {
          return false;
        }
      }

      pruneLocal();
      const entry = local.get(handle.key);
      if (entry?.value.owner !== handle.owner) return false;
      if (taskStatus === 'failed') local.delete(handle.key);
      else {
        entry.value.taskStatus = 'succeeded';
        entry.expiresAt = now() + contextTtlMs;
      }
      return true;
    },
  };
};

export const websiteAiPreviousTurnStore = createWebsiteAiPreviousTurnStore();
