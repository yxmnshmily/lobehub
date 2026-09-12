import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import { jwtVerify } from 'jose';

import { authEnv } from '@/envs/auth';
import { getRedisConfig } from '@/envs/redis';
import { initializeRedis, isRedisEnabled } from '@/libs/redis';

type AbuseDecision = { limited: boolean; retryAfter: number };
type AbuseStore = {
  consume: (keys: string[], maxima: number[], windowSeconds: number) => Promise<AbuseDecision>;
};

type RateLimitData = { count: number; key: string; lastRequest: number };

const authAbuseRules = {
  '/change-email': { accountMax: 3, emailField: 'newEmail', ipMax: 20, windowSeconds: 900 },
  '/email-otp/change-email': {
    accountMax: 3,
    emailField: 'newEmail',
    ipMax: 20,
    windowSeconds: 300,
  },
  '/email-otp/check-verification-otp': {
    accountMax: 3,
    emailField: 'email',
    ipMax: 30,
    windowSeconds: 300,
  },
  '/email-otp/request-email-change': {
    accountMax: 3,
    emailField: 'newEmail',
    ipMax: 20,
    windowSeconds: 900,
  },
  '/email-otp/request-password-reset': {
    accountMax: 3,
    emailField: 'email',
    ipMax: 20,
    windowSeconds: 900,
  },
  '/email-otp/reset-password': {
    accountMax: 3,
    emailField: 'email',
    ipMax: 30,
    windowSeconds: 300,
  },
  '/email-otp/send-verification-otp': {
    accountMax: 3,
    emailField: 'email',
    ipMax: 20,
    windowSeconds: 900,
  },
  '/email-otp/verify-email': {
    accountMax: 3,
    emailField: 'email',
    ipMax: 30,
    windowSeconds: 300,
  },
  '/forget-password/email-otp': {
    accountMax: 3,
    emailField: 'email',
    ipMax: 20,
    windowSeconds: 900,
  },
  '/phone-number/request-password-reset': {
    accountMax: 3,
    emailField: 'phoneNumber',
    ipMax: 20,
    windowSeconds: 900,
  },
  '/phone-number/reset-password': {
    accountMax: 3,
    emailField: 'phoneNumber',
    ipMax: 20,
    windowSeconds: 300,
  },
  '/phone-number/send-otp': {
    accountMax: 3,
    emailField: 'phoneNumber',
    ipMax: 10,
    windowSeconds: 300,
  },
  '/phone-number/verify': {
    accountMax: 5,
    emailField: 'phoneNumber',
    ipMax: 20,
    windowSeconds: 300,
  },
  '/request-password-reset': {
    accountMax: 3,
    emailField: 'email',
    ipMax: 20,
    windowSeconds: 900,
  },
  '/send-verification-email': {
    accountMax: 3,
    emailField: 'email',
    ipMax: 20,
    windowSeconds: 900,
  },
  '/sign-in/email': { accountMax: 5, emailField: 'email', ipMax: 30, windowSeconds: 60 },
  '/sign-in/email-otp': {
    accountMax: 3,
    emailField: 'email',
    ipMax: 30,
    windowSeconds: 300,
  },
  '/sign-in/magic-link': {
    accountMax: 3,
    emailField: 'email',
    ipMax: 20,
    windowSeconds: 900,
  },
  '/sign-in/phone-number': {
    accountMax: 5,
    emailField: 'phoneNumber',
    ipMax: 20,
    windowSeconds: 300,
  },
  '/sign-up/email': { accountMax: 3, emailField: 'email', ipMax: 20, windowSeconds: 600 },
  '/verify-email': { accountMax: 5, emailField: 'jwt', ipMax: 30, windowSeconds: 900 },
} as const;

const redisConsumeScript = `
local retry_after = 0
for index, key in ipairs(KEYS) do
  local count = redis.call('INCR', key)
  if count == 1 then redis.call('EXPIRE', key, ARGV[1]) end
  local ttl = redis.call('TTL', key)
  if count > tonumber(ARGV[index + 1]) and ttl > retry_after then retry_after = ttl end
end
return retry_after
`;

