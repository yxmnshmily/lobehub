import type {
  AgentOperationCompletionReason,
  AgentOperationStatus,
  VerifyRunStatus,
} from '@lobechat/types';
import { and, count, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';

import { today } from '@/utils/time';

import type {
  AgentOperationAppContext,
  AgentOperationError,
  AgentOperationInterruption,
  NewAgentOperation,
} from '../schemas/agentOperations';
import { agentOperations } from '../schemas/agentOperations';
import { chatGroupUserMemberships } from '../schemas/chatGroupUserMembership';
import { users } from '../schemas/user';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

/**
 * Verify rollup states. Aliases the single `VerifyRunStatus` source of truth in
 * `@lobechat/types` (which also backs the `verify_status` column enum and
 * `verify_runs.status`) so the three never drift.
 */
export type VerifyStatus = VerifyRunStatus;

export interface RecordOperationStartParams {
  agentId?: string | null;
  appContext?: AgentOperationAppContext;
  chatGroupId?: string | null;
  maxSteps?: number;
  /**
   * Durable per-run metadata persisted on the operation row (jsonb). Carries the
   * Agent Signal run marker so server-side tools can read it back from the row
   * (`metadata.agentSignal`) at tool-call time.
   */
  metadata?: Record<string, unknown>;
  model?: string;
  modelRuntimeConfig?: Record<string, unknown>;
  operationId: string;
  parentOperationId?: string | null;
  provider?: string;
  startedAt?: Date;
  taskId?: string | null;
  threadId?: string | null;
  topicId?: string | null;
  trigger?: string;
}

export interface AgentInterventionDispatchMarker {
  deduplicationId: string;
  messageId: string;
  resolutionRequestId: string;
  scheduledAt: string;
  state: 'scheduled';
}

export interface AgentInterventionPreparationMarker {
  deduplicationId: string;
  resolutionRequestId: string;
  state: 'ready';
  stepIndex: number;
}

/** Terminal usage summed across every child operation of one parent. All-zero when it has none. */
export interface ChildUsageRollup {
  llmCalls: number;
  toolCalls: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
}

export interface RecordOperationCompletionParams {
  completedAt?: Date;
  completionReason?: AgentOperationCompletionReason;
  cost?: Record<string, unknown> | null;
  error?: AgentOperationError | null;
  hostedGroupMemberFinal?: HostedGroupMemberFinalMarker;
  interruption?: AgentOperationInterruption | null;
  llmCalls?: number | null;
  /** Backfill the executed model when it's only known at completion (e.g. a
   * heterogeneous run learns its real model from the CLI mid-stream). Omit to
   * keep the value seeded at `recordStart`. */
  model?: string | null;
  processingTimeMs?: number | null;
  /** Backfill the executed provider — see {@link RecordOperationCompletionParams.model}. */
  provider?: string | null;
  status: Exclude<AgentOperationStatus, 'idle'>;
  stepCount?: number | null;
  toolCalls?: number | null;
  totalCost?: number | null;
  totalInputTokens?: number | null;
  totalOutputTokens?: number | null;
  totalTokens?: number | null;
  traceS3Key?: string | null;
  usage?: Record<string, unknown> | null;
}

export interface HostedGroupMemberFinalMarker {
  actorUserIdSnapshot: string;
  assistantMessageId: string;
  contentHash: string;
  groupId: string;
  membershipVersion: number;
  operationId: string;
  ownerUserIdSnapshot: string;
  publishedAt: string;
  version: 1;
}

export interface HostedGroupSponsoredBudgetLocator {
  actorUserId: string;
  budgetId: string;
  budgetLeaseVersion: number;
  expiresAt: string;
  groupId: string;
  membershipVersion: number;
  operationId: string;
  payerUserId: string;
  policyVersion: number;
  resourceOwnerUserId: string;
  version: 1;
}

const canonicalText = (value: string) => Boolean(value) && value.trim() === value;

const positiveSafeInteger = (value: number) => Number.isSafeInteger(value) && value > 0;

const normalizeHostedGroupSponsoredBudgetLocator = (
  input: HostedGroupSponsoredBudgetLocator,
): HostedGroupSponsoredBudgetLocator | undefined => {
  const expiresAt = Date.parse(input.expiresAt);
  if (
    input.version !== 1 ||
    !canonicalText(input.operationId) ||
    !canonicalText(input.actorUserId) ||
    !canonicalText(input.payerUserId) ||
    !canonicalText(input.resourceOwnerUserId) ||
    input.actorUserId === input.resourceOwnerUserId ||
    input.payerUserId !== input.resourceOwnerUserId ||
    !canonicalText(input.groupId) ||
    !canonicalText(input.budgetId) ||
    !positiveSafeInteger(input.budgetLeaseVersion) ||
    !positiveSafeInteger(input.membershipVersion) ||
    !positiveSafeInteger(input.policyVersion) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() ||
    new Date(expiresAt).toISOString() !== input.expiresAt
  ) {
    return undefined;
  }

  return {
    actorUserId: input.actorUserId,
    budgetId: input.budgetId,
    budgetLeaseVersion: input.budgetLeaseVersion,
    expiresAt: input.expiresAt,
    groupId: input.groupId,
    membershipVersion: input.membershipVersion,
    operationId: input.operationId,
    payerUserId: input.payerUserId,
    policyVersion: input.policyVersion,
    resourceOwnerUserId: input.resourceOwnerUserId,
    version: 1,
  };
};

export class AgentOperationModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agentOperations);

  private static readonly WEBSITE_AI_ADMISSION_TRIGGER = 'website_ai_admission';

  /**
   * Read the per-customer activity used by the public Website AI admission gate.
   * Restricting the count to the group's supervisor excludes child specialist
   * runs, so one multi-agent request is still counted as one customer request.
   */
  async getWebsiteAiActivitySnapshot(params: {
    agentId: string;
    chatGroupId: string;
    recentSince: Date;
  }): Promise<{ activeCount: number; recentCount: number }> {
    const scope = and(
      this.ownership(),
      eq(agentOperations.agentId, params.agentId),
      eq(agentOperations.chatGroupId, params.chatGroupId),
    );
    const activeStatuses: AgentOperationStatus[] = [
      'running',
      'waiting_for_async_tool',
      'waiting_for_human',
    ];
    const [[active], [recent]] = await Promise.all([
      this.db
        .select({ value: count() })
        .from(agentOperations)
        .where(
          and(
            scope,
            inArray(agentOperations.status, activeStatuses),
            or(
              isNull(agentOperations.trigger),
              ne(agentOperations.trigger, AgentOperationModel.WEBSITE_AI_ADMISSION_TRIGGER),
              gte(agentOperations.createdAt, params.recentSince),
            ),
          ),
        ),
      this.db
        .select({ value: count() })
        .from(agentOperations)
        .where(
          and(
            scope,
            eq(agentOperations.trigger, AgentOperationModel.WEBSITE_AI_ADMISSION_TRIGGER),
            gte(agentOperations.createdAt, params.recentSince),
          ),
        ),
    ]);

    return {
      activeCount: Number(active?.value ?? 0),
      recentCount: Number(recent?.value ?? 0),
    };
  }

  /**
   * Atomically admit one Website AI start across every server instance.
   * The user-row lock serializes the read-and-reserve section without holding a
   * database connection for the full model run. The reservation is an ordinary
   * operation row so crashes remain visible and expire from active admission
   * after the rolling window instead of becoming a permanent lock.
   */
  async reserveWebsiteAiAdmission(params: {
    activeLimit: number;
    agentId: string;
    chatGroupId: string;
    recentLimit: number;
    recentSince: Date;
    reservationId: string;
  }): Promise<'active_limit' | 'recent_limit' | 'reserved'> {
    return this.db.transaction(async (trx) => {
      const scopedDB = trx as LobeChatDatabase;
      const [user] = await scopedDB
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, this.userId))
        .for('update');
      if (!user) throw new Error('Website AI customer account not found');

      const snapshot = await new AgentOperationModel(
        scopedDB,
        this.userId,
        this.workspaceId,
      ).getWebsiteAiActivitySnapshot({
        agentId: params.agentId,
        chatGroupId: params.chatGroupId,
        recentSince: params.recentSince,
      });
      if (snapshot.activeCount >= params.activeLimit) return 'active_limit';
      if (snapshot.recentCount >= params.recentLimit) return 'recent_limit';

      await scopedDB.insert(agentOperations).values({
        agentId: params.agentId,
        chatGroupId: params.chatGroupId,
        id: params.reservationId,
        metadata: { websiteAiAdmission: true },
        status: 'running',
        trigger: AgentOperationModel.WEBSITE_AI_ADMISSION_TRIGGER,
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      });
      return 'reserved';
    });
  }

  /**
   * Insert the initial row when an operation is created. Idempotent via
   * `onConflictDoNothing` on the primary key so resumed operations don't
   * blow up on the second createOperation call.
   */
  async recordStart(params: RecordOperationStartParams): Promise<void> {
    const values: NewAgentOperation = {
      agentId: params.agentId ?? null,
      appContext: params.appContext,
      chatGroupId: params.chatGroupId ?? null,
      id: params.operationId,
      maxSteps: params.maxSteps,
      ...(params.metadata ? { metadata: params.metadata } : {}),
      model: params.model,
      modelRuntimeConfig: params.modelRuntimeConfig,
      parentOperationId: params.parentOperationId ?? null,
      provider: params.provider,
      startedAt: params.startedAt ?? new Date(),
      status: 'running',
      taskId: params.taskId ?? null,
      threadId: params.threadId ?? null,
      topicId: params.topicId ?? null,
      trigger: params.trigger,
      userId: this.userId,
      workspaceId: this.workspaceId ?? null,
    };

    await this.db.insert(agentOperations).values(values).onConflictDoNothing();
  }

  /**
   * Persist the server-only sponsored-budget locator before queue dispatch.
   * The first exact value wins; a conflicting retry can never replace it.
   */
  async recordHostedGroupSponsoredBudgetLocator(
    input: HostedGroupSponsoredBudgetLocator,
  ): Promise<boolean> {
    const locator = normalizeHostedGroupSponsoredBudgetLocator(input);
    if (!locator || locator.resourceOwnerUserId !== this.userId || this.workspaceId) return false;

    const hostedRunIdentity = {
      actorUserIdSnapshot: locator.actorUserId,
      groupId: locator.groupId,
      membershipVersion: locator.membershipVersion,
      ownerUserIdSnapshot: locator.resourceOwnerUserId,
      version: 1,
    };
    const serialized = JSON.stringify(locator);
    const [row] = await this.db
      .update(agentOperations)
      .set({
        metadata: sql`jsonb_set(
          coalesce(${agentOperations.metadata}, '{}'::jsonb),
          '{hostedGroupSponsoredBudgetLocator}',
          ${serialized}::jsonb,
          true
        )`,
      })
      .where(
        and(
          eq(agentOperations.id, locator.operationId),
          eq(agentOperations.chatGroupId, locator.groupId),
          eq(agentOperations.status, 'running'),
          isNull(agentOperations.workspaceId),
          this.ownership(),
          sql`${agentOperations.metadata} @> ${JSON.stringify({ hostedGroupRun: hostedRunIdentity })}::jsonb`,
          sql`(
            ${agentOperations.metadata}->'hostedGroupSponsoredBudgetLocator' is null
            or ${agentOperations.metadata}->'hostedGroupSponsoredBudgetLocator' = ${serialized}::jsonb
          )`,
        ),
      )
      .returning({ id: agentOperations.id });

    return Boolean(row);
  }

  /** System-only raw read; the server locator service performs strict parsing and binding checks. */
  async findHostedGroupSponsoredBudgetLocator(operationId: string): Promise<unknown | null> {
    if (!canonicalText(operationId) || this.workspaceId) return null;
    const [row] = await this.db
      .select({ metadata: agentOperations.metadata })
      .from(agentOperations)
      .where(
        and(
          eq(agentOperations.id, operationId),
          eq(agentOperations.status, 'running'),
          isNull(agentOperations.workspaceId),
          this.ownership(),
        ),
      )
      .limit(1);
    const metadata = row?.metadata as Record<string, unknown> | null | undefined;
    return metadata?.hostedGroupSponsoredBudgetLocator ?? null;
  }

  /**
   * Newest operation in this topic that is parked waiting for tool approval.
   *
   * A parked run is stream-terminal, so the client marks its own operation
   * completed and prunes it — by the time the user decides to stop, only the
   * DB still knows which operation is holding the turn. Scoped by `userId` so
   * one user can never resolve (and then terminate) another's run.
   */
  async findLatestParkedOperationId(topicId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ id: agentOperations.id })
      .from(agentOperations)
      .where(
        and(
          eq(agentOperations.topicId, topicId),
          eq(agentOperations.userId, this.userId),
          eq(agentOperations.status, 'waiting_for_human'),
        ),
      )
      .orderBy(sql`${agentOperations.createdAt} desc`)
      .limit(1);

    return row?.id;
  }

  /**
   * Update the row when the operation reaches a terminal state. Scoped by
   * `userId` so a leaked operationId can't be used to flip another user's
   * row. No-op when the start row was never written.
   */
  async recordCompletion(
    operationId: string,
    params: RecordOperationCompletionParams,
  ): Promise<boolean> {
    const updates: Partial<NewAgentOperation> & { metadata?: unknown } = {
      completionReason: params.completionReason,
      status: params.status,
    };

    if (params.hostedGroupMemberFinal) {
      const marker = params.hostedGroupMemberFinal;
      if (
        params.status !== 'done' ||
        params.completionReason !== 'done' ||
        marker.version !== 1 ||
        marker.operationId !== operationId ||
        marker.ownerUserIdSnapshot !== this.userId ||
        marker.actorUserIdSnapshot === marker.ownerUserIdSnapshot ||
        !marker.actorUserIdSnapshot.trim() ||
        !marker.assistantMessageId.trim() ||
        !/^[a-f\d]{64}$/.test(marker.contentHash) ||
        !marker.groupId.trim() ||
        !Number.isFinite(Date.parse(marker.publishedAt)) ||
        !Number.isSafeInteger(marker.membershipVersion) ||
        marker.membershipVersion <= 0
      ) {
        return false;
      }
      const hostedRunIdentity = {
        actorUserIdSnapshot: marker.actorUserIdSnapshot,
        groupId: marker.groupId,
        membershipVersion: marker.membershipVersion,
        ownerUserIdSnapshot: marker.ownerUserIdSnapshot,
        version: 1,
      };
      const durableHostedRunMatches = sql`${agentOperations.metadata} @> ${JSON.stringify({ hostedGroupRun: hostedRunIdentity })}::jsonb`;
      const membershipIsCurrent = sql`exists (
        select 1 from ${chatGroupUserMemberships}
        where ${chatGroupUserMemberships.chatGroupId} = ${marker.groupId}
          and ${chatGroupUserMemberships.userId} = ${marker.actorUserIdSnapshot}
          and ${chatGroupUserMemberships.membershipVersion} = ${marker.membershipVersion}
          and ${chatGroupUserMemberships.removedAt} is null
      )`;
      const isFirstTerminalPublish = sql`${agentOperations.status} in (
        'running',
        'waiting_for_human',
        'waiting_for_async_tool'
      )`;
      updates.metadata = sql`case
        when ${durableHostedRunMatches}
          and ${membershipIsCurrent}
          and ${isFirstTerminalPublish}
        then jsonb_set(
          coalesce(${agentOperations.metadata}, '{}'::jsonb),
          '{hostedGroupMemberFinal}',
          coalesce(
            ${agentOperations.metadata}->'hostedGroupMemberFinal',
            ${JSON.stringify(marker)}::jsonb
          ),
          true
        )
        else ${agentOperations.metadata}
      end`;
    }

    // Only set completedAt when explicitly provided so callers can mark a
    // non-terminal status (e.g. waiting_for_human) without falsely stamping
    // completion time.
    if (params.completedAt !== undefined) updates.completedAt = params.completedAt;
    if (params.processingTimeMs !== undefined) updates.processingTimeMs = params.processingTimeMs;
    if (params.stepCount !== undefined) updates.stepCount = params.stepCount;
    if (params.totalCost !== undefined) updates.totalCost = params.totalCost;
    if (params.totalTokens !== undefined) updates.totalTokens = params.totalTokens;
    if (params.totalInputTokens !== undefined) updates.totalInputTokens = params.totalInputTokens;
    if (params.totalOutputTokens !== undefined)
      updates.totalOutputTokens = params.totalOutputTokens;
    if (params.llmCalls !== undefined) updates.llmCalls = params.llmCalls;
    if (params.toolCalls !== undefined) updates.toolCalls = params.toolCalls;
    if (params.model !== undefined) updates.model = params.model;
    if (params.provider !== undefined) updates.provider = params.provider;
    if (params.cost !== undefined) updates.cost = params.cost;
    if (params.usage !== undefined) updates.usage = params.usage;
    if (params.error !== undefined) updates.error = params.error;
    if (params.interruption !== undefined) updates.interruption = params.interruption;
    if (params.traceS3Key !== undefined) updates.traceS3Key = params.traceS3Key;

    const [row] = await this.db
      .update(agentOperations)
      .set(updates)
      .where(
        and(
          eq(agentOperations.id, operationId),
          or(
            inArray(agentOperations.status, [
              'running',
              'waiting_for_human',
              'waiting_for_async_tool',
            ]),
            eq(agentOperations.status, params.status),
          ),
          this.ownership(),
        ),
      )
      .returning({ id: agentOperations.id });

    return Boolean(row);
  }

  /**
   * Persist provider enqueue acknowledgement without replacing other runtime
   * metadata. The provenance request id is checked in SQL so a stale/colliding
   * operation can never be marked scheduled by another intervention.
   */
  async recordAgentInterventionDispatch(
    operationId: string,
    marker: AgentInterventionDispatchMarker,
  ): Promise<boolean> {
    const [row] = await this.db
      .update(agentOperations)
      .set({
        metadata: sql`coalesce(${agentOperations.metadata}, '{}'::jsonb) || ${JSON.stringify({ agentInterventionDispatch: marker })}::jsonb`,
      })
      .where(
        and(
          eq(agentOperations.id, operationId),
          this.ownership(),
          sql`${agentOperations.metadata}->'agentInterventionContinuation'->>'resolutionRequestId' = ${marker.resolutionRequestId}`,
        ),
      )
      .returning({ id: agentOperations.id });
    return Boolean(row);
  }

  /**
   * Persist the crash-recovery boundary after runtime state and serialized
   * hooks are complete, but before the first queue publish. A missing runtime
   * state with this marker is therefore ambiguous (it may already have run)
   * and must never be rebuilt from scratch.
   */
  async recordAgentInterventionPreparation(
    operationId: string,
    marker: AgentInterventionPreparationMarker,
  ): Promise<boolean> {
    const [row] = await this.db
      .update(agentOperations)
      .set({
        metadata: sql`coalesce(${agentOperations.metadata}, '{}'::jsonb) || ${JSON.stringify({ agentInterventionPreparation: marker })}::jsonb`,
      })
      .where(
        and(
          eq(agentOperations.id, operationId),
          this.ownership(),
          sql`${agentOperations.metadata}->'agentInterventionContinuation'->>'resolutionRequestId' = ${marker.resolutionRequestId}`,
        ),
      )
      .returning({ id: agentOperations.id });
    return Boolean(row);
  }

  /** Idempotently settle a running operation without rewriting an existing terminal outcome. */
  async settleRunning(
    operationId: string,
    status: 'done' | 'error' | 'interrupted',
  ): Promise<boolean> {
    const [row] = await this.db
      .update(agentOperations)
      .set({
        completedAt: new Date(),
        completionReason: status === 'interrupted' ? 'interrupted' : status,
        status,
      })
      .where(
        and(
          eq(agentOperations.id, operationId),
          eq(agentOperations.status, 'running'),
          this.ownership(),
        ),
      )
      .returning({ id: agentOperations.id });
    return Boolean(row);
  }

  /** Refresh the durable liveness lease while an operation owns an execution step. */
  async touchRunning(operationId: string): Promise<boolean> {
    const [row] = await this.db
      .update(agentOperations)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(agentOperations.id, operationId),
          eq(agentOperations.status, 'running'),
          this.ownership(),
        ),
      )
      .returning({ id: agentOperations.id });

    return Boolean(row);
  }

  /**
   * Atomically retire an operation whose liveness lease has expired. A concurrent
   * heartbeat wins by moving updatedAt past staleBefore, preventing false recovery.
   */
  async settleStaleRunning(
    operationId: string,
    staleBefore: Date,
    latestTotalCost?: number,
  ): Promise<boolean> {
    const totalCost =
      latestTotalCost !== undefined && Number.isFinite(latestTotalCost)
        ? Math.max(0, latestTotalCost)
        : undefined;
    const [row] = await this.db
      .update(agentOperations)
      .set({
        completedAt: new Date(),
        completionReason: 'lease_expired',
        status: 'abandoned',
        ...(totalCost === undefined
          ? {}
          : {
              totalCost: sql`greatest(coalesce(${agentOperations.totalCost}, 0), ${totalCost})`,
            }),
      })
      .where(
        and(
          eq(agentOperations.id, operationId),
          eq(agentOperations.status, 'running'),
          sql`${agentOperations.updatedAt} < ${staleBefore}`,
          this.ownership(),
        ),
      )
      .returning({ id: agentOperations.id });

    return Boolean(row);
  }

  /**
   * Sum the terminal usage of every child operation forked from `parentOperationId`
   * (`callSubAgent` children, isolated group members).
   *
   * A read-time SUM rather than an accumulation on the parent row, because the
   * sub-agent completion bridge is contractually re-deliverable (QStash redelivery,
   * plus the watchdog abandon path synthesizing the same call) and its safety rests
   * on every side effect being overwrite-idempotent or CAS-guarded — an `x += child`
   * is neither, and would double-count on the second delivery. Re-deriving the sum is
   * exact no matter how many times it runs, and self-heals if a child row lands late.
   *
   * Children are already terminal by the time a parent completes: `persistCompletion`
   * writes the child's row *before* dispatching its `onComplete` hooks, and the bridge
   * that unparks the parent IS one of those hooks.
   */
  async sumChildUsage(parentOperationId: string): Promise<ChildUsageRollup> {
    const [row] = await this.db
      .select({
        llmCalls: sql<string | null>`sum(${agentOperations.llmCalls})`,
        toolCalls: sql<string | null>`sum(${agentOperations.toolCalls})`,
        totalCost: sql<string | null>`sum(${agentOperations.totalCost})`,
        totalInputTokens: sql<string | null>`sum(${agentOperations.totalInputTokens})`,
        totalOutputTokens: sql<string | null>`sum(${agentOperations.totalOutputTokens})`,
        totalTokens: sql<string | null>`sum(${agentOperations.totalTokens})`,
      })
      .from(agentOperations)
      .where(and(eq(agentOperations.parentOperationId, parentOperationId), this.ownership()));

    // `sum()` over zero rows is NULL, and numeric sums come back as strings.
    const num = (value: string | null | undefined): number => {
      const parsed = Number(value ?? 0);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    return {
      llmCalls: num(row?.llmCalls),
      toolCalls: num(row?.toolCalls),
      totalCost: num(row?.totalCost),
      totalInputTokens: num(row?.totalInputTokens),
      totalOutputTokens: num(row?.totalOutputTokens),
      totalTokens: num(row?.totalTokens),
    };
  }

  async findById(operationId: string) {
    const [row] = await this.db
      .select()
      .from(agentOperations)
      .where(and(eq(agentOperations.id, operationId), this.ownership()))
      .limit(1);
    return row ?? null;
  }

  /**
   * Total USD cost of every operation bound to a task — the goal outer loop's
   * budget meter. Only root (task-bound) operations carry `taskId`, and each
   * root's `totalCost` scalar already includes its direct children's rollup
   * (see `persistCompletion`), so this sum covers verify / repair sub-runs
   * without walking parent chains. Re-derived on every call — exact regardless
   * of how many times a round settles.
   */
  async sumCostByTask(taskId: string): Promise<number> {
    const [row] = await this.db
      .select({ totalCost: sql<string | null>`sum(${agentOperations.totalCost})` })
      .from(agentOperations)
      .where(and(eq(agentOperations.taskId, taskId), this.ownership()));

    const parsed = Number(row?.totalCost ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /**
   * Per-operation cost and token totals for a set of runs, keyed by operation.
   *
   * Feeds the goal round rail's audit hover: a round's block should be able to
   * say what it actually spent, and asking per round would be one query per
   * block. Each root's `totalCost` already rolls up its direct children, so no
   * parent-chain walk is needed here either.
   */
  async findUsageByOperations(
    operationIds: string[],
  ): Promise<Map<string, { cost: number; tokens: number }>> {
    const ids = [...new Set(operationIds.filter(Boolean))];
    if (ids.length === 0) return new Map();

    const rows = await this.db
      .select({
        id: agentOperations.id,
        totalCost: agentOperations.totalCost,
        totalTokens: agentOperations.totalTokens,
      })
      .from(agentOperations)
      .where(and(inArray(agentOperations.id, ids), this.ownership()));

    return new Map(
      rows.map((row) => [
        row.id,
        { cost: Number(row.totalCost ?? 0) || 0, tokens: Number(row.totalTokens ?? 0) || 0 },
      ]),
    );
  }

  /**
   * Load an operation together with its direct child operations (`callSubAgent`
   * children / isolated group members) — the (at most) two-layer operation
   * tree. File-Work registration gathers every op in this tree so a round's
   * tool calls, including those a sub-agent produced, are scanned together.
   * Owner-scoped. The root op (`id === operationId`) is included in the result.
   */
  async listOperationTree(operationId: string) {
    return this.db
      .select()
      .from(agentOperations)
      .where(
        and(
          this.ownership(),
          or(
            eq(agentOperations.id, operationId),
            eq(agentOperations.parentOperationId, operationId),
          ),
        ),
      );
  }

  /**
   * Longest single operation (agent run) wall-clock execution time over the last
   * year, in seconds. Wall clock (`completedAt - startedAt`) is the most faithful
   * "task duration" — it spans the whole run including tool calls and waiting,
   * not just LLM compute. Returns 0 when there are no completed operations.
   */
  async getMaxDurationSeconds(): Promise<number> {
    const startDate = today().subtract(1, 'year').startOf('day').toDate();

    const [row] = await this.db
      .select({
        seconds:
          sql<number>`COALESCE(MAX(EXTRACT(EPOCH FROM (${agentOperations.completedAt} - ${agentOperations.startedAt}))), 0)`.mapWith(
            Number,
          ),
      })
      .from(agentOperations)
      .where(
        and(
          this.ownership(),
          isNotNull(agentOperations.startedAt),
          isNotNull(agentOperations.completedAt),
          gte(agentOperations.createdAt, startDate),
        ),
      );

    return row?.seconds ?? 0;
  }

  /**
   * Atomically flip a parked parent op from `waiting_for_async_tool` back to
   * `running`. Returns true only for the single winner (affected === 1) so
   * concurrent sub-op completions that lose the race no-op instead of
   * double-resuming the parent.
   */
  async tryResumeFromAsyncTool(operationId: string): Promise<boolean> {
    const rows = await this.db
      .update(agentOperations)
      .set({ status: 'running' })
      .where(
        and(
          eq(agentOperations.id, operationId),
          eq(agentOperations.userId, this.userId),
          eq(agentOperations.status, 'waiting_for_async_tool'),
        ),
      )
      .returning({ id: agentOperations.id });
    return rows.length === 1;
  }

  // ============================================
  // Verify (delivery checker)
  // ============================================
  // The verify plan snapshot + rollup status moved off this table onto
  // `verify_runs` (the session entity), addressed via `VerifyRunModel`. The
  // `verify_plan` / `verify_status` columns here are deprecated (see schema) and
  // no longer read or written through this model.
}
