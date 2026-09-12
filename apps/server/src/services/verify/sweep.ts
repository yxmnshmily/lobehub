import { messages } from '@lobechat/database/schemas';
import type { VerifyCheckItem } from '@lobechat/types';
import debug from 'debug';
import { and, desc, eq } from 'drizzle-orm';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { VerifyRunItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';

import { planItemToPendingResult } from './resultSnapshot';
import { finalizeVerifyRun } from './settle';
import { VERIFY_ABANDONED_MS, VERIFY_ROLLUP_GRACE_MS } from './staleness';
import { VerifyStatusService } from './statusService';

const log = debug('lobe-server:verify-sweep');

/** An operation in any of these can still produce a verdict. */
const LIVE_OPERATION_STATUSES = new Set([
  'idle',
  'running',
  'waiting_for_human',
  'waiting_for_async_tool',
]);

const PENDING_RESULT_STATUSES = new Set(['pending', 'running']);

/** An operation in one of these will never produce a delivery again. */
const TERMINAL_OPERATION_STATUSES = new Set(['abandoned', 'done', 'error', 'interrupted']);

const SWEEP_PAGE_SIZE = 100;
/** Bound one tick's work; whatever is left is still there on the next one. */
const SWEEP_MAX_RUNS = 1000;

export interface VerifySweepOutcome {
  /** Runs whose outstanding checks were closed as `errored` before the rollup. */
  abandoned: string[];
  /** Stranded `planned` runs handed back to the completion gate to be judged. */
  refired: string[];
  /** Runs whose checks had all landed and only needed the missing rollup. */
  settled: string[];
  /** Runs left alone — still plausibly mid-flight. */
  skipped: number;
}

/**
 * Recover verification runs stranded in `verifying`.
 *
 * Entering `verifying` is a durable write; the judging that leaves it runs as
 * post-response work, so any host-level interruption — instance recycled,
 * deploy, OOM, provider hang — strands the run. Nothing downstream re-reads it:
 * the rollup is denormalized, the read paths trust it, and the task watchdog
 * only looks at tasks carrying a heartbeat timeout. Without this sweep such a
 * run is stuck for good, and so is the acceptance and goal card above it.
 *
 * Two shapes, deliberately treated differently:
 *
 * - **the rollup was lost** — every required check already holds a terminal
 *   verdict, so the truth is on disk and only the denormalized status disagrees.
 *   Recomputing is pure derivation; the only reason to wait out
 *   {@link VERIFY_ROLLUP_GRACE_MS} first is to stay clear of a live finalizer.
 * - **the verifier died mid-flight** — checks are still pending/running. Those
 *   carry no verdict and never will, so after {@link VERIFY_ABANDONED_MS} they
 *   are closed as `errored` (an infra failure, not a delivery judgment, so they
 *   neither gate delivery nor seed auto-repair) and the rollup follows.
 *
 * A check bound to a verifier operation that is still live keeps the whole run
 * out of the sweep however old it is — an agent verifier is a full sub-agent run
 * and its own terminal hook is what settles it.
 *
 * Recovery is leased per run (see {@link recoverRun}) so overlapping deliveries
 * of the cron cannot both drive the same run's finalizer.
 */
export const sweepStuckVerifyRuns = async (
  db: LobeChatDatabase,
  options?: { now?: Date; pageSize?: number },
): Promise<VerifySweepOutcome> => {
  const now = options?.now ?? new Date();
  const pageSize = options?.pageSize ?? SWEEP_PAGE_SIZE;
  const staleBefore = new Date(now.getTime() - VERIFY_ROLLUP_GRACE_MS);
  const outcome: VerifySweepOutcome = { abandoned: [], refired: [], settled: [], skipped: 0 };

  // Walk the whole stranded set, not just its oldest page: rows the sweep leaves
  // alone keep their timestamp, so a single fixed-size read would return the same
  // untouchable rows forever and never reach the runs behind them.
  let after: { id: string; updatedAt: Date } | undefined;
  let scanned = 0;

  while (scanned < SWEEP_MAX_RUNS) {
    const page = await VerifyRunModel.findStuckVerifying(db, staleBefore, {
      after,
      limit: pageSize,
    });
    if (page.length === 0) break;

    for (const run of page) {
      scanned += 1;
      try {
        const action = await recoverRun(db, run, now);
        if (action === 'skipped') outcome.skipped += 1;
        else outcome[action].push(run.id);
      } catch (error) {
        // One poisoned run must not stop the sweep for the rest.
        log('recovering run %s failed (non-fatal): %O', run.id, error);
        outcome.skipped += 1;
      }
    }

    const last = page.at(-1)!;
    after = { id: last.id, updatedAt: last.updatedAt };
    if (page.length < pageSize) break;
  }

  if (scanned >= SWEEP_MAX_RUNS) {
    log('sweep hit the per-run cap (%d) — the tail is left for the next tick', SWEEP_MAX_RUNS);
  }

  // Runs stranded before they ever entered `verifying` are invisible to the loop
  // above. Sweep them too, so a finished delivery whose gate never fired gets
  // judged instead of pinning its acceptance and goal cards forever.
  const strandedPlans = await VerifyRunModel.findStuckPlanned(
    db,
    new Date(now.getTime() - VERIFY_ABANDONED_MS),
  );
  for (const run of strandedPlans) {
    try {
      const action = await recoverPlannedRun(db, run, now);
      if (action === 'skipped') outcome.skipped += 1;
      else outcome[action].push(run.id);
    } catch (error) {
      // One poisoned run must not stop the sweep for the rest.
      log('recovering planned run %s failed (non-fatal): %O', run.id, error);
      outcome.skipped += 1;
    }
  }

  return outcome;
};

const recoverRun = async (
  db: LobeChatDatabase,
  run: VerifyRunItem,
  now: Date,
): Promise<'abandoned' | 'settled' | 'skipped'> => {
  const operationId = run.operationId;
  if (!operationId) return 'skipped';

  const workspaceId = run.workspaceId ?? undefined;
  const plan = (run.plan ?? []) as VerifyCheckItem[];
  if (plan.length === 0) return 'skipped';

  const resultModel = new VerifyCheckResultModel(db, run.userId, workspaceId);
  const results = await resultModel.listByRun(run.id);
  const byItem = new Map(results.map((result) => [result.checkItemId, result]));

  // Only required items decide the rollup — the same gate `recompute` applies.
  const outstanding = plan
    .filter((item) => item.required)
    .filter((item) => {
      const result = byItem.get(item.id);
      return !result || PENDING_RESULT_STATUSES.has(result.status);
    });

  if (outstanding.length > 0) {
    if (now.getTime() - run.updatedAt.getTime() < VERIFY_ABANDONED_MS) return 'skipped';

    const operationModel = new AgentOperationModel(db, run.userId, workspaceId);
    // A verifier refreshes its operation's `updatedAt` as a liveness lease on
    // every step (see `AgentOperationModel.touchRunning`), so a live *status*
    // with an expired lease is a dead process rather than work in flight.
    // Trusting the status alone stranded the run for good: nothing else retires a
    // verifier operation, this sweep kept skipping it, and the goal above then
    // waited out its own verify-settle grace on top of that.
    const verifierLeaseBefore = new Date(now.getTime() - VERIFY_ABANDONED_MS);
    for (const item of outstanding) {
      const verifierOperationId = byItem.get(item.id)?.verifierOperationId;
      if (!verifierOperationId) continue;
      const verifierOp = await operationModel.findById(verifierOperationId);
      if (!verifierOp || !LIVE_OPERATION_STATUSES.has(verifierOp.status)) continue;
      // Its verifier is still working — `settleVerifierCheckFromTerminal` owns
      // this row's ending, and stamping it `errored` now would discard a verdict
      // that is still coming.
      if (verifierOp.updatedAt.getTime() >= verifierLeaseBefore.getTime()) return 'skipped';

      // Retire the dead verifier so this and later ticks stop seeing it as live.
      await operationModel.settleStaleRunning(verifierOperationId, verifierLeaseBefore);
    }
  }

  // Committed to acting — take the lease first. Everything below has side effects
  // beyond this run: `finalizeVerifyRun` spawns the repair round, and
  // `triggerAutoRepair` has no claim of its own, so two overlapping sweep
  // deliveries reaching it would launch duplicate repair agents against the same
  // failures. The claim re-stamps `updated_at`, which is exactly what a
  // concurrent sweep's CAS tests against, so the loser drops the run.
  //
  // Deliberately after the skip decisions: claiming a run we then leave alone
  // would push its `updated_at` forward every tick and it would never reach the
  // abandoned bound.
  const statusService = new VerifyStatusService(db, run.userId, workspaceId);
  if (
    !(await statusService.claimVerifying(
      operationId,
      new Date(now.getTime() - VERIFY_ROLLUP_GRACE_MS),
    ))
  )
    return 'skipped';

  if (outstanding.length > 0) {
    await Promise.all(
      outstanding.map((item) =>
        // Upsert, not update: a run interrupted between entering `verifying` and
        // creating its pending rows has plan items with no row at all. Updating
        // would touch nothing, `recompute` would still read them as pending, and
        // the run would stay stranded while the sweep reported it recovered.
        resultModel.upsertByCheckItem({
          ...planItemToPendingResult(run.id, operationId, item),
          // Re-asserted after the spread: the upsert key is required, and the
          // snapshot's own fields are optional-nullable.
          checkItemId: item.id,
          verifyRunId: run.id,
          completedAt: now,
          status: 'errored',
          suggestion: 'Rerun verification for this delivery.',
          toulmin: { limitation: 'Verification was interrupted before this check was judged.' },
        }),
      ),
    );
  }

  await statusService.recompute(operationId);
  // No report context — the sweep holds no deliverable. The task is still driven,
  // which is the whole point: the goal has been waiting on this verdict.
  await finalizeVerifyRun(db, run.userId, operationId, {}, workspaceId);

  const action = outstanding.length > 0 ? 'abandoned' : 'settled';
  log('recovered run %s (op %s) as %s', run.id, operationId, action);
  return action;
};

/** The delivery a finished operation produced, read the way the gate reads it. */
const latestAssistantContent = async (
  db: LobeChatDatabase,
  topicId: string | null,
): Promise<string> => {
  if (!topicId) return '';

  const [latest] = await db
    .select({ content: messages.content })
    .from(messages)
    .where(and(eq(messages.topicId, topicId), eq(messages.role, 'assistant')))
    .orderBy(desc(messages.createdAt))
    .limit(1);

  return typeof latest?.content === 'string' ? latest.content : '';
};

/**
 * Recover a run stranded before it ever reached `verifying`, decided by the
 * operation behind it:
 *
 * - **the delivery finished** (`done`): the gate that judges it never ran,
 *   because the host that would have fired it died in between. Hand the run back
 *   to that gate — it is status-guarded, so a duplicate late call is a no-op —
 *   rather than writing a finished delivery off as unjudged.
 * - **the operation never delivered**: there is nothing to judge, so it is
 *   abandoned exactly like a stranded `verifying` run.
 */
const recoverPlannedRun = async (
  db: LobeChatDatabase,
  run: VerifyRunItem,
  now: Date,
): Promise<'abandoned' | 'refired' | 'settled' | 'skipped'> => {
  const operationId = run.operationId;
  if (!operationId) return 'skipped';

  const workspaceId = run.workspaceId ?? undefined;
  const plan = (run.plan ?? []) as VerifyCheckItem[];
  if (plan.length === 0) return 'skipped';

  const operationModel = new AgentOperationModel(db, run.userId, workspaceId);
  const op = await operationModel.findById(operationId);
  if (!op) return 'skipped';

  if (op.status === 'done') {
    const runModel = new VerifyRunModel(db, run.userId, workspaceId);
    // The gate only proceeds on a confirmed plan; the instantiation that created
    // this run normally confirms it, but a run can be interrupted in between.
    if (!run.planConfirmedAt) await runModel.confirmPlan(run.id);

    const deliverable = await latestAssistantContent(db, op.topicId);
    const { runVerifyOnCompletion } = await import('./lifecycle');
    await runVerifyOnCompletion(
      db,
      run.userId,
      { deliverable, goal: run.goal ?? '', operationId },
      workspaceId,
    );

    return 'refired';
  }

  if (!TERMINAL_OPERATION_STATUSES.has(op.status)) return 'skipped';

  return recoverRun(db, run, now);
};
