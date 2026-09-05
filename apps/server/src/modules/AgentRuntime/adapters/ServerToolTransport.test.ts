import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPlatformManagedExecutionContext } from '@/server/services/aiAgent/platformManagedExecution';

import { ServerToolTransport } from './ServerToolTransport';

const mocks = vi.hoisted(() => ({
  debugLog: vi.fn(),
  endSpan: vi.fn(),
  executeTool: vi.fn(),
  getAgentVisibility: vi.fn(),
  getSharedBudget: vi.fn(),
  registerWork: vi.fn(),
  recordException: vi.fn(),
  setSpanAttributes: vi.fn(),
  setSpanStatus: vi.fn(),
  startSpan: vi.fn(),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
    getAgentVisibility: mocks.getAgentVisibility,
  })),
}));
vi.mock('@/server/services/platformUsageBilling/sharedBudget', () => ({
  getPlatformUsageSharedBudgetForOperation: mocks.getSharedBudget,
}));

vi.mock('../executorHelpers', async (importOriginal) => ({
  ...(await importOriginal()),
  archiveRuntimeToolResult: vi.fn(async (result) => result),
  log: mocks.debugLog,
  registerWorkFromIntent: mocks.registerWork,
}));

vi.mock('@lobechat/observability-otel/modules/agent-runtime', async (importOriginal) => ({
  ...(await importOriginal()),
  tracer: { startSpan: mocks.startSpan },
}));

