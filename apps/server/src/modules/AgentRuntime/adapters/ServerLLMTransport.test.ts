import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlatformUsageSharedBudgetError } from '@/server/services/platformUsageBilling/sharedBudget';

import { ServerLLMTransport } from './ServerLLMTransport';

const mocks = vi.hoisted(() => ({
  attemptClearBuffers: vi.fn(),
  attemptExecute: vi.fn(async function () {}),
  attemptSnapshot: vi.fn(function () {
    return {
      content: 'settled answer',
      usage: { cost: 0.0006, totalInputTokens: 100, totalOutputTokens: 50, totalTokens: 150 },
    };
  }),
  consumeStreamUntilDone: vi.fn(async function () {}),
  createServerCallLlmAttempt: vi.fn(),
  debugLog: vi.fn(),
  endSpan: vi.fn(),
  getSharedBudget: vi.fn(),
  getSharedBudgetLimit: vi.fn(),
  hashProviderInput: vi.fn(function () {
    return 'provider-input-digest';
  }),
  initActorRuntime: vi.fn(async function () {
    return { chat: vi.fn() };
  }),
  initPlatformRuntime: vi.fn(),
  prepareChatBounded: vi.fn(),
  recordException: vi.fn(),
  runtimeChat: vi.fn(),
  setSpanAttributes: vi.fn(),
  setSpanStatus: vi.fn(),
  runSharedBudgetStep: vi.fn(),
  startSpan: vi.fn(),
}));

