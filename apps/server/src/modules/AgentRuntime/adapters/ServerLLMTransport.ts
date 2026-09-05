import type {
  BlobStore,
  LLMAttemptExecution,
  LLMAttemptInput,
  LLMAttemptOutput,
  LLMCallErrorInput,
  LLMRetryInput,
  LLMRetryPolicy,
  LLMStreamPayload,
  LLMStreamResult,
  LLMTrace,
  LLMTraceInput,
  LLMTransport,
} from '@lobechat/agent-runtime';
import { resolveLLMMaxAttempts, resolveLLMRetryBudget } from '@lobechat/agent-runtime';
import { BRANDING_PROVIDER } from '@lobechat/business-const';
import {
  type ChatStreamPayload,
  consumeStreamUntilDone,
  ModelEmptyError,
  type ModelRuntime,
} from '@lobechat/model-runtime';
import {
  context as otelContext,
  SpanKind,
  SpanStatusCode,
  trace as otelTrace,
} from '@lobechat/observability-otel/api';
import {
  buildChatResponseAttributes,
  tracer as agentRuntimeTracer,
} from '@lobechat/observability-otel/modules/agent-runtime';
import { toAgentShareVisitorIds } from '@lobechat/types';

import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { PlatformAiRuntime } from '@/server/services/platformAiRuntime';
import {
  getPlatformUsageSharedBudgetForOperation,
  hashPlatformUsageProviderInput,
  PlatformUsageSharedBudgetError,
  runPlatformUsageSharedBudgetStep,
} from '@/server/services/platformUsageBilling/sharedBudget';

import type { RuntimeExecutorContext } from '../context';
import { log, sleep } from '../executorHelpers';
import { classifyLLMError } from '../llmErrorClassification';
import { createServerCallLlmAttempt } from './serverCallLlmAttempt';

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return JSON.stringify(error);
};

const SERVER_LLM_RETRY_POLICY = {
  // Server-side sub-agents run without an interactive cancel path. Keep their
  // retry budget bounded so provider failures cannot leave a group topic in a
  // long-lived `running` state. The provider SDK already handles transport
  // concerns; the runtime gets one controlled retry for transient failures.
  maxRetries: 1,
  noRetryProviders: [BRANDING_PROVIDER],
};

const NETWORK_EMPTY_COMPLETION_MAX_RETRIES = 3;
const NETWORK_EMPTY_COMPLETION_MAX_ATTEMPTS = NETWORK_EMPTY_COMPLETION_MAX_RETRIES + 1;

/**
 * A stream that died on the transport before the model produced anything: no
 * content, no reasoning, no image, no tool call and — decisively — neither cost
 * nor output tokens, so the attempt billed nothing.
 *
 * `ModelEmptyCompletion` is non-retryable by spec precisely because "a retry is
 * a new, potentially billable provider request". That reasoning is what these
 * diagnostics rule out, which is why this narrow shape may retry while every
 * other empty completion still surfaces immediately.
 *
 * Deliberately provider-independent: the zero-output, zero-cost diagnostics
 * carry the whole safety argument on their own. A BYOK stream dropping
 * mid-flight is the same failure, and nothing about a first-party route makes
 * an unbilled network drop more retryable than a third-party one.
 */
const isRetryableNetworkEmptyCompletion = (error: unknown) => {
  if (!(error instanceof ModelEmptyError)) return false;

  const diagnostics = error.diagnostics;
  return (
    diagnostics?.finishReason === 'network_error' &&
    diagnostics.contentLength === 0 &&
    diagnostics.reasoningLength === 0 &&
    diagnostics.imageCount === 0 &&
    diagnostics.toolCallCount === 0 &&
    diagnostics.cost === undefined &&
    diagnostics.outputTokens === undefined
  );
};

class ServerLLMRetryPolicy implements LLMRetryPolicy {
  constructor(private readonly ctx: RuntimeExecutorContext) {}

  classifyError(error: unknown) {
    // The provider call may already have completed when authoritative usage
    // settlement fails. Retrying would spend at the provider a second time and
    // cannot repair the original ledger failure, so stop this runtime step.
    if (error instanceof PlatformUsageSharedBudgetError) {
      return { code: error.code, kind: 'stop' as const, message: error.message };
    }
    const classified = classifyLLMError(error);
    return isRetryableNetworkEmptyCompletion(error)
      ? { ...classified, kind: 'retry' as const }
      : classified;
  }

  /**
   * The executor fixes the attempt ceiling before any error exists, so it has to
   * leave room for the error-driven network-empty budget below. Providers that
   * already allow more keep their own ceiling; only a no-retry provider is
   * lifted, and `resolveRetryBudget` still refuses every other error of theirs
   * at the first attempt.
   */
  maxAttempts(provider: string) {
    return Math.max(
      resolveLLMMaxAttempts(provider, SERVER_LLM_RETRY_POLICY),
      NETWORK_EMPTY_COMPLETION_MAX_ATTEMPTS,
    );
  }

