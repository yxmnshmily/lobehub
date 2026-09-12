import { messages } from '@lobechat/database/schemas';
import debug from 'debug';
import { and, desc, eq } from 'drizzle-orm';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { TaskModel } from '@/database/models/task';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { LobeChatDatabase } from '@/database/type';

import { AcceptanceService } from './acceptanceService';
import { resolveVerifyModelConfig } from './modelConfig';
import { VerifyPlanGeneratorService } from './planGenerator';
import { resolveTaskAcceptance } from './taskAcceptance';

const log = debug('lobe-server:verify-plan-instantiation');

/** Operation statuses that mean the run will never complete again. */
const TERMINAL_OPERATION_STATUSES = new Set([
  'done',
  'error',
  'interrupted',
  'aborted',
  'canceled',
]);

export interface InstantiateVerifyPlanParams {
  operationId: string;
  taskId: string;
}

/**
 * Auto-instantiate + auto-confirm a verify plan for a task-bound operation at run
 * start, so the completion-time gate (`runVerifyOnCompletion`) actually fires.
 *
 * Without this, a task's Acceptance policy (rubric / criteria) is never turned
 * into a plan, so verify silently no-ops. We resolve the Task's Acceptance and
 * materialize the rubric + ad-hoc criteria into a plan (no AI generation there
 * — the task already picked its criteria), and confirm it immediately (task
 * scenario doesn't show a "confirm plan" step). Only the undecomposed path
 * spends an AI call: the acceptance requirement is split into named criteria so
 * the checklist shows distinguishable items, with the single holistic check as
 * the fallback when generation fails.
 *
 * Fire-and-forget + idempotent: never throws (verify must not affect the run),
 * and skips when a plan already exists (recordStart can re-fire).
 */
export const instantiateVerifyPlanOnStart = async (
  db: LobeChatDatabase,
  userId: string,
  params: InstantiateVerifyPlanParams,
  workspaceId?: string,
): Promise<void> => {
  try {
    const taskModel = new TaskModel(db, userId, workspaceId);

    const resolvedAcceptance = await resolveTaskAcceptance(db, userId, params.taskId, workspaceId);
    if (!resolvedAcceptance) return;
    const { acceptance, config: verifyConfig, requirement } = resolvedAcceptance;

    // Opt-in to verify, then pick the plan shape:
    //  - rubric / ad-hoc criteria  → decomposed multi-item plan (existing path)
    //  - else explicitly enabled OR a one-sentence acceptance requirement set
    //    → coarse single holistic agent check
    //  - no signal at all          → verify stays off
    if (verifyConfig.enabled === false) return;
    const hasCriteria = Boolean(
      verifyConfig.verifyRubricId || verifyConfig.verifyCriteriaIds?.length,
    );
    const holistic =
      !hasCriteria && (verifyConfig.enabled === true || Boolean(requirement?.trim()));
    if (!hasCriteria && !holistic) return;

    const runModel = new VerifyRunModel(db, userId, workspaceId);
    const existing = await runModel.findByOperation(params.operationId);
    // Idempotent: a plan already exists for this run (re-fire, or agent/UI-built).
    if (existing?.plan?.length) return;

    const task = await taskModel.findById(params.taskId);
    const goal = task?.instruction ?? task?.name ?? '';

    const planGenerator = new VerifyPlanGeneratorService(db, userId, workspaceId);
    // Undecomposed acceptance (goal-dispatched Task, one-sentence requirement):
    // spend one generation call splitting the requirement into named criteria,
    // so the checklist reads as distinguishable items instead of one generic
    // "Task delivery acceptance" row.
    const modelConfig = holistic
      ? await resolveVerifyModelConfig(
          db,
          userId,
          { verifierAgentId: verifyConfig.verifierAgentId },
          workspaceId,
        )
      : undefined;
    await planGenerator.generateDraftPlan({
      // Ground the generated criteria in the acceptance text, not just the title.
      context: requirement,
      // Configured rubric/criteria ARE the plan — no AI proposal on that path.
      enableAiGeneration: holistic,
      goal,
      // Still fall back to the single agent-type holistic check when the
      // generation fails or returns nothing, so verify runs either way.
      holisticFallback: holistic,
      modelConfig,
      operationId: params.operationId,
      requirement,
      verifyCriteriaIds: verifyConfig.verifyCriteriaIds,
      verifyRubricId: verifyConfig.verifyRubricId,
    });

    // generateDraftPlan only sets the (draft) plan; the task scenario auto-confirms
    // so the completion gate treats it as ready instead of a pending draft.
    const run = await runModel.findByOperation(params.operationId);
    if (run?.plan?.length) {
      // Carry the Acceptance repair/re-run cap onto
      // the run so auto-repair honors it. Without this the repair path falls back
      // to the source rubric's config or the default, dropping the task cap for
      // ad-hoc-criteria or per-task-override tasks.
      if (typeof verifyConfig.maxIterations === 'number') {
        await runModel.setMetadata(run.id, { maxRepairRounds: verifyConfig.maxIterations });
      }
      await runModel.confirmPlan(run.id);

      // A task verification round belongs to its business-level Acceptance from
      // the moment the plan is confirmed. This lets the task surface show live
      // planned/verifying/repairing progress instead of waiting for an external
      // ingest command to create the aggregate after verification has finished.
      const acceptanceService = new AcceptanceService(db, userId, workspaceId);
      await acceptanceService.attachPolicyRun(run.id, acceptance.id);

      log(
        'instantiated + confirmed verify plan for op %s (%d items), acceptance %s',
        params.operationId,
        run.plan.length,
        acceptance.id,
      );

      // Race guard for task-driven runs. This instantiation is fire-and-forget
      // and (on the holistic path) spends an AI call, while a task operation can
      // terminate before it lands — the in-memory hand-off in CompletionLifecycle
      // only covers operations that registered a promise there (top-level task
      // ops), and a task's member operation may not. The completion-time gate
      // resolves its run by operation id and silently returns when the run does
      // not exist yet, which would leave this run planned forever with nobody
      // left to re-fire it. Now that a confirmed plan exists, re-run the
      // completion gate when the operation has already terminated;
      // `claimEvidenceCollection` and `claimVerifying` are status-guarded, so a
      // duplicate late call is a no-op.
      try {
        const op = await new AgentOperationModel(db, userId, workspaceId).findById(
          params.operationId,
        );
        if (op && TERMINAL_OPERATION_STATUSES.has(op.status)) {
          const [latestAssistant] = op.topicId
            ? await db
                .select({ content: messages.content })
                .from(messages)
                .where(and(eq(messages.topicId, op.topicId), eq(messages.role, 'assistant')))
                .orderBy(desc(messages.createdAt))
                .limit(1)
            : [];
          const deliverable =
            typeof latestAssistant?.content === 'string' ? latestAssistant.content : '';

          const { runVerifyOnCompletion } = await import('./lifecycle');
          await runVerifyOnCompletion(
            db,
            userId,
            { deliverable, goal: run.goal ?? '', operationId: params.operationId },
            workspaceId,
          );
          log('re-fired completion gate for already-terminated op %s', params.operationId);
        }
      } catch (error) {
        log('completion-gate race guard failed (non-fatal): %O', error);
      }
    }
  } catch (error) {
    log('instantiateVerifyPlanOnStart failed for op %s (non-fatal): %O', params.operationId, error);
  }
};
