import debug from 'debug';

const log = debug('lobe-server:recovery-sweeps');

/**
 * Stranded verification runs, stalled goals and heartbeat-timeout tasks are
 * swept by QStash cron routes: `/api/workflows/verify/sweep`,
 * `/api/workflows/goal/sweep` and `/api/workflows/task/watchdog`. Nothing else
 * calls them — every one of those handlers is `qstashAuth`-guarded, and
 * `qstashAuth` only verifies a signature when `QSTASH_CURRENT_SIGNING_KEY` is
 * set. An installation without that key therefore has no scheduler at all, and a
 * run whose host was recycled — or an operation whose process died mid-turn —
 * pins its acceptance and goal card forever: the sweep that would reclaim it is
 * never invoked.
 *
 * This drives those same routes on a timer for exactly that case. The endpoints
 * stay the single source of truth: calling them reuses each handler's lease,
 * ordering and reporting rather than re-deriving the sweeps here.
 */
const SWEEP_INTERVAL_MS = 2 * 60 * 1000;
/** First pass shortly after boot, to reclaim whatever the previous process left behind. */
const SWEEP_STARTUP_DELAY_MS = 10 * 1000;
/** A single sweep may page through many runs; give it room but never wedge the loop. */
const SWEEP_TIMEOUT_MS = 5 * 60 * 1000;

export const RECOVERY_SWEEP_PATHS = ['goal/sweep', 'verify/sweep', 'task/watchdog'] as const;

interface RecoverySweepState {
  running?: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

const state = globalThis as typeof globalThis & { recoverySweeps?: RecoverySweepState };

const resolveBaseUrl = (): string => {
  const configured = process.env.APP_URL?.trim();
  const base =
    configured && configured.length > 0
      ? configured
      : `http://localhost:${process.env.PORT || 3210}`;

  return base.replace(/\/+$/, '');
};

/**
 * Release credit holds whose provider call started and then vanished. No HTTP
 * route owns this: a `provider_started` reservation is settled by the process
 * that made the call, and that process is exactly what died. Running the model
 * directly keeps the fix inside the same recovery pass.
 */
const reapAbandonedReservations = async (): Promise<number> => {
  const [{ PlatformCreditModel }, { getServerDB }] = await Promise.all([
    import('@/database/models/platformCredit'),
    import('@/database/server'),
  ]);

  const db = await getServerDB();

  const { reaped } = await PlatformCreditModel.reapAbandonedProviderReservations(db);

  // A hold whose lease ran out without ever reaching the provider is not the
  // abandoned-call case above — it is a hold its owner never came back for, and
  // while it sits there it counts as a live call and pins its budget active.
  // `reapExpiredBudget` expires exactly those holds (and the budget with them),
  // but it is per-budget and nothing else in the platform drives it, so drive it
  // here for every budget that has one.
  let expiredBudgets = 0;
  for (const budget of await PlatformCreditModel.findBudgetsWithStaleReservations(db)) {
    await new PlatformCreditModel(db, budget.userId).reapExpiredBudget(budget.id);
    expiredBudgets += 1;
  }

  return reaped + expiredBudgets;
};

export interface RecoverySweepDeps {
  fetcher?: typeof fetch;
  reapAbandonedProviderReservations?: () => Promise<number>;
}

/**
 * Run one pass of every recovery sweep, sequentially. Resolves once all of them
 * have been attempted; a failing sweep is logged and does not stop the others.
 */
export const runRecoverySweepsOnce = async (deps: RecoverySweepDeps = {}): Promise<void> => {
  const fetcher = deps.fetcher ?? fetch;
  const reap = deps.reapAbandonedProviderReservations ?? reapAbandonedReservations;
  const base = resolveBaseUrl();

  for (const path of RECOVERY_SWEEP_PATHS) {
    try {
      const response = await fetcher(`${base}/api/workflows/${path}`, {
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: AbortSignal.timeout(SWEEP_TIMEOUT_MS),
      });

      if (!response.ok) log('%s responded %d', path, response.status);
    } catch (error) {
      // A busy or restarting server must not kill the schedule.
      log('%s failed: %O', path, error);
    }
  }

  try {
    const reaped = await reap();
    if (reaped > 0) log('released %d abandoned provider reservations', reaped);
  } catch (error) {
    log('reaping abandoned reservations failed: %O', error);
  }
};

/**
 * Start the in-process sweep loop. Idempotent across module reloads (dev HMR
 * re-runs `register()`) because the guard lives on `globalThis`.
 */
export const startRecoverySweeps = (deps: RecoverySweepDeps = {}): void => {
  if (state.recoverySweeps) return;

  const scheduler: RecoverySweepState = {};
  state.recoverySweeps = scheduler;

  const schedule = (delay: number) => {
    scheduler.timer = setTimeout(() => {
      void (async () => {
        if (!scheduler.running) {
          scheduler.running = true;
          try {
            await runRecoverySweepsOnce(deps);
          } finally {
            scheduler.running = false;
          }
        }

        schedule(SWEEP_INTERVAL_MS);
      })();
    }, delay);

    // Never hold the process open for a sweep.
    scheduler.timer.unref?.();
  };

  schedule(SWEEP_STARTUP_DELAY_MS);
  log('recovery sweeps scheduled every %dms', SWEEP_INTERVAL_MS);
};
