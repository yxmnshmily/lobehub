import { getRedisConfig } from '@/envs/redis';
import { initializeRedis } from '@/libs/redis';
import {
  exchangeMonth,
  INITIAL_EXCHANGE_RATE,
  isFreshExchangeRate,
  type MonthlyExchangeRate,
  nextExchangeMonthAt,
} from '@/utils/currencyDisplay';

const CACHE_KEY = 'billing:latest-usd-cny:v1';
let latest = INITIAL_EXCHANGE_RATE;
let pending: Promise<MonthlyExchangeRate> | undefined;
let retryAfter = 0;

export const validExchangeRate = (value: unknown): value is MonthlyExchangeRate => {
  if (!value || typeof value !== 'object') return false;
  const item = value as MonthlyExchangeRate;
  return (
    typeof item.rate === 'number' &&
    Number.isFinite(item.rate) &&
    item.rate > 0 &&
    item.rate < 100 &&
    /^\d{4}-\d{2}$/.test(item.month) &&
    /^\d{4}-\d{2}-\d{2}$/.test(item.rateDate) &&
    Number.isFinite(Date.parse(item.rateDate)) &&
    typeof item.updatedAt === 'string' &&
    Number.isFinite(Date.parse(item.updatedAt))
  );
};

/** Lock the latest published ECB reference until the next Beijing month starts. */
export async function getMonthlyExchangeRate(now = new Date()): Promise<MonthlyExchangeRate> {
  const startedAt = Date.now();
  const currentTime = () => new Date(now.getTime() + Math.max(0, Date.now() - startedAt));
  const month = exchangeMonth(now);
  if (isFreshExchangeRate(latest, now)) return latest;
  if (now.getTime() < retryAfter) return latest;
  if (pending) return pending;
  pending = (async () => {
    try {
      const redis = await initializeRedis(getRedisConfig());
      // Display and admission use the same persistent quote across processes.
      if (!redis) throw new Error('Exchange-rate cache unavailable');
      const saved = await redis.get(CACHE_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (validExchangeRate(parsed)) latest = parsed;
      }
      if (isFreshExchangeRate(latest, now)) return latest;
      const acquired = await redis.set(`${CACHE_KEY}:lock`, '1', { nx: true, ex: 30 });
      if (!acquired) {
        // Another instance is refreshing; do not reject a valid admission just for losing the lock.
        const deadline = Date.now() + 8500;
        do {
          await new Promise((resolve) => setTimeout(resolve, 200));
          const shared = await redis.get(CACHE_KEY);
          if (shared) {
            const quote: unknown = JSON.parse(shared);
            if (validExchangeRate(quote) && isFreshExchangeRate(quote, currentTime())) {
              latest = quote;
              return latest;
            }
          }
        } while (Date.now() < deadline);
        throw new Error('Exchange-rate refresh unavailable');
      }
      const response = await fetch('https://api.frankfurter.dev/v2/rate/USD/CNY?providers=ECB', {
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('Exchange-rate source unavailable');
      const value = await response.json();
      const next = { month, rate: value.rate, rateDate: value.date, updatedAt: now.toISOString() };
      if (
        value.base !== 'USD' ||
        value.quote !== 'CNY' ||
        !validExchangeRate(next) ||
        !isFreshExchangeRate(next, now) ||
        (latest.updatedAt && next.rateDate < latest.rateDate)
      )
        throw new Error('Invalid exchange-rate response');
      await redis.set(CACHE_KEY, JSON.stringify(next));
      latest = next;
      return latest;
    } catch {
      retryAfter = now.getTime() + 60 * 60 * 1000;
      return latest;
    } finally {
      pending = undefined;
    }
  })();
  return pending;
}

/** Billing must never silently fall back to a hardcoded or stale exchange rate. */
export async function getBillingExchangeRate(now = new Date()) {
  const startedAt = Date.now();
  const quote = await getMonthlyExchangeRate(now);
  const settledAt = new Date(now.getTime() + Math.max(0, Date.now() - startedAt));
  if (!isFreshExchangeRate(quote, settledAt)) throw new Error('本月汇率暂不可用，请稍后重试。');
  return { ...quote };
}

/** Recover on boot and update at Beijing month rollover. Daily local wakes avoid timer overflow. */
export function startMonthlyExchangeRateUpdates() {
  const state = globalThis as typeof globalThis & {
    monthlyExchangeRateTimer?: ReturnType<typeof setTimeout>;
  };
  if (state.monthlyExchangeRateTimer) return;
  const schedule = () => {
    const delay = isFreshExchangeRate(latest)
      ? Math.min(nextExchangeMonthAt() - Date.now(), 86_400_000)
      : 60 * 60 * 1000;
    state.monthlyExchangeRateTimer = setTimeout(
      () => {
        void getMonthlyExchangeRate().finally(schedule);
      },
      Math.max(1, delay),
    );
    state.monthlyExchangeRateTimer.unref();
  };
  schedule();
  void getMonthlyExchangeRate().finally(() => {
    clearTimeout(state.monthlyExchangeRateTimer);
    schedule();
  });
}