const hashKeyPart = (value: string) => createHash('sha256').update(value).digest('hex');

export const normalizeRateLimitEmail = (email: string) =>
  email.trim().normalize('NFKC').toLowerCase();

export const buildAuthAbuseKeys = (path: string, ip: string, email: string) => [
  `auth-abuse:v1:${path}:ip:${hashKeyPart(ip)}`,
  `auth-abuse:v1:${path}:account:${hashKeyPart(email)}`,
];

const normalizeIp = (candidate: string): string | null => {
  const value = candidate.trim();
  const version = isIP(value);
  if (version === 4) return value;
  if (version !== 6) return null;

  return new URL(`http://[${value}]/`).hostname.slice(1, -1).toLowerCase();
};

const getVerificationTokenEmail = async (request: Request) => {
  const token = new URL(request.url).searchParams.get('token') || '';
  if (!token || token.length > 4096) return '';

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(authEnv.AUTH_SECRET), {
      algorithms: ['HS256'],
    });
    if (typeof payload.updateTo === 'string') return payload.updateTo;
    return typeof payload.email === 'string' ? payload.email : '';
  } catch {
    return '';
  }
};

export const resolveTrustedClientIp = (
  headers: Headers,
  environment = process.env.NODE_ENV,
  trustedHeader = process.env.AUTH_TRUSTED_IP_HEADER,
): string | null => {
  // Trust is opt-in in production: the selected reverse proxy must overwrite this header
  // and the Better Auth port must remain private. Direct requests cannot establish trust.
  const normalizedHeader = trustedHeader?.trim().toLowerCase();
  if (normalizedHeader === 'x-real-ip') {
    const realIp = headers.get(normalizedHeader);
    return realIp ? normalizeIp(realIp) : null;
  }
  if (normalizedHeader === 'x-forwarded-for') {
    const forwardedFor = headers.get(normalizedHeader);
    if (!forwardedFor) return null;
    // A configured trusted proxy must append its directly connected address. Taking the
    // right-most value prevents a client-provided chain prefix from selecting its own key.
    const nearestAddress = forwardedFor.split(',').at(-1);
    if (nearestAddress) return normalizeIp(nearestAddress);
    return null;
  }

  return environment === 'production' ? null : '127.0.0.1';
};

export class BoundedAuthAbuseStore implements AbuseStore {
  private readonly entries = new Map<string, { count: number; expiresAt: number }>();

  constructor(
    private readonly capacity = 4096,
    private readonly now = () => Date.now(),
  ) {}

  get size() {
    return this.entries.size;
  }

  private makeRoom(now: number) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    if (this.entries.size < this.capacity) return;

    let oldestKey: string | undefined;
    let oldestExpiry = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt < oldestExpiry) {
        oldestExpiry = entry.expiresAt;
        oldestKey = key;
      }
    }
    if (oldestKey) this.entries.delete(oldestKey);
  }

  async consume(keys: string[], maxima: number[], windowSeconds: number): Promise<AbuseDecision> {
    const now = this.now();
    const expiresAt = now + windowSeconds * 1000;
    let retryAfter = 0;

    for (const [index, key] of keys.entries()) {
      let entry = this.entries.get(key);
      if (!entry || entry.expiresAt <= now) {
        this.makeRoom(now);
        entry = { count: 0, expiresAt };
        this.entries.set(key, entry);
      }
      entry.count += 1;
      if (entry.count > maxima[index]) {
        retryAfter = Math.max(retryAfter, Math.ceil((entry.expiresAt - now) / 1000));
      }
    }

    return { limited: retryAfter > 0, retryAfter };
  }
}

class RedisAuthAbuseStore implements AbuseStore {
  async consume(keys: string[], maxima: number[], windowSeconds: number): Promise<AbuseDecision> {
    const config = getRedisConfig();
    const redis = await initializeRedis(config);
    if (!redis) throw new Error('AUTH_RATE_LIMIT_STORAGE_UNAVAILABLE');

    const retryAfter = Number(
      await redis.eval(redisConsumeScript, keys.length, ...keys, windowSeconds, ...maxima),
    );
    return { limited: retryAfter > 0, retryAfter: Math.max(0, retryAfter) };
  }
}

