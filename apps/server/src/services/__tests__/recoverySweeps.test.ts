// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  RECOVERY_SWEEP_PATHS,
  runRecoverySweepsOnce,
  startRecoverySweeps,
} from '../recoverySweeps';

describe('recovery sweeps', () => {
  const originalAppUrl = process.env.APP_URL;

  const stubReaper = () => vi.fn().mockResolvedValue(0);

  afterEach(() => {
    if (originalAppUrl === undefined) {
      delete process.env.APP_URL;
    } else {
      process.env.APP_URL = originalAppUrl;
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('drives every recovery sweep route through the configured origin', async () => {
    process.env.APP_URL = 'http://localhost:3010/lobehub/';
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await runRecoverySweepsOnce({ fetcher: fetcher as unknown as typeof fetch });

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(
      RECOVERY_SWEEP_PATHS.map((path) => `http://localhost:3010/lobehub/api/workflows/${path}`),
    );
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({ method: 'POST' });
    }
  });

  it('keeps driving the remaining sweeps when one route fails', async () => {
    process.env.APP_URL = 'http://localhost:3010/lobehub';
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValue({ ok: false, status: 503 });

    await expect(
      runRecoverySweepsOnce({ fetcher: fetcher as unknown as typeof fetch }),
    ).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(RECOVERY_SWEEP_PATHS.length);
  });

  it('releases abandoned provider holds on the same pass', async () => {
    process.env.APP_URL = 'http://localhost:3010/lobehub';
    const reaper = vi.fn().mockResolvedValue(3);

    await runRecoverySweepsOnce({
      fetcher: vi.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch,
      reapAbandonedProviderReservations: reaper,
    });

    expect(reaper).toHaveBeenCalledTimes(1);
  });

  it('still sweeps the routes when reaping fails', async () => {
    process.env.APP_URL = 'http://localhost:3010/lobehub';
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await expect(
      runRecoverySweepsOnce({
        fetcher: fetcher as unknown as typeof fetch,
        reapAbandonedProviderReservations: vi.fn().mockRejectedValue(new Error('db down')),
      }),
    ).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(RECOVERY_SWEEP_PATHS.length);
  });

  it('arms a single sweep loop however often it is started', async () => {
    process.env.APP_URL = 'http://localhost:3010/lobehub';
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetcher);
    vi.useFakeTimers();

    // Dev HMR re-runs register(); the guard has to survive a second call.
    startRecoverySweeps({ reapAbandonedProviderReservations: stubReaper() });
    startRecoverySweeps({ reapAbandonedProviderReservations: stubReaper() });

    await vi.advanceTimersByTimeAsync(11_000);

    expect(fetcher).toHaveBeenCalledTimes(RECOVERY_SWEEP_PATHS.length);
  });
});
