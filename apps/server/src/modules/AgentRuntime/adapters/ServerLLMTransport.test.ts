import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlatformUsageSharedBudgetError } from '@/server/services/platformUsageBilling/sharedBudget';

import { ServerLLMTransport } from './ServerLLMTransport';

const mocks = vi.hoisted(() => ({
  attemptClearBuffers: vi.fn(),
  attemptExecute: vi.fn(async () => {}),
  attemptSnapshot: vi.fn(() => ({
    content: 'settled answer',
    usage: { cost: 0.0006, totalInputTokens: 100, totalOutputTokens: 50, totalTokens: 150 },
  })),
  consumeStreamUntilDone: vi.fn(async () => {}),
  createServerCallLlmAttempt: vi.fn(),
  debugLog: vi.fn(),
  endSpan: vi.fn(),
  getSharedBudget: vi.fn(),
  hashProviderInput: vi.fn(() => 'provider-input-digest'),
  initActorRuntime: vi.fn(async () => ({ chat: vi.fn() })),
  initPlatformRuntime: vi.fn(),
  recordException: vi.fn(),
  runtimeChat: vi.fn(),
  setSpanAttributes: vi.fn(),
  setSpanStatus: vi.fn(),
  runSharedBudgetStep: vi.fn(),
  startSpan: vi.fn(),
}));

vi.mock('@lobechat/observability-otel/api', () => ({
  context: { active: vi.fn(() => ({})), with: vi.fn((_ctx, task) => task()) },
  SpanKind: { CLIENT: 2 },
  SpanStatusCode: { ERROR: 2 },
  trace: { setSpan: vi.fn(() => ({})) },
}));
vi.mock('@lobechat/observability-otel/modules/agent-runtime', () => ({
  buildChatRequestAttributes: vi.fn((input) => input),
  buildChatResponseAttributes: vi.fn((input) => input),
  chatSpanName: vi.fn((model) => `chat ${model}`),
  tracer: { startSpan: mocks.startSpan },
}));
vi.mock('../executorHelpers', async (importOriginal) => ({
  ...(await importOriginal()),
  log: mocks.debugLog,
}));

vi.mock('@lobechat/model-runtime', async (importOriginal) => ({
  ...(await importOriginal()),
  consumeStreamUntilDone: mocks.consumeStreamUntilDone,
}));
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: mocks.initActorRuntime,
}));
vi.mock('@/server/services/platformAiRuntime', () => ({
  PlatformAiRuntime: vi.fn().mockImplementation(() => ({ init: mocks.initPlatformRuntime })),
}));
vi.mock('@/server/services/platformUsageBilling/sharedBudget', () => ({
  getPlatformUsageSharedBudgetForOperation: mocks.getSharedBudget,
  hashPlatformUsageProviderInput: mocks.hashProviderInput,
  PlatformUsageSharedBudgetError: class extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
  runPlatformUsageSharedBudgetStep: mocks.runSharedBudgetStep,
}));
vi.mock('./serverCallLlmAttempt', () => ({
  createServerCallLlmAttempt: mocks.createServerCallLlmAttempt,
}));

const attemptInput = {
  attempt: 1,
  context: {
    messages: [{ content: 'hello', role: 'user' }],
    resolvedTools: { tools: [] },
  },
  events: [],
  maxAttempts: 2,
  model: 'deepseek-chat',
  provider: 'deepseek',
  state: { metadata: {} },
} as any;

