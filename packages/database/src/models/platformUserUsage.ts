import { and, desc, eq, isNotNull, or, sql } from 'drizzle-orm';

import { agentOperations, messages, travelGenerationTasks } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { NOT_COPIED_TRANSCRIPT_SQL, notCopiedTranscript } from '../utils/copiedTranscript';

export const PLATFORM_USER_USAGE_TARGET_REQUIRED = '必须提供精确的目标用户 ID';

export type PlatformUsageSource = 'agent_operation' | 'message' | 'travel_generation';

export interface AvailableNumber {
  available: boolean;
  value: number | null;
}

export interface AvailableText {
  available: boolean;
  value: string;
}

export interface PlatformUsageMetrics {
  costUsd: AvailableNumber;
  totalInputTokens: AvailableNumber;
  totalOutputTokens: AvailableNumber;
  totalTokens: AvailableNumber;
}

export interface PlatformProviderModelUsage {
  countedInCanonicalTotals: boolean;
  metrics: PlatformUsageMetrics;
  model: AvailableText;
  provider: AvailableText;
  recordCount: number;
  source: Extract<PlatformUsageSource, 'agent_operation' | 'message'>;
}

export interface PlatformGenerationTypeUsage {
  countedInCanonicalTotals: true;
  generationType: AvailableText;
  metrics: PlatformUsageMetrics;
  model: AvailableText;
  provider: AvailableText;
  recordCount: number;
  source: 'travel_generation';
}

export interface PlatformRecentUsage {
  countedInCanonicalTotals: boolean;
  createdAt: Date;
  id: string;
  kind: AvailableText;
  metrics: PlatformUsageMetrics;
  model: AvailableText;
  provider: AvailableText;
  source: PlatformUsageSource;
}

interface AggregateRow extends Record<string, unknown> {
  costCount: unknown;
  costSum: unknown;
  inputCount: unknown;
  inputSum: unknown;
  model?: unknown;
  outputCount: unknown;
  outputSum: unknown;
  provider?: unknown;
  recordCount: unknown;
  totalCount: unknown;
  totalSum: unknown;
  type?: unknown;
}

const unavailableNumber = (): AvailableNumber => ({ available: false, value: null });

const normalizeNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Number(number.toFixed(12));
};

const availableText = (value: unknown): AvailableText => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized
    ? { available: true, value: normalized }
    : { available: false, value: 'unknown' };
};

const strictMetric = (count: unknown, sum: unknown, recordCount: number): AvailableNumber => {
  const measuredCount = normalizeNumber(count);
  const value = normalizeNumber(sum);
  if (recordCount === 0 || measuredCount !== recordCount || value === null) {
    return unavailableNumber();
  }
  return { available: true, value };
};

const metricsFromAggregate = (row: AggregateRow): PlatformUsageMetrics => {
  const recordCount = normalizeNumber(row.recordCount) ?? 0;
  return {
    costUsd: strictMetric(row.costCount, row.costSum, recordCount),
    totalInputTokens: strictMetric(row.inputCount, row.inputSum, recordCount),
    totalOutputTokens: strictMetric(row.outputCount, row.outputSum, recordCount),
    totalTokens: strictMetric(row.totalCount, row.totalSum, recordCount),
  };
};

const combineMetrics = (metrics: PlatformUsageMetrics[]): PlatformUsageMetrics => {
  if (metrics.length === 0) {
    return {
      costUsd: unavailableNumber(),
      totalInputTokens: unavailableNumber(),
      totalOutputTokens: unavailableNumber(),
      totalTokens: unavailableNumber(),
    };
  }

  const combine = (field: keyof PlatformUsageMetrics): AvailableNumber => {
    const values = metrics.map((item) => item[field]);
    if (values.some((item) => !item.available || item.value === null)) return unavailableNumber();
    const total = values.reduce((sum, item) => sum + item.value!, 0);
    return { available: true, value: Number(total.toFixed(12)) };
  };

  return {
    costUsd: combine('costUsd'),
    totalInputTokens: combine('totalInputTokens'),
    totalOutputTokens: combine('totalOutputTokens'),
    totalTokens: combine('totalTokens'),
  };
};

const usageValue = (usage: unknown, key: string, legacyKey?: string): number | null => {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const source = usage as Record<string, unknown>;
  return normalizeNumber(source[key] ?? (legacyKey ? source[legacyKey] : undefined));
};