  onError(_input: LLMCallErrorInput) {
    console.error('[StreamingLLMExecutor] LLM execution failed', {
      errorKind: 'runtime-error',
      stepIndex: this.ctx.stepIndex,
    });
  }

  onRetry({ attempt, delayMs, error, maxAttempts }: LLMRetryInput) {
    log(
      '[call_llm] failed with kind=%s at step %d (attempt %d/%d), retrying in %dms ...',
      error.kind,
      this.ctx.stepIndex,
      attempt,
      maxAttempts,
      delayMs,
    );
  }

  resolveRetryBudget(provider: string, error: unknown) {
    if (isRetryableNetworkEmptyCompletion(error)) return NETWORK_EMPTY_COMPLETION_MAX_RETRIES;
    return resolveLLMRetryBudget(provider, SERVER_LLM_RETRY_POLICY);
  }

  async waitForRetry(delayMs: number): Promise<void> {
    await sleep(delayMs);
  }
}

class ServerLLMTrace implements LLMTrace {
  private readonly chatContext: ReturnType<typeof otelTrace.setSpan>;
  private readonly chatSpan: ReturnType<typeof agentRuntimeTracer.startSpan>;
  private firstChunkAt?: number;
  private readonly llmStartTime = Date.now();

  constructor(
    private readonly ctx: RuntimeExecutorContext,
    _input: LLMTraceInput,
  ) {
    log('[call_llm] starting at step %d', ctx.stepIndex);

    this.chatSpan = agentRuntimeTracer.startSpan('agent_runtime.call_llm', {
      attributes: {
        stepIndex: ctx.stepIndex,
      },
      kind: SpanKind.CLIENT,
    });
    this.chatContext = otelTrace.setSpan(otelContext.active(), this.chatSpan);
  }

  close(error?: unknown) {
    if (error) {
      this.chatSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: 'runtime-error',
      });
    }
    this.chatSpan.end();
  }

  onFirstChunk() {
    if (this.firstChunkAt === undefined) {
      this.firstChunkAt = Date.now() - this.llmStartTime;
    }
  }

  recordResult(output: LLMAttemptOutput) {
    return this.run(async () => {
      log('[call_llm] completed at step %d', this.ctx.stepIndex);
      this.chatSpan.setAttributes(
        buildChatResponseAttributes({
          cacheReadInputTokens: output.usage?.inputCachedTokens,
          inputTokens: output.usage?.totalInputTokens,
          outputTokens: output.usage?.totalOutputTokens,
          reasoningOutputTokens: output.usage?.outputReasoningTokens,
          timeToFirstChunkMs: this.firstChunkAt,
        }),
      );
    });
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    return otelContext.with(this.chatContext, task);
  }
}

/**
 * Server {@link LLMTransport} adapter — wraps model-runtime streaming and
 * returns the aggregated content/usage that package executors need.
 */
export class ServerLLMTransport implements LLMTransport {
  readonly retryPolicy: LLMRetryPolicy;

  private readonly modelRuntimePromises = new Map<
    string,
    ReturnType<ServerLLMTransport['createModelRuntime']>
  >();

  constructor(
    private readonly ctx: RuntimeExecutorContext,
    private readonly blobStore?: BlobStore,
  ) {
    this.retryPolicy = new ServerLLMRetryPolicy(ctx);
  }

  private getBillingActorUserId() {
    return this.ctx.billingActorUserId ?? this.ctx.userId;
  }

  createTrace(input: LLMTraceInput): LLMTrace {
    return new ServerLLMTrace(this.ctx, input);
  }

  async runAttempt(input: LLMAttemptInput): Promise<LLMAttemptExecution> {
    const modelRuntime = await this.getModelRuntime(input.provider);
    return this.runAttemptWithRuntime(input, modelRuntime);
  }

  async stream(
    payload: LLMStreamPayload,
    handlers?: Parameters<LLMTransport['stream']>[1],
  ): Promise<LLMStreamResult> {
    const runtime = await this.createModelRuntime(payload.provider);
    const { provider: _provider, ...runtimePayload } = payload;
    let content = '';
    let usage: LLMStreamResult['usage'];
    let streamError: unknown;

    const providerCall = async () => {
      const response = await runtime.chat(runtimePayload as any, {
        callback: {
          onCompletion: async (data: any) => {
            if (data.usage) usage = data.usage;
          },
          onError: async (errorData: unknown) => {
            streamError = errorData;
            handlers?.onError?.(errorData);
          },
          onText: async (text: string) => {
            content += text;
            handlers?.onText?.(text);
          },
        },
        user: this.ctx.userId,
      });
      await consumeStreamUntilDone(response);
      if (streamError) throw new Error(getErrorMessage(streamError));
      const output = { content, usage };
      return { output, usage };
    };
    const budget = this.getPlatformUsageSharedBudget();
    const result = budget
      ? await runPlatformUsageSharedBudgetStep(budget, {
          actorUserId: this.getBillingActorUserId()!,
          inputHash: hashPlatformUsageProviderInput(runtimePayload),
          kind: 'compress_context',
          model: payload.model,
          operationId: this.ctx.operationId,
          provider: payload.provider,
          providerCall,
          stepIndex: this.ctx.stepIndex,
          workspaceId: this.ctx.workspaceId,
        })
      : (await providerCall()).output;
    handlers?.onFinish?.(result);
    return result;
  }