describe('ServerLLMTransport retry budget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSharedBudget.mockReturnValue(undefined);
    mocks.attemptExecute.mockResolvedValue(undefined);
    mocks.attemptSnapshot.mockReturnValue({
      content: 'settled answer',
      usage: { cost: 0.0006, totalInputTokens: 100, totalOutputTokens: 50, totalTokens: 150 },
    });
    mocks.createServerCallLlmAttempt.mockReturnValue({
      clearBuffers: mocks.attemptClearBuffers,
      execute: mocks.attemptExecute,
      snapshot: mocks.attemptSnapshot,
    });
    mocks.runtimeChat.mockImplementation(async (_payload, options) => {
      await options.callback.onText('compressed answer');
      await options.callback.onCompletion({
        usage: { cost: 0.0002, totalInputTokens: 20, totalOutputTokens: 5, totalTokens: 25 },
      });
      return {};
    });
    mocks.initPlatformRuntime.mockResolvedValue({ chat: mocks.runtimeChat });
    mocks.runSharedBudgetStep.mockImplementation(async (_budget, input) => {
      const completion = await input.providerCall();
      return completion.output;
    });
    mocks.startSpan.mockReturnValue({
      end: mocks.endSpan,
      recordException: mocks.recordException,
      setAttributes: mocks.setSpanAttributes,
      setStatus: mocks.setSpanStatus,
    });
  });

  it('does not serialize provider errors or internal routing identifiers to logs or traces', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sensitiveError = Object.assign(
      new Error('provider failed for passenger@example.com sk-private-provider-key'),
      {
        request: { body: { prompt: 'private passenger prompt' }, headers: { authorization: 'x' } },
        response: { body: 'private provider response' },
      },
    );
    const transport = new ServerLLMTransport({
      operationId: 'operation-private',
      stepIndex: 7,
    } as any);

    transport.retryPolicy.onError?.({ error: sensitiveError } as any);
    const trace = transport.createTrace({
      assistantMessageId: 'assistant-private',
      conversationId: 'conversation-private',
      model: 'model-private',
      provider: 'provider-private',
    } as any);
    await trace.recordResult?.({
      finishReason: 'private-provider-finish-reason',
      usage: {
        cost: 42,
        details: { apiKey: 'sk-private-usage-details' },
        totalInputTokens: 100,
        totalOutputTokens: 50,
      },
    } as any);
    trace.close(sensitiveError);

    const telemetry = JSON.stringify({
      console: consoleError.mock.calls,
      debug: mocks.debugLog.mock.calls,
      exception: mocks.recordException.mock.calls,
      span: mocks.startSpan.mock.calls,
      status: mocks.setSpanStatus.mock.calls,
    });
    expect(telemetry).not.toMatch(
      /passenger@example|sk-private|private passenger prompt|private provider response|authorization|private-provider-finish-reason|details|cost/,
    );
    expect(telemetry).not.toMatch(
      /operation-private|assistant-private|conversation-private|model-private|provider-private/,
    );
    expect(mocks.recordException).not.toHaveBeenCalled();
    expect(mocks.startSpan).toHaveBeenCalledWith('agent_runtime.call_llm', {
      attributes: { stepIndex: 7 },
      kind: 2,
    });
    consoleError.mockRestore();
  });

  it('keeps ordinary background failures bounded while reserving the network-empty ceiling', () => {
    const transport = new ServerLLMTransport({} as any);
    const ordinaryError = new Error('provider failed');

    expect(transport.retryPolicy.maxAttempts('qwen')).toBe(4);
    expect(transport.retryPolicy.maxAttempts('chatgpt')).toBe(4);
    expect(transport.retryPolicy.maxAttempts('lobehub')).toBe(4);
    expect(transport.retryPolicy.resolveRetryBudget('qwen', ordinaryError)).toBe(1);
    expect(transport.retryPolicy.resolveRetryBudget('chatgpt', ordinaryError)).toBe(1);
    expect(transport.retryPolicy.resolveRetryBudget('lobehub', ordinaryError)).toBe(0);
  });

  it('does not retry a provider call whose completed output failed Credits settlement', () => {
    const transport = new ServerLLMTransport({} as any);
    const error = new PlatformUsageSharedBudgetError(
      'SETTLEMENT_FAILED',
      'Platform-managed billing settlement failed',
    );

    expect(transport.retryPolicy.classifyError(error)).toMatchObject({
      code: 'SETTLEMENT_FAILED',
      kind: 'stop',
    });
  });

  it('keeps ordinary agents on the actor-owned runtime', async () => {
    const transport = new ServerLLMTransport({
      agentConfig: { agencyConfig: { modelRuntimeMode: 'actor' } },
      serverDB: {},
      userId: 'customer',
      workspaceId: 'workspace-1',
    } as any);

    await (transport as any).createModelRuntime('deepseek');

    expect(mocks.initActorRuntime).toHaveBeenCalledWith({}, 'customer', 'deepseek', 'workspace-1');
    expect(mocks.initPlatformRuntime).not.toHaveBeenCalled();
  });

  it('fails closed before initializing a runtime when a platform-managed budget is missing', () => {
    const transport = new ServerLLMTransport({
      agentConfig: { agencyConfig: { modelRuntimeMode: 'platform-managed' } },
      operationId: 'operation-without-budget',
      serverDB: {},
      userId: 'customer',
      workspaceId: 'workspace-1',
    } as any);

    expect(() => (transport as any).createModelRuntime('deepseek')).toThrowError(
      expect.objectContaining({
        code: 'INVALID_BUDGET_CONTEXT',
      }),
    );

    expect(mocks.initActorRuntime).not.toHaveBeenCalled();
    expect(mocks.initPlatformRuntime).not.toHaveBeenCalled();
  });

  it('uses the server-derived billing actor for a sponsored platform runtime', async () => {
    const sharedBudget = {};
    mocks.getSharedBudget.mockReturnValue(sharedBudget);
    const transport = new ServerLLMTransport({
      agentConfig: { agencyConfig: { modelRuntimeMode: 'platform-managed' } },
      billingActorUserId: 'invited-member',
      operationId: 'sponsored-operation',
      resourceOwnerUserId: 'group-owner',
      serverDB: {},
      userId: 'group-owner',
    } as any);

    await (transport as any).createModelRuntime('deepseek');

    expect(mocks.getSharedBudget).toHaveBeenCalledWith('sponsored-operation', {
      actorUserId: 'invited-member',
      workspaceId: undefined,
    });
    expect(mocks.initPlatformRuntime).toHaveBeenCalledWith({
      actorUserId: 'invited-member',
      provider: 'deepseek',
      workspaceId: undefined,
    });
    expect(mocks.initActorRuntime).not.toHaveBeenCalled();
  });

  it('fails a platform-managed attempt before initializing a runtime when its budget is missing', async () => {
    const transport = new ServerLLMTransport({
      agentConfig: { agencyConfig: { modelRuntimeMode: 'platform-managed' } },
      operationId: 'operation-without-budget',
      serverDB: {},
      stepIndex: 1,
      userId: 'customer',
      workspaceId: 'workspace-1',
    } as any);

    await expect(transport.runAttempt(attemptInput)).rejects.toMatchObject({
      code: 'INVALID_BUDGET_CONTEXT',
    });

    expect(mocks.initActorRuntime).not.toHaveBeenCalled();
    expect(mocks.initPlatformRuntime).not.toHaveBeenCalled();
    expect(mocks.createServerCallLlmAttempt).not.toHaveBeenCalled();
    expect(mocks.attemptExecute).not.toHaveBeenCalled();
    expect(mocks.runSharedBudgetStep).not.toHaveBeenCalled();
  });

  it('fails a platform-managed compression before initializing a runtime when its budget is missing', async () => {
    const transport = new ServerLLMTransport({
      agentConfig: { agencyConfig: { modelRuntimeMode: 'platform-managed' } },
      operationId: 'operation-without-budget',
      serverDB: {},
      stepIndex: 1,
      userId: 'customer',
      workspaceId: 'workspace-1',
    } as any);

    await expect(
      transport.stream({ messages: [], model: 'deepseek-chat', provider: 'deepseek' }),
    ).rejects.toMatchObject({ code: 'INVALID_BUDGET_CONTEXT' });

    expect(mocks.initActorRuntime).not.toHaveBeenCalled();
    expect(mocks.initPlatformRuntime).not.toHaveBeenCalled();
    expect(mocks.runtimeChat).not.toHaveBeenCalled();
    expect(mocks.runSharedBudgetStep).not.toHaveBeenCalled();
  });

  it('uses platform credentials for a server-authorized travel agent without changing the actor', async () => {
    mocks.getSharedBudget.mockReturnValue({});
    const transport = new ServerLLMTransport({
      agentConfig: { agencyConfig: { modelRuntimeMode: 'platform-managed' } },
      operationId: 'operation-1',
      serverDB: {},
      userId: 'customer',
      workspaceId: 'workspace-1',
    } as any);

    await (transport as any).createModelRuntime('deepseek');

    expect(mocks.getSharedBudget).toHaveBeenCalledWith('operation-1', {
      actorUserId: 'customer',
      workspaceId: 'workspace-1',
    });
    expect(mocks.initPlatformRuntime).toHaveBeenCalledWith({
      actorUserId: 'customer',
      provider: 'deepseek',
      workspaceId: 'workspace-1',
    });
    expect(mocks.initActorRuntime).not.toHaveBeenCalled();
  });

  it('checks Credits before the provider attempt and settles its authoritative usage afterward', async () => {
    mocks.getSharedBudget.mockReturnValue({});
    const transport = new ServerLLMTransport({
      agentConfig: { agencyConfig: { modelRuntimeMode: 'platform-managed' } },
      operationId: 'operation-1',
      serverDB: {},
      stepIndex: 3,
      userId: 'customer',
      workspaceId: 'workspace-1',
    } as any);

    await expect(transport.runAttempt(attemptInput)).resolves.toMatchObject({ ok: true });

    expect(mocks.runSharedBudgetStep).toHaveBeenCalledWith(
      {},
      {
        actorUserId: 'customer',
        inputHash: 'provider-input-digest',
        kind: 'call_llm',
        model: 'deepseek-chat',
        operationId: 'operation-1',
        provider: 'deepseek',
        stepIndex: 3,
        providerCall: expect.any(Function),
        workspaceId: 'workspace-1',
      },
    );
    expect(mocks.runSharedBudgetStep.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.attemptExecute.mock.invocationCallOrder[0]!,
    );
  });

  it('does not call the provider when the Credits preflight fails', async () => {
    const balanceError = new Error('Platform-managed billing requires positive Credits');
    mocks.getSharedBudget.mockReturnValue({});
    mocks.runSharedBudgetStep.mockRejectedValue(balanceError);
    const transport = new ServerLLMTransport({
      agentConfig: { agencyConfig: { modelRuntimeMode: 'platform-managed' } },
      operationId: 'operation-1',
      serverDB: {},
      stepIndex: 1,
      userId: 'customer',
    } as any);

    await expect(transport.runAttempt(attemptInput)).resolves.toMatchObject({
      error: balanceError,
      ok: false,
    });
    expect(mocks.attemptExecute).not.toHaveBeenCalled();
    expect(mocks.runSharedBudgetStep).toHaveBeenCalledOnce();
  });

  it('fails the completed attempt closed when post-call settlement fails', async () => {
    const settlementError = new Error('Platform-managed billing settlement failed');
    mocks.getSharedBudget.mockReturnValue({});
    mocks.runSharedBudgetStep.mockImplementation(async (_budget, input) => {
      await input.providerCall();
      throw settlementError;
    });
    const transport = new ServerLLMTransport({
      agentConfig: { agencyConfig: { modelRuntimeMode: 'platform-managed' } },
      operationId: 'operation-1',
      serverDB: {},
      stepIndex: 1,
      userId: 'customer',
    } as any);

    await expect(transport.runAttempt(attemptInput)).resolves.toMatchObject({
      error: settlementError,
      ok: false,
    });
    expect(mocks.attemptExecute).toHaveBeenCalledOnce();
    expect(mocks.attemptClearBuffers).toHaveBeenCalledOnce();
  });

  it('does not add Credits checks or settlement to ordinary actor-owned calls', async () => {
    const transport = new ServerLLMTransport({
      agentConfig: { agencyConfig: { modelRuntimeMode: 'actor' } },
      operationId: 'operation-1',
      serverDB: {},
      stepIndex: 1,
      userId: 'customer',
    } as any);

    await expect(transport.runAttempt(attemptInput)).resolves.toMatchObject({ ok: true });
    expect(mocks.attemptExecute).toHaveBeenCalledOnce();
    expect(mocks.runSharedBudgetStep).not.toHaveBeenCalled();
  });

  it('gates and settles a platform-managed compression text step', async () => {
    mocks.getSharedBudget.mockReturnValue({});
    const transport = new ServerLLMTransport({
      agentConfig: { agencyConfig: { modelRuntimeMode: 'platform-managed' } },
      operationId: 'operation-1',
      serverDB: {},
      stepIndex: 4,
      userId: 'customer',
      workspaceId: 'workspace-1',
    } as any);

    await expect(
      transport.stream({
        messages: [{ content: 'compress me', role: 'user' }],
        model: 'deepseek-chat',
        provider: 'deepseek',
      }),
    ).resolves.toMatchObject({
      content: 'compressed answer',
      usage: { cost: 0.0002, totalInputTokens: 20, totalOutputTokens: 5, totalTokens: 25 },
    });
    expect(mocks.runSharedBudgetStep).toHaveBeenCalledWith(
      {},
      {
        actorUserId: 'customer',
        inputHash: 'provider-input-digest',
        kind: 'compress_context',
        model: 'deepseek-chat',
        operationId: 'operation-1',
        provider: 'deepseek',
        stepIndex: 4,
        providerCall: expect.any(Function),
        workspaceId: 'workspace-1',
      },
    );
    expect(mocks.runSharedBudgetStep.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.runtimeChat.mock.invocationCallOrder[0]!,
    );
  });

  it('does not call the compression provider when the Credits preflight fails', async () => {
    mocks.getSharedBudget.mockReturnValue({});
    mocks.runSharedBudgetStep.mockRejectedValue(
      new Error('Platform-managed billing requires positive Credits'),
    );
    const transport = new ServerLLMTransport({
      agentConfig: { agencyConfig: { modelRuntimeMode: 'platform-managed' } },
      operationId: 'operation-1',
      serverDB: {},
      stepIndex: 4,
      userId: 'customer',
    } as any);

    await expect(
      transport.stream({ messages: [], model: 'deepseek-chat', provider: 'deepseek' }),
    ).rejects.toThrow('positive Credits');
    expect(mocks.runtimeChat).not.toHaveBeenCalled();
    expect(mocks.runSharedBudgetStep).toHaveBeenCalledOnce();
  });
});