const metricsFromUsage = (usage: unknown): PlatformUsageMetrics => {
  const input = usageValue(usage, 'totalInputTokens', 'inputTokens');
  const output = usageValue(usage, 'totalOutputTokens', 'outputTokens');
  const explicitTotal = usageValue(usage, 'totalTokens');
  const total = explicitTotal ?? (input !== null && output !== null ? input + output : null);
  const cost = usageValue(usage, 'cost');
  return {
    costUsd: cost === null ? unavailableNumber() : { available: true, value: cost },
    totalInputTokens: input === null ? unavailableNumber() : { available: true, value: input },
    totalOutputTokens: output === null ? unavailableNumber() : { available: true, value: output },
    totalTokens:
      total === null ? unavailableNumber() : { available: true, value: Number(total.toFixed(12)) },
  };
};

const metricsFromOperation = (row: {
  cost: unknown;
  currency: string;
  totalCost: number | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalTokens: number | null;
}): PlatformUsageMetrics => {
  const costBlob =
    row.cost && typeof row.cost === 'object' && !Array.isArray(row.cost)
      ? (row.cost as Record<string, unknown>)
      : undefined;
  const costCurrency = typeof costBlob?.currency === 'string' ? costBlob.currency : row.currency;
  const cost = costCurrency === 'USD' ? normalizeNumber(row.totalCost ?? costBlob?.total) : null;
  const metric = (value: unknown) => {
    const normalized = normalizeNumber(value);
    return normalized === null
      ? unavailableNumber()
      : ({ available: true, value: normalized } satisfies AvailableNumber);
  };
  return {
    costUsd: cost === null ? unavailableNumber() : { available: true, value: cost },
    totalInputTokens: metric(row.totalInputTokens),
    totalOutputTokens: metric(row.totalOutputTokens),
    totalTokens: metric(row.totalTokens),
  };
};

const normalizeRecentLimit = (limit: number | undefined): number => {
  if (limit === undefined || !Number.isFinite(limit)) return 20;
  return Math.min(100, Math.max(1, Math.trunc(limit)));
};

/**
 * Reads one explicit user's persisted usage without loading prompts, messages,
 * tool parameters, artifacts, runtime credentials or provider secrets.
 *
 * Assistant messages and travel generation tasks form the canonical total.
 * Agent operation totals are returned separately because their LLM aggregates
 * overlap the assistant-message usage and summing both would double charge.
 */