describe('ServerToolTransport logging privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSharedBudget.mockReturnValue(undefined);
    mocks.startSpan.mockReturnValue({
      end: mocks.endSpan,
      recordException: mocks.recordException,
      setAttributes: mocks.setSpanAttributes,
      setStatus: mocks.setSpanStatus,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not serialize tool arguments, caller identity, operation identity, or raw errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const sensitiveError = Object.assign(
      new Error('provider rejected passenger@example.com sk-private-tool-key'),
      {
        request: { body: { prompt: 'private tool request' } },
        response: { body: 'private tool response' },
      },
    );
    const transport = new ServerToolTransport({
      hookDispatcher: { dispatch },
      operationId: 'operation-private',
      stepIndex: 4,
      userId: 'user-private',
    } as any);

    await transport.handleError(
      { apiName: 'generateImage', identifier: 'lobe-travel-production' } as any,
      sensitiveError,
      {
        callIndex: 2,
        parsedArgs: {
          prompt: 'passenger@example.com sk-private-tool-key',
          userId: 'user-private',
        },
        state: { metadata: {} },
      } as any,
    );

    const serialized = JSON.stringify({
      console: consoleError.mock.calls,
      hookPayload: dispatch.mock.calls[0]?.[2],
    });
    expect(serialized).not.toMatch(
      /passenger@example|sk-private|private tool request|private tool response/,
    );
    expect(serialized).not.toMatch(/operation-private|user-private/);
    expect(dispatch.mock.calls[0]?.[2]).toEqual({
      apiName: 'generateImage',
      callIndex: 2,
      error: 'runtime-error',
      stepIndex: 4,
    });
  });

  it('does not record raw tool failures in the execution span', async () => {
    const sensitiveError = new Error(
      'provider rejected passenger@example.com sk-private-tool-key private response body',
    );
    const transport = new ServerToolTransport({
      hookDispatcher: {
        dispatch: vi.fn().mockResolvedValue(undefined),
        dispatchBeforeToolCall: vi.fn().mockRejectedValue(sensitiveError),
      },
      operationId: 'operation-private',
      stepIndex: 4,
    } as any);

    await expect(
      transport.run(
        { apiName: 'generateImage', id: 'call-private', identifier: 'tool-private' } as any,
        {
          callIndex: 2,
          state: { metadata: {} },
          toolName: 'private-tool-name',
          toolSource: 'private-tool-source',
        } as any,
      ),
    ).rejects.toBe(sensitiveError);

    expect(mocks.recordException).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.setSpanStatus.mock.calls)).not.toMatch(
      /passenger@example|sk-private|private response body/,
    );
    expect(mocks.setSpanStatus).toHaveBeenCalledWith({ code: 2, message: 'runtime-error' });
  });

  it('does not log raw database errors or runtime identities when visibility lookup fails', async () => {
    mocks.getAgentVisibility.mockRejectedValue(
      new Error('database failed for passenger@example.com sk-private-database-key'),
    );
    const transport = new ServerToolTransport({
      operationId: 'operation-private',
      serverDB: {},
      stepIndex: 6,
      userId: 'user-private',
    } as any);

    await expect(
      (transport as any).resolveAgentVisibility({
        mode: 'single',
        state: {
          metadata: { agentId: 'agent-private', workspaceId: 'workspace-private' },
        },
      }),
    ).resolves.toBeNull();

    const serialized = JSON.stringify(mocks.debugLog.mock.calls);
    expect(serialized).not.toMatch(
      /passenger@example|sk-private|operation-private|user-private|agent-private|workspace-private/,
    );
    expect(mocks.debugLog).toHaveBeenCalledWith(
      '[execute_tool] agent visibility lookup failed at step %d with kind=%s',
      6,
      'database-error',
    );
  });

  it('grants the tool context only the opaque budget bound to the current operation', async () => {
    const sharedBudget = {};
    mocks.getSharedBudget.mockReturnValue(sharedBudget);
    mocks.getAgentVisibility.mockResolvedValue('private');
    mocks.executeTool.mockResolvedValue({ content: 'done', success: true });
    const transport = new ServerToolTransport({
      operationId: 'operation-1',
      serverDB: {},
      stepIndex: 1,
      streamManager: {},
      toolExecutionService: { executeTool: mocks.executeTool },
      userId: 'user-1',
    } as any);

    await transport.run(
      {
        apiName: 'generateDocument',
        arguments: '{"prompt":"制作行程"}',
        executor: 'server',
        id: 'call-1',
        identifier: 'lobe-travel-production',
      } as any,
      {
        callIndex: 0,
        effectiveManifestMap: {},
        parentMessageId: 'assistant-1',
        parsedArgs: { prompt: '制作行程' },
        state: {
          metadata: {
            agentConfig: { agencyConfig: { modelRuntimeMode: 'platform-managed' } },
            agentId: 'document-agent',
            resourceOwnerUserId: 'forged-persisted-owner',
          },
        },
        toolMessageId: 'tool-message-1',
        toolName: 'lobe-travel-production____generateDocument',
        toolResultMaxLength: 1000,
        toolSource: 'builtin',
      } as any,
    );

    const executionContext = mocks.executeTool.mock.calls[0]?.[1];
    expect(mocks.getSharedBudget).toHaveBeenCalledWith('operation-1', {
      actorUserId: 'user-1',
      workspaceId: undefined,
    });
    expect(getPlatformManagedExecutionContext(executionContext)).toEqual({
      actorUserId: 'user-1',
      resourceOwnerUserId: 'user-1',
      sharedBudget,
    });
    expect(JSON.stringify(executionContext)).not.toContain('platform-usage-shared-budget');
  });

  it('uses the member for sponsored billing but the owner for tool resources', async () => {
    const sharedBudget = {};
    mocks.getSharedBudget.mockReturnValue(sharedBudget);
    mocks.getAgentVisibility.mockResolvedValue('private');
    mocks.executeTool.mockResolvedValue({ content: 'done', success: true });
    const transport = new ServerToolTransport({
      billingActorUserId: 'invited-member',
      operationId: 'sponsored-operation',
      resourceOwnerUserId: 'group-owner',
      serverDB: {},
      stepIndex: 1,
      streamManager: {},
      toolExecutionService: { executeTool: mocks.executeTool },
      userId: 'group-owner',
    } as any);

    await transport.run(
      {
        apiName: 'generateCopy',
        arguments: '{"prompt":"制作文案"}',
        executor: 'server',
        id: 'call-sponsored',
        identifier: 'lobe-travel-production',
      } as any,
      {
        callIndex: 0,
        effectiveManifestMap: {},
        parentMessageId: 'assistant-sponsored',
        parsedArgs: { prompt: '制作文案' },
        state: {
          metadata: {
            agentConfig: { agencyConfig: { modelRuntimeMode: 'platform-managed' } },
            agentId: 'copywriter-agent',
          },
        },
        toolMessageId: 'tool-sponsored',
        toolName: 'lobe-travel-production____generateCopy',
        toolResultMaxLength: 1000,
        toolSource: 'builtin',
      } as any,
    );

    expect(mocks.getSharedBudget).toHaveBeenCalledWith('sponsored-operation', {
      actorUserId: 'invited-member',
      workspaceId: undefined,
    });
    const executionContext = mocks.executeTool.mock.calls[0]?.[1];
    expect(executionContext).toMatchObject({
      agentId: 'copywriter-agent',
      userId: 'group-owner',
    });
    expect(getPlatformManagedExecutionContext(executionContext)).toEqual({
      actorUserId: 'invited-member',
      resourceOwnerUserId: 'group-owner',
      sharedBudget,
    });
  });

  it('registers sponsored member works under the group owner', async () => {
    const transport = new ServerToolTransport({
      billingActorUserId: 'invited-member',
      operationId: 'sponsored-operation',
      resourceOwnerUserId: 'group-owner',
      serverDB: {},
      userId: 'invited-member',
    } as any);

    await transport.registerWork(
      {
        intent: { title: '西藏旅游文案', type: 'copy' },
        sourceMessageId: 'tool-message',
        sourceToolCallId: 'tool-call',
        sourceToolIdentifier: 'lobe-travel-production',
        sourceToolName: 'generateCopy',
      } as any,
      { metadata: { agentId: 'copywriter', topicId: 'owner-topic' } } as any,
    );

    expect(mocks.registerWork).toHaveBeenCalledWith(
      expect.objectContaining({
        topicId: 'owner-topic',
        userId: 'group-owner',
      }),
    );
  });

  it('does not grant a forged persisted authorization without an in-process budget binding', async () => {
    mocks.getAgentVisibility.mockResolvedValue('private');
    mocks.executeTool.mockResolvedValue({ content: 'done', success: true });
    const transport = new ServerToolTransport({
      operationId: 'operation-2',
      serverDB: {},
      stepIndex: 1,
      streamManager: {},
      toolExecutionService: { executeTool: mocks.executeTool },
      userId: 'user-1',
    } as any);

    await transport.run(
      {
        apiName: 'generateDocument',
        arguments: '{"prompt":"制作行程"}',
        executor: 'server',
        id: 'call-2',
        identifier: 'lobe-travel-production',
      } as any,
      {
        callIndex: 0,
        effectiveManifestMap: {},
        parentMessageId: 'assistant-2',
        parsedArgs: { prompt: '制作行程' },
        state: {
          metadata: {
            agentConfig: { agencyConfig: { modelRuntimeMode: 'platform-managed' } },
            agentId: 'document-agent',
            platformManagedExecutionAuthorized: true,
            platformManagedMaxCredits: 9999,
          },
        },
        toolMessageId: 'tool-message-2',
        toolName: 'lobe-travel-production____generateDocument',
        toolResultMaxLength: 1000,
        toolSource: 'builtin',
      } as any,
    );

    const executionContext = mocks.executeTool.mock.calls[0]?.[1];
    expect(getPlatformManagedExecutionContext(executionContext)).toBeUndefined();
    expect(executionContext.modelRuntimeMode).toBeUndefined();
  });
});