class BoundedRateLimitStorage {
  private readonly entries = new Map<string, RateLimitData>();

  constructor(private readonly capacity = 4096) {}

  async get(key: string) {
    const config = getRedisConfig();
    if (isRedisEnabled(config)) {
      const redis = await initializeRedis(config);
      if (!redis) throw new Error('AUTH_RATE_LIMIT_STORAGE_UNAVAILABLE');
      const value = await redis.get(`auth-rate-limit:v1:${hashKeyPart(key)}`);
      return value ? (JSON.parse(value) as RateLimitData) : null;
    }
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AUTH_RATE_LIMIT_STORAGE_UNAVAILABLE');
    }
    return this.entries.get(key) ?? null;
  }

  async set(key: string, value: RateLimitData) {
    const config = getRedisConfig();
    if (isRedisEnabled(config)) {
      const redis = await initializeRedis(config);
      if (!redis) throw new Error('AUTH_RATE_LIMIT_STORAGE_UNAVAILABLE');
      await redis.set(`auth-rate-limit:v1:${hashKeyPart(key)}`, JSON.stringify(value), {
        ex: 3600,
      });
      return;
    }
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AUTH_RATE_LIMIT_STORAGE_UNAVAILABLE');
    }
    if (!this.entries.has(key) && this.entries.size >= this.capacity) {
      const oldest = [...this.entries].sort(([, a], [, b]) => a.lastRequest - b.lastRequest)[0];
      if (oldest) this.entries.delete(oldest[0]);
    }
    this.entries.set(key, value);
  }
}

const boundedAbuseStore = new BoundedAuthAbuseStore();
const redisAbuseStore = new RedisAuthAbuseStore();
const boundedBetterAuthStorage = new BoundedRateLimitStorage();

export const createBetterAuthRateLimitStorage = () => boundedBetterAuthStorage;

export const checkAuthAbuseLimit = async (
  request: Request,
): Promise<AbuseDecision & { unavailable?: boolean }> => {
  const pathname = new URL(request.url).pathname;
  const suffix = Object.keys(authAbuseRules).find((path) => pathname.endsWith(`/api/auth${path}`));
  if (!suffix) return { limited: false, retryAfter: 0 };
  const rule = authAbuseRules[suffix as keyof typeof authAbuseRules];

  const ip = resolveTrustedClientIp(request.headers);
  if (!ip) return { limited: false, retryAfter: 0, unavailable: true };

  let email: string;
  try {
    const contentType = request.headers.get('content-type') || '';
    if (rule.emailField === 'jwt') {
      email = await getVerificationTokenEmail(request);
    } else if (contentType.startsWith('application/x-www-form-urlencoded')) {
      email = new URLSearchParams(await request.clone().text()).get(rule.emailField) || '';
    } else {
      const body: unknown = await request.clone().json();
      const emailValue =
        typeof body === 'object' && body !== null && Object.hasOwn(body, rule.emailField)
          ? Reflect.get(body, rule.emailField)
          : undefined;
      email = typeof emailValue === 'string' ? emailValue : '';
    }
  } catch {
    email = '';
  }
  email = normalizeRateLimitEmail(email);

  const derivedKeys = buildAuthAbuseKeys(suffix, ip, email);
  const keys = email ? derivedKeys : [derivedKeys[0]];
  const maxima = email ? [rule.ipMax, rule.accountMax] : [rule.ipMax];
  const config = getRedisConfig();
  if (!isRedisEnabled(config) && process.env.NODE_ENV === 'production') {
    return { limited: false, retryAfter: 0, unavailable: true };
  }
  const store = isRedisEnabled(config) ? redisAbuseStore : boundedAbuseStore;

  try {
    return await store.consume(keys, maxima, rule.windowSeconds);
  } catch {
    return { limited: false, retryAfter: 0, unavailable: true };
  }
};