export class PlatformUserUsageModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly targetUserId: string,
  ) {}

  async getUsage(input: { recentLimit?: number } = {}) {
    if (!this.targetUserId || this.targetUserId.trim() !== this.targetUserId) {
      throw new Error(PLATFORM_USER_USAGE_TARGET_REQUIRED);
    }

    const recentLimit = normalizeRecentLimit(input.recentLimit);
    const [
      messageAggregate,
      operationAggregate,
      generationAggregate,
      recentMessages,
      recentOps,
      recentGenerations,
    ] = await Promise.all([
      this.db.execute(sql`
          with source as (
            select provider, model, coalesce(usage, metadata->'usage') as usage
            from ${messages}
            where user_id = ${this.targetUserId}
              and role = 'assistant'
              and (usage is not null or metadata ? 'usage')
              and ${sql.raw(NOT_COPIED_TRANSCRIPT_SQL)}
          ), tokenized as (
            select provider, model,
              case
                when jsonb_typeof(usage->'totalInputTokens') = 'number' then (usage->>'totalInputTokens')::numeric
                when jsonb_typeof(usage->'inputTokens') = 'number' then (usage->>'inputTokens')::numeric
              end as input_tokens,
              case
                when jsonb_typeof(usage->'totalOutputTokens') = 'number' then (usage->>'totalOutputTokens')::numeric
                when jsonb_typeof(usage->'outputTokens') = 'number' then (usage->>'outputTokens')::numeric
              end as output_tokens,
              case when jsonb_typeof(usage->'totalTokens') = 'number' then (usage->>'totalTokens')::numeric end as explicit_total_tokens,
              case when jsonb_typeof(usage->'cost') = 'number' then (usage->>'cost')::numeric end as cost_usd
            from source
          ), normalized as (
            select provider, model, input_tokens, output_tokens, cost_usd,
              coalesce(explicit_total_tokens,
                case when input_tokens is not null and output_tokens is not null then input_tokens + output_tokens end
              ) as total_tokens
            from tokenized
          )
          select provider, model,
            count(*)::int as "recordCount",
            count(input_tokens)::int as "inputCount", coalesce(sum(input_tokens), 0) as "inputSum",
            count(output_tokens)::int as "outputCount", coalesce(sum(output_tokens), 0) as "outputSum",
            count(total_tokens)::int as "totalCount", coalesce(sum(total_tokens), 0) as "totalSum",
            count(cost_usd)::int as "costCount", coalesce(sum(cost_usd), 0) as "costSum"
          from normalized
          group by provider, model
          order by provider nulls last, model nulls last
        `),
      this.db.execute(sql`
          with normalized as (
            select provider, model,
              total_input_tokens as input_tokens,
              total_output_tokens as output_tokens,
              total_tokens,
              case
                when coalesce(cost->>'currency', currency) = 'USD' then coalesce(
                  total_cost,
                  case when jsonb_typeof(cost->'total') = 'number' then (cost->>'total')::numeric end
                )
              end as cost_usd
            from ${agentOperations}
            where user_id = ${this.targetUserId}
              and (
                total_input_tokens is not null or total_output_tokens is not null or total_tokens is not null
                or total_cost is not null or usage is not null or cost is not null
              )
          )
          select provider, model,
            count(*)::int as "recordCount",
            count(input_tokens)::int as "inputCount", coalesce(sum(input_tokens), 0) as "inputSum",
            count(output_tokens)::int as "outputCount", coalesce(sum(output_tokens), 0) as "outputSum",
            count(total_tokens)::int as "totalCount", coalesce(sum(total_tokens), 0) as "totalSum",
            count(cost_usd)::int as "costCount", coalesce(sum(cost_usd), 0) as "costSum"
          from normalized
          group by provider, model
          order by provider nulls last, model nulls last
        `),
      this.db.execute(sql`
          with source as (
            select type, provider, usage
            from ${travelGenerationTasks}
            where user_id = ${this.targetUserId} and usage is not null
          ), tokenized as (
            select type, provider,
              case
                when jsonb_typeof(usage->'totalInputTokens') = 'number' then (usage->>'totalInputTokens')::numeric
                when jsonb_typeof(usage->'inputTokens') = 'number' then (usage->>'inputTokens')::numeric
              end as input_tokens,
              case
                when jsonb_typeof(usage->'totalOutputTokens') = 'number' then (usage->>'totalOutputTokens')::numeric
                when jsonb_typeof(usage->'outputTokens') = 'number' then (usage->>'outputTokens')::numeric
              end as output_tokens,
              case when jsonb_typeof(usage->'totalTokens') = 'number' then (usage->>'totalTokens')::numeric end as explicit_total_tokens,
              case when jsonb_typeof(usage->'cost') = 'number' then (usage->>'cost')::numeric end as cost_usd
            from source
          ), normalized as (
            select type, provider, input_tokens, output_tokens, cost_usd,
              coalesce(explicit_total_tokens,
                case when input_tokens is not null and output_tokens is not null then input_tokens + output_tokens end
              ) as total_tokens
            from tokenized
          )
          select type, provider,
            count(*)::int as "recordCount",
            count(input_tokens)::int as "inputCount", coalesce(sum(input_tokens), 0) as "inputSum",
            count(output_tokens)::int as "outputCount", coalesce(sum(output_tokens), 0) as "outputSum",
            count(total_tokens)::int as "totalCount", coalesce(sum(total_tokens), 0) as "totalSum",
            count(cost_usd)::int as "costCount", coalesce(sum(cost_usd), 0) as "costSum"
          from normalized
          group by type, provider
          order by type, provider nulls last
        `),
      this.db
        .select({
          createdAt: messages.createdAt,
          id: messages.id,
          model: messages.model,
          provider: messages.provider,
          usage: sql<Record<
            string,
            unknown
          > | null>`coalesce(${messages.usage}, ${messages.metadata}->'usage')`,
        })
        .from(messages)
        .where(
          and(
            eq(messages.userId, this.targetUserId),
            eq(messages.role, 'assistant'),
            sql`(${messages.usage} is not null or ${messages.metadata} ? 'usage')`,
            notCopiedTranscript(),
          ),
        )
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(recentLimit),
      this.db
        .select({
          cost: agentOperations.cost,
          createdAt: agentOperations.createdAt,
          currency: agentOperations.currency,
          id: agentOperations.id,
          model: agentOperations.model,
          provider: agentOperations.provider,
          totalCost: agentOperations.totalCost,
          totalInputTokens: agentOperations.totalInputTokens,
          totalOutputTokens: agentOperations.totalOutputTokens,
          totalTokens: agentOperations.totalTokens,
          trigger: agentOperations.trigger,
        })
        .from(agentOperations)
        .where(
          and(
            eq(agentOperations.userId, this.targetUserId),
            or(
              isNotNull(agentOperations.totalInputTokens),
              isNotNull(agentOperations.totalOutputTokens),
              isNotNull(agentOperations.totalTokens),
              isNotNull(agentOperations.totalCost),
              isNotNull(agentOperations.usage),
              isNotNull(agentOperations.cost),
            ),
          ),
        )
        .orderBy(desc(agentOperations.createdAt), desc(agentOperations.id))
        .limit(recentLimit),
      this.db
        .select({
          createdAt: travelGenerationTasks.createdAt,
          id: travelGenerationTasks.id,
          provider: travelGenerationTasks.provider,
          type: travelGenerationTasks.type,
          usage: travelGenerationTasks.usage,
        })
        .from(travelGenerationTasks)
        .where(
          and(
            eq(travelGenerationTasks.userId, this.targetUserId),
            isNotNull(travelGenerationTasks.usage),
          ),
        )
        .orderBy(desc(travelGenerationTasks.createdAt), desc(travelGenerationTasks.id))
        .limit(recentLimit),
    ]);

    const messageGroups: PlatformProviderModelUsage[] = (
      messageAggregate.rows as AggregateRow[]
    ).map((row) => ({
      countedInCanonicalTotals: true,
      metrics: metricsFromAggregate(row),
      model: availableText(row.model),
      provider: availableText(row.provider),
      recordCount: normalizeNumber(row.recordCount) ?? 0,
      source: 'message',
    }));
    const operationGroups: PlatformProviderModelUsage[] = (
      operationAggregate.rows as AggregateRow[]
    ).map((row) => ({
      countedInCanonicalTotals: false,
      metrics: metricsFromAggregate(row),
      model: availableText(row.model),
      provider: availableText(row.provider),
      recordCount: normalizeNumber(row.recordCount) ?? 0,
      source: 'agent_operation',
    }));
    const generationGroups: PlatformGenerationTypeUsage[] = (
      generationAggregate.rows as AggregateRow[]
    ).map((row) => ({
      countedInCanonicalTotals: true,
      generationType: availableText(row.type),
      metrics: metricsFromAggregate(row),
      model: { available: false, value: 'unknown' },
      provider: availableText(row.provider),
      recordCount: normalizeNumber(row.recordCount) ?? 0,
      source: 'travel_generation',
    }));

    const recent: PlatformRecentUsage[] = [
      ...recentMessages.map((row) => ({
        countedInCanonicalTotals: true,
        createdAt: row.createdAt,
        id: row.id,
        kind: { available: true, value: 'chat' },
        metrics: metricsFromUsage(row.usage),
        model: availableText(row.model),
        provider: availableText(row.provider),
        source: 'message' as const,
      })),
      ...recentOps.map((row) => ({
        countedInCanonicalTotals: false,
        createdAt: row.createdAt,
        id: row.id,
        kind: availableText(row.trigger),
        metrics: metricsFromOperation(row),
        model: availableText(row.model),
        provider: availableText(row.provider),
        source: 'agent_operation' as const,
      })),
      ...recentGenerations.map((row) => ({
        countedInCanonicalTotals: true,
        createdAt: row.createdAt,
        id: row.id,
        kind: availableText(row.type),
        metrics: metricsFromUsage(row.usage),
        model: { available: false, value: 'unknown' },
        provider: availableText(row.provider),
        source: 'travel_generation' as const,
      })),
    ]
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id),
      )
      .slice(0, recentLimit);

    return {
      byGenerationType: generationGroups,
      byProviderModel: [...messageGroups, ...operationGroups],
      canonicalTotals: combineMetrics([
        ...messageGroups.map(({ metrics }) => metrics),
        ...generationGroups.map(({ metrics }) => metrics),
      ]),
      operationReportedTotals: combineMetrics(operationGroups.map(({ metrics }) => metrics)),
      recent,
      userId: this.targetUserId,
    };
  }
}