vi.mock('@lobechat/observability-otel/api', () => ({
  context: {
    active: vi.fn(function () {
      return {};
    }),
    with: vi.fn(function (_ctx, task) {
      return task();
    }),
  },
  SpanKind: { CLIENT: 2 },
  SpanStatusCode: { ERROR: 2 },
  trace: {
    setSpan: vi.fn(function () {
      return {};
    }),
  },
}));
vi.mock('@lobechat/observability-otel/modules/agent-runtime', () => ({
  buildChatRequestAttributes: vi.fn(function (input) {
    return input;
  }),
  buildChatResponseAttributes: vi.fn(function (input) {
    return input;
  }),
  chatSpanName: vi.fn(function (model) {
    return `chat ${model}`;
  }),
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
  PlatformAiRuntime: vi.fn().mockImplementation(function () {
    return {
      init: mocks.initPlatformRuntime,
      prepareChatBounded: mocks.prepareChatBounded,
    };
  }),
}));
vi.mock('@/server/services/platformUsageBilling/sharedBudget', () => ({
  getPlatformUsageSharedBudgetForOperation: mocks.getSharedBudget,
  getPlatformUsageSharedBudgetLimit: mocks.getSharedBudgetLimit,
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
  it('preserves topic affinity across compression runtime recreation', async () => {
    mocks.getSharedBudget.mockReturnValue(undefined);
    mocks.initActorRuntime.mockResolvedValue({ chat: mocks.runtimeChat });
    mocks.runtimeChat.mockResolvedValue(new Response(''));
    for (const topicId of ['topic-1', 'topic-1', 'topic-2']) {
      await new ServerLLMTransport({ topicId, userId: 'user-1' } as any).stream({
        messages: [],
        model: 'glm-5',
        provider: 'opencodecodingplan',
      });
    }
    expect(mocks.runtimeChat.mock.calls.map(([, options]) => options.metadata.topicId)).toEqual([
      'topic-1',
      'topic-1',
      'topic-2',
    ]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSharedBudget.mockReturnValue(undefined);
    mocks.getSharedBudgetLimit.mockReturnValue(1000);
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
    mocks.runtimeChat.mockImplementation(async function (_payload, options) {
      await options.callback.onText('compressed answer');
      await options.callback.onCompletion({
        usage: { cost: 0.0002, totalInputTokens: 20, totalOutputTokens: 5, totalTokens: 25 },
      });
      return {};
    });
    mocks.initPlatformRuntime.mockResolvedValue({ chat: mocks.runtimeChat });
    mocks.prepareChatBounded.mockResolvedValue({ chat: mocks.runtimeChat });
    mocks.runSharedBudgetStep.mockImplementation(async function (_budget, input) {
      if (input.providerCall) return (await input.providerCall()).output;
      const call = await input.prepareProviderCall({
        pricing: { pricing: {} },
        remainingCredits: 1000,
      });
      const completion = await call();
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
    const consoleError = vi.spyOn(console, 'error').mockImplementation(function () {
      return undefined;
    });
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
        prepareProviderCall: expect.any(Function),
        workspaceId: 'workspace-1',
      },
    );
    expect(mocks.runSharedBudgetStep.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.attemptExecute.mock.invocationCallOrder[0]!,
    );
  });

  it('does not create a per-call reservation when the shared execution has no explicit ceiling', async () => {
    mocks.getSharedBudget.mockReturnValue({});
    mocks.getSharedBudgetLimit.mockReturnValue(undefined);
    const transport = new ServerLLMTransport({
      agentConfig: { agencyConfig: { modelRuntimeMode: 'platform-managed' } },
      operationId: 'operation-direct-settlement',
      serverDB: {},
      stepIndex: 5,
      userId: 'customer',
      workspaceId: 'workspace-1',
    } as any);

    await expect(transport.runAttempt(attemptInput)).resolves.toMatchObject({ ok: true });

    expect(mocks.runSharedBudgetStep).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        kind: 'call_llm',
        operationId: 'operation-direct-settlement',
        providerCall: expect.any(Function),
      }),
    );
    expect(mocks.runSharedBudgetStep.mock.calls[0]?.[1]).not.toHaveProperty('prepareProviderCall');
    expect(mocks.prepareChatBounded).not.toHaveBeenCalled();
  });

  it('forwards runtime provider request identity to the claimed billing reservation', async () => {
    const recordProviderRequestId = vi.fn().mockResolvedValue(undefined);
    mocks.getSharedBudget.mockReturnValue({});
    mocks.createServerCallLlmAttempt.mockImplementation(function (input) {
      return {
        clearBuffers: mocks.attemptClearBuffers,
        execute: async () => {
          await input.onProviderRequestId?.('provider-request-transport-1');
        },
        snapshot: mocks.attemptSnapshot,
      };
    });
    mocks.runSharedBudgetStep.mockImplementation(async function (_budget, input) {
      const call = await input.prepareProviderCall({
        pricing: { pricing: {} },
        remainingCredits: 1000,
      });
      const completion = await call({ recordProviderRequestId });
      return completion.output;
    });
    const transport = new ServerLLMTransport({
      agentConfig: { agencyConfig: { modelRuntimeMode: 'platform-managed' } },
      operationId: 'operation-1',
      serverDB: {},
      stepIndex: 3,
      userId: 'customer',
      workspaceId: 'workspace-1',
    } as any);

    await expect(transport.runAttempt(attemptInput)).resolves.toMatchObject({ ok: true });

    expect(recordProviderRequestId).toHaveBeenCalledOnce();
    expect(recordProviderRequestId).toHaveBeenCalledWith('provider-request-transport-1');
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

  it('stops rather than retrying an unsupported bounded preparation', async () => {
    mocks.getSharedBudget.mockReturnValue({});
    mocks.prepareChatBounded.mockRejectedValueOnce(new Error('unsupported route'));
    const transport = new ServerLLMTransport({
      agentConfig: { agencyConfig: { modelRuntimeMode: 'platform-managed' } },
      operationId: 'operation-1',
      serverDB: {},
      stepIndex: 1,
      userId: 'customer',
    } as any);
    const result = await transport.runAttempt(attemptInput);
    expect(result).toMatchObject({ ok: false, error: { code: 'PROVIDER_LIMIT_UNPROVEN' } });
    if (!result.ok)
      expect(transport.retryPolicy.classifyError(result.error)).toMatchObject({ kind: 'stop' });
    expect(mocks.attemptExecute).not.toHaveBeenCalled();
  });

  it('fails the completed attempt closed when post-call settlement fails', async () => {
    const settlementError = new Error('Platform-managed billing settlement failed');
    mocks.getSharedBudget.mockReturnValue({});
    mocks.runSharedBudgetStep.mockImplementation(async function (_budget, input) {
      const call = await input.prepareProviderCall({
        pricing: { pricing: {} },
        remainingCredits: 1000,
      });
      await call();
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
        prepareProviderCall: expect.any(Function),
        workspaceId: 'workspace-1',
      },
    );
    expect(mocks.runSharedBudgetStep.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.runtimeChat.mock.invocationCallOrder[0]!,
    );
  });

  it('persists compression provider request identity before consuming the stream', async () => {
    const recordProviderRequestId = vi.fn().mockResolvedValue(undefined);
    mocks.getSharedBudget.mockReturnValue({});
    mocks.runtimeChat.mockImplementationOnce(async (_payload, options) => {
      Object.assign(options.diagnostics, {
        providerResponse: { requestId: 'provider-request-compression-1' },
      });
      await options.callback.onText('compressed answer');
      await options.callback.onCompletion({
        usage: { cost: 0.0002, totalInputTokens: 20, totalOutputTokens: 5, totalTokens: 25 },
      });
      return {};
    });
    mocks.runSharedBudgetStep.mockImplementationOnce(async (_budget, input) => {
      const call = await input.prepareProviderCall({
        pricing: { pricing: {} },
        remainingCredits: 1000,
      });
      const completion = await call({ recordProviderRequestId });
      return completion.output;
    });
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
    ).resolves.toMatchObject({ content: 'compressed answer' });

    expect(recordProviderRequestId).toHaveBeenCalledOnce();
    expect(recordProviderRequestId).toHaveBeenCalledWith('provider-request-compression-1');
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
