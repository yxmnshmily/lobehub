import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let saved: string | null;
let competingQuote: string | undefined;
vi.mock('@/envs/redis', () => ({ getRedisConfig: () => ({ enabled: true }) }));
vi.mock('@/libs/redis', () => ({
  initializeRedis: async () => ({
    get: async () => saved,
    set: async (key: string, value: string) => {
      if (key.endsWith(':lock') && competingQuote) {
        saved = competingQuote;
        return null;
      }
      if (!key.endsWith(':lock')) saved = value;
      return 'OK';
    },
  }),
}));

describe('latest exchange rate shared by display and billing', () => {
  afterEach(() => {
    const state = globalThis as typeof globalThis & {
      monthlyExchangeRateTimer?: ReturnType<typeof setTimeout>;
    };
    clearTimeout(state.monthlyExchangeRateTimer);
    delete state.monthlyExchangeRateTimer;
    vi.useRealTimers();
  });
  beforeEach(() => {
    vi.resetModules();
    saved = null;
    competingQuote = undefined;
    vi.unstubAllGlobals();
  });
  it('waits for the shared quote when another instance owns the refresh lock', async () => {
    competingQuote = JSON.stringify({
      month: '2026-09',
      rate: 7,
      rateDate: '2026-09-07',
      updatedAt: '2026-09-07T10:00:00.010Z',
    });
    const { getBillingExchangeRate } = await import('./index');
    expect((await getBillingExchangeRate(new Date('2026-09-07T10:00:00Z'))).rate).toBe(7);
  });
  it('fetches on boot and next month only, including long-lived server timers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T00:00:00+08:00'));
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ base: 'USD', quote: 'CNY', date: '2026-08-31', rate: 7 }),
        )
        .mockResolvedValueOnce(
          Response.json({ base: 'USD', quote: 'CNY', date: '2026-09-30', rate: 8 }),
        ),
    );
    const { startMonthlyExchangeRateUpdates, getMonthlyExchangeRate } = await import('./index');
    startMonthlyExchangeRateUpdates();
    await getMonthlyExchangeRate();
    await vi.advanceTimersByTimeAsync(30 * 86_400_000 - 1);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await getMonthlyExchangeRate()).rate).toBe(8);
  });
  it('shares one quote for the whole month and refreshes at Beijing month rollover', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ base: 'USD', quote: 'CNY', date: '2026-08-31', rate: 6.7197 }),
      ),
    );
    const { getMonthlyExchangeRate, getBillingExchangeRate } = await import('./index');
    const first = await getMonthlyExchangeRate(new Date('2026-09-01T00:00:00Z'));
    expect(first.rate).toBe(6.7197);
    expect(JSON.parse(saved!).month).toBe('2026-09');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('should use snapshot');
      }),
    );
    expect(await getMonthlyExchangeRate(new Date('2026-09-01T00:05:00Z'))).toEqual(first);
    expect(await getBillingExchangeRate(new Date('2026-09-30T15:59:59Z'))).toEqual(first);
    expect(fetch).not.toHaveBeenCalled();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ base: 'USD', quote: 'CNY', date: '2026-09-30', rate: 6.8 }),
      ),
    );
    expect((await getMonthlyExchangeRate(new Date('2026-09-30T16:00:00Z'))).rate).toBe(6.8);
  });
  it('requests the latest published quote instead of a month-start historical date', async () => {
    saved = JSON.stringify({
      month: '2026-09',
      rate: 6.711,
      rateDate: '2026-09-04',
      updatedAt: '2026-09-05T00:00:00Z',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toBe('https://api.frankfurter.dev/v2/rate/USD/CNY?providers=ECB');
        return Response.json({ base: 'USD', quote: 'CNY', date: '2026-09-30', rate: 6.8 });
      }),
    );
    const { getMonthlyExchangeRate } = await import('./index');
    expect((await getMonthlyExchangeRate(new Date('2026-09-30T16:00:00Z'))).rate).toBe(6.8);
  });
  it('refuses billing without a recently fetched valid quote', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const { getBillingExchangeRate } = await import('./index');
    await expect(getBillingExchangeRate(new Date('2026-09-07T00:00:00Z'))).rejects.toThrow();
  });
  it.each([0, -1, 101])('does not accept invalid provider rate %s', async (rate) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ base: 'USD', quote: 'CNY', date: '2026-09-07', rate })),
    );
    const { getBillingExchangeRate } = await import('./index');
    await expect(getBillingExchangeRate(new Date('2026-09-07T10:00:00Z'))).rejects.toThrow();
  });
  it('keeps the saved rate if the provider returns an invalid rate', async () => {
    const old = {
      month: '2026-08',
      rate: 6.9,
      rateDate: '2026-07-31',
      updatedAt: '2026-08-01T00:00:00Z',
    };
    saved = JSON.stringify(old);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ base: 'USD', quote: 'CNY', date: '2026-08-31', rate: -1 })),
    );
    const { getMonthlyExchangeRate } = await import('./index');
    expect(await getMonthlyExchangeRate(new Date('2026-09-01T00:00:00Z'))).toEqual(old);
    expect(JSON.parse(saved!)).toEqual(old);
  });
});