  private createModelRuntime(provider: string) {
    if (this.isPlatformManagedExecution()) {
      this.getPlatformUsageSharedBudget();
      return new PlatformAiRuntime(this.ctx.serverDB).init({
        actorUserId: this.getBillingActorUserId()!,
        provider,
        workspaceId: this.ctx.workspaceId,
      });
    }

    return initModelRuntimeFromDB(
      this.ctx.serverDB,
      this.ctx.userId!,
      provider,
      this.ctx.workspaceId,
    );
  }

  private getPlatformUsageSharedBudget() {
    if (this.ctx.agentConfig?.agencyConfig?.modelRuntimeMode !== 'platform-managed') return;
    const actorUserId = this.getBillingActorUserId();
    if (!actorUserId) {
      throw new PlatformUsageSharedBudgetError(
        'INVALID_BUDGET_CONTEXT',
        'Platform-managed execution requires a valid shared budget context.',
      );
    }
    const budget = getPlatformUsageSharedBudgetForOperation(this.ctx.operationId, {
      actorUserId,
      workspaceId: this.ctx.workspaceId,
    });
    if (!budget) {
      throw new PlatformUsageSharedBudgetError(
        'INVALID_BUDGET_CONTEXT',
        'Platform-managed execution requires a valid shared budget context.',
      );
    }
    return budget;
  }

  private isPlatformManagedExecution() {
    return this.ctx.agentConfig?.agencyConfig?.modelRuntimeMode === 'platform-managed';
  }

  private getModelRuntime(provider: string) {
    let promise = this.modelRuntimePromises.get(provider);
    if (!promise) {
      promise = this.createModelRuntime(provider);
      this.modelRuntimePromises.set(provider, promise);
    }
    return promise;
  }

  private async runAttemptWithRuntime(
    input: LLMAttemptInput,
    modelRuntime: Pick<ModelRuntime, 'chat'>,
  ): Promise<LLMAttemptExecution> {
    const resolved = input.context.resolvedTools;
    if (!resolved) throw new Error('Resolved tools are required for a server LLM attempt');

    const tools = resolved.tools.length > 0 ? resolved.tools : undefined;
    const chatPayload = {
      messages: input.context.messages as ChatStreamPayload['messages'],
      model: input.model,
      stream: this.ctx.stream ?? true,
      tools,
      ...(input.context.modelParameters as Partial<ChatStreamPayload>),
      ...(typeof input.context.preserveThinking === 'boolean' && {
        preserveThinking: input.context.preserveThinking,
      }),
    };
    const operationLogId = `${this.ctx.operationId}:${this.ctx.stepIndex}`;
    const attempt = createServerCallLlmAttempt({
      attempt: input.attempt,
      blobStore: this.blobStore,
      chatPayload,
      ctx: this.ctx,
      events: input.events,
      maxAttempts: input.maxAttempts,
      messageCount: chatPayload.messages.length,
      model: input.model,
      modelRuntime,
      onFirstChunk: input.onFirstChunk ?? (() => {}),
      operationLogId,
      provider: input.provider,
      resolved,
      // Carry the originating request's client IP / user agent from the run's
      // state.metadata into the attempt so the LLM-call metadata can surface them
      // for auditing and spend attribution.
      clientIp: input.state.metadata?.clientIp,
      // Projected, not spread: `state.metadata.agentShareVisitor` also carries
      // the run's tool/memory restrictions, which have no place in billing
      // metadata. Only the three attribution ids travel.
      agentShareVisitorIds: input.state.metadata?.agentShareVisitor
        ? toAgentShareVisitorIds(input.state.metadata.agentShareVisitor)
        : undefined,
      topicId: input.state.metadata?.topicId,
      trigger: input.state.metadata?.trigger,
      userAgent: input.state.metadata?.userAgent,
    });

    try {
      const providerCall = async () => {
        await attempt.execute();
        const output = attempt.snapshot();
        return { output, usage: output.usage };
      };
      const budget = this.getPlatformUsageSharedBudget();
      const output = budget
        ? await runPlatformUsageSharedBudgetStep(budget, {
            actorUserId: this.getBillingActorUserId()!,
            inputHash: hashPlatformUsageProviderInput(chatPayload),
            kind: 'call_llm',
            model: input.model,
            operationId: this.ctx.operationId,
            provider: input.provider,
            providerCall,
            stepIndex: this.ctx.stepIndex,
            workspaceId: this.ctx.workspaceId,
          })
        : (await providerCall()).output;
      return { ok: true, output };
    } catch (error) {
      attempt.clearBuffers();
      return { error, ok: false, output: attempt.snapshot() };
    }
  }
}
