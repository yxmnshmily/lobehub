import { ThreadStatus, ThreadType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const { mockDebugLog } = vi.hoisted(() => ({ mockDebugLog: vi.fn() }));

vi.mock('debug', () => ({ default: () => mockDebugLog }));

// Mock trusted client to avoid server-side env access
vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

// Mock ThreadModel
const mockThreadModel = {
  create: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
};

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(function () {
    return mockThreadModel;
  }),
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn().mockImplementation(function () {
    return {
      findById: vi.fn().mockResolvedValue({ trigger: 'cli' }),
    };
  }),
}));

// Mock other models
vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(function () {
    return {
      getAgentConfig: vi.fn(),
      queryAgents: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(function () {
    return {
      create: vi.fn().mockResolvedValue({ id: 'msg-1' }),
      getLatestNonToolMessageId: vi.fn().mockResolvedValue(undefined),
      getLatestSpineMessageId: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    };
  }),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(function () {
    return {
      query: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(function () {
    return {
      releaseTaskCallbackReservation: vi.fn().mockResolvedValue(undefined),
      tryReserveTaskCallback: vi.fn().mockResolvedValue(true),
      create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
      findById: vi.fn().mockResolvedValue(null),
    };
  }),
}));

// Mock AgentService
vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(function () {
    return {
      getAgentConfig: vi.fn().mockResolvedValue({
        chatConfig: {},
        id: 'agent-1',
        model: 'gpt-4',
        plugins: [],
        provider: 'openai',
      }),
    };
  }),
}));

// Mock AgentRuntimeService
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(function () {
    return {
      createOperation: vi.fn().mockResolvedValue({
        autoStarted: true,
        messageId: 'queue-msg-1',
        operationId: 'op-123',
        success: true,
      }),
    };
  }),
}));

// Mock MarketService
vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(function () {
    return {
      getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
    };
  }),
}));

// Mock ComposioService
vi.mock('@/server/services/composio', () => ({
  ComposioService: vi.fn().mockImplementation(function () {
    return {
      getComposioManifests: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

describe('AiAgentService.execSubAgent', () => {
  let service: AiAgentService;
  const mockDb = {} as any;
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock implementations
    mockThreadModel.create.mockResolvedValue({
      id: 'thread-123',
      type: ThreadType.Isolation,
      status: ThreadStatus.Active,
      topicId: 'topic-1',
      agentId: 'agent-1',
      groupId: 'group-1',
      sourceMessageId: 'parent-msg-1',
    });
    mockThreadModel.update.mockResolvedValue({});

    service = new AiAgentService(mockDb, userId);
  });

  it('does not log sub-agent instruction content or caller-controlled identifiers', async () => {
    const secret = 'traveler@example.com sk-private-subagent-key';
    mockThreadModel.create.mockRejectedValueOnce(new Error('stop after request logging'));

    await expect(
      service.execSubAgent({
        agentId: 'agent-private-subagent',
        groupId: 'group-private-subagent',
        instruction: secret,
        parentMessageId: 'message-private-parent',
        topicId: 'topic-private-subagent',
      }),
    ).rejects.toThrow('stop after request logging');

    const logged = JSON.stringify(mockDebugLog.mock.calls);
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain('traveler@example.com');
    expect(logged).not.toContain('sk-private-subagent-key');
    expect(logged).not.toContain('agent-private-subagent');
    expect(logged).not.toContain('group-private-subagent');
    expect(logged).not.toContain('topic-private-subagent');
  });

  it('stores only an error kind and emits no raw failure from completion hooks', async () => {
    const maliciousError =
      'provider=private-provider passenger@example.com api_key=private-completion-token';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const execAgentSpy = vi.spyOn(service, 'execAgent').mockResolvedValue({
      agentId: 'agent-1',
      assistantMessageId: 'assistant-msg-1',
      autoStarted: true,
      createdAt: new Date().toISOString(),
      message: 'Agent operation created successfully',
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      status: 'created',
      success: true,
      timestamp: new Date().toISOString(),
      topicId: 'topic-1',
      userMessageId: 'user-msg-1',
    });

    try {
      await service.execSubAgent({
        agentId: 'agent-1',
        instruction: 'safe instruction',
        parentMessageId: 'parent-msg-1',
        topicId: 'topic-1',
      });

      const hooks = execAgentSpy.mock.calls[0][0].hooks!;
      const completionHook = hooks.find((hook) => hook.id === 'thread-completion')!;
      await completionHook.handler!({
        finalState: {
          error: new Error(maliciousError),
          messages: [],
          operationId: 'operation-private-completion',
        },
        operationId: 'operation-private-completion',
        reason: 'error',
      } as any);

      const emitted = JSON.stringify([
        mockDebugLog.mock.calls,
        consoleError.mock.calls,
        consoleWarn.mock.calls,
        mockThreadModel.update.mock.calls,
      ]);
      expect(emitted).not.toContain(maliciousError);
      expect(emitted).not.toContain('passenger@example.com');
      expect(emitted).not.toContain('private-completion-token');
      expect(mockThreadModel.update).toHaveBeenCalledWith(
        'thread-123',
        expect.objectContaining({
          metadata: expect.objectContaining({ error: { kind: 'runtime' } }),
        }),
      );
      expect(mockDebugLog).toHaveBeenCalledWith('ai_agent.execution.error');
      expect(
        mockDebugLog.mock.calls.some(([event]) => event === 'ai_agent.execution.completed'),
      ).toBe(false);
    } finally {
      consoleError.mockRestore();
      consoleWarn.mockRestore();
    }
  });

  it('does not persist a raw startup failure in isolation thread metadata', async () => {
    const maliciousError =
      'database=private-db traveler@example.com password=private-database-password';
    vi.spyOn(service, 'execAgent').mockResolvedValue({
      error: maliciousError,
      operationId: 'op-123',
      success: false,
    } as any);

    await service.execSubAgent({
      agentId: 'agent-1',
      instruction: 'safe instruction',
      parentMessageId: 'parent-msg-1',
      topicId: 'topic-1',
    });

    const persisted = JSON.stringify(mockThreadModel.update.mock.calls);
    expect(persisted).not.toContain(maliciousError);
    expect(persisted).not.toContain('traveler@example.com');
    expect(persisted).not.toContain('private-database-password');
    expect(mockThreadModel.update).toHaveBeenCalledWith(
      'thread-123',
      expect.objectContaining({
        metadata: expect.objectContaining({ error: { kind: 'runtime' } }),
      }),
    );
  });

  describe('successful isolated execution', () => {
    it('should create Thread with correct parameters', async () => {
      // Mock execAgent to return success
      vi.spyOn(service, 'execAgent').mockResolvedValue({
        agentId: 'agent-1',
        assistantMessageId: 'assistant-msg-1',
        autoStarted: true,
        createdAt: new Date().toISOString(),
        message: 'Agent operation created successfully',
        messageId: 'queue-msg-1',
        operationId: 'op-123',
        status: 'created',
        success: true,
        timestamp: new Date().toISOString(),
        topicId: 'topic-1',
        userMessageId: 'user-msg-1',
      });

      await service.execSubAgent({
        agentId: 'agent-1',
        groupId: 'group-1',
        instruction: 'Test instruction',
        parentMessageId: 'parent-msg-1',
        topicId: 'topic-1',
      });

      expect(mockThreadModel.create).toHaveBeenCalledWith({
        agentId: 'agent-1',
        groupId: 'group-1',
        sourceMessageId: 'parent-msg-1',
        topicId: 'topic-1',
        type: ThreadType.Isolation,
      });
    });

    it('should update Thread status to processing with startedAt', async () => {
      vi.spyOn(service, 'execAgent').mockResolvedValue({
        agentId: 'agent-1',
        assistantMessageId: 'assistant-msg-1',
        autoStarted: true,
        createdAt: new Date().toISOString(),
        message: 'Agent operation created successfully',
        messageId: 'queue-msg-1',
        operationId: 'op-123',
        status: 'created',
        success: true,
        timestamp: new Date().toISOString(),
        topicId: 'topic-1',
        userMessageId: 'user-msg-1',
      });

      await service.execSubAgent({
        agentId: 'agent-1',
        groupId: 'group-1',
        instruction: 'Test instruction',
        parentMessageId: 'parent-msg-1',
        topicId: 'topic-1',
      });

      expect(mockThreadModel.update).toHaveBeenCalledWith('thread-123', {
        metadata: { startedAt: expect.any(String) },
        status: ThreadStatus.Processing,
      });
    });

    it('should call execAgent with threadId in appContext and stepCallbacks', async () => {
      const execAgentSpy = vi.spyOn(service, 'execAgent').mockResolvedValue({
        agentId: 'agent-1',
        assistantMessageId: 'assistant-msg-1',
        autoStarted: true,
        createdAt: new Date().toISOString(),
        message: 'Agent operation created successfully',
        messageId: 'queue-msg-1',
        operationId: 'op-123',
        status: 'created',
        success: true,
        timestamp: new Date().toISOString(),
        topicId: 'topic-1',
        userMessageId: 'user-msg-1',
      });

      await service.execSubAgent({
        agentId: 'agent-1',
        groupId: 'group-1',
        instruction: 'Test instruction',
        parentMessageId: 'parent-msg-1',
        topicId: 'topic-1',
      });

      expect(execAgentSpy).toHaveBeenCalledWith({
        agentId: 'agent-1',
        appContext: {
          groupId: 'group-1',
          // Guest on the parent's topic — must not claim its running mark.
          isolationThread: true,
          isSubAgent: false,
          threadId: 'thread-123',
          topicId: 'topic-1',
        },
        autoStart: true,
        hooks: expect.arrayContaining([
          expect.objectContaining({ id: 'thread-metadata-update', type: 'afterStep' }),
          expect.objectContaining({ id: 'thread-completion', type: 'onComplete' }),
        ]),
        prompt: 'Test instruction',
        userInterventionConfig: {
          approvalMode: 'headless',
        },
      });
    });

    it('should run deferred lobe-agent children through execVirtualSubAgent', async () => {
      const execAgentSpy = vi.spyOn(service, 'execAgent').mockResolvedValue({
        agentId: 'agent-1',
        assistantMessageId: 'assistant-msg-1',
        autoStarted: true,
        createdAt: new Date().toISOString(),
        message: 'Agent operation created successfully',
        messageId: 'queue-msg-1',
        operationId: 'op-123',
        status: 'created',
        success: true,
        timestamp: new Date().toISOString(),
        topicId: 'topic-1',
        userMessageId: 'user-msg-1',
      });

      await service.execVirtualSubAgent({
        agentId: 'agent-1',
        instruction: 'Nested research task',
        parentMessageId: 'tool-msg-1',
        parentOperationId: 'parent-op-1',
        topicId: 'topic-1',
      });

      expect(execAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          appContext: expect.objectContaining({
            isolationThread: true,
            isSubAgent: true,
            threadId: 'thread-123',
            topicId: 'topic-1',
          }),
          hooks: expect.arrayContaining([
            expect.objectContaining({ id: 'sub-agent-bridge', type: 'onComplete' }),
          ]),
          parentOperationId: 'parent-op-1',
          trigger: 'cli',
        }),
      );
    });

    it('should store operationId and startedAt in Thread metadata', async () => {
      vi.spyOn(service, 'execAgent').mockResolvedValue({
        agentId: 'agent-1',
        assistantMessageId: 'assistant-msg-1',
        autoStarted: true,
        createdAt: new Date().toISOString(),
        message: 'Agent operation created successfully',
        messageId: 'queue-msg-1',
        operationId: 'op-123',
        status: 'created',
        success: true,
        timestamp: new Date().toISOString(),
        topicId: 'topic-1',
        userMessageId: 'user-msg-1',
      });

      await service.execSubAgent({
        agentId: 'agent-1',
        groupId: 'group-1',
        instruction: 'Test instruction',
        parentMessageId: 'parent-msg-1',
        topicId: 'topic-1',
      });

      // Second update call should be storing operationId and startedAt in metadata
      expect(mockThreadModel.update).toHaveBeenCalledWith('thread-123', {
        metadata: { operationId: 'op-123', startedAt: expect.any(String) },
      });
    });

    it('should return correct result on success', async () => {
      vi.spyOn(service, 'execAgent').mockResolvedValue({
        agentId: 'agent-1',
        assistantMessageId: 'assistant-msg-1',
        autoStarted: true,
        createdAt: new Date().toISOString(),
        message: 'Agent operation created successfully',
        messageId: 'queue-msg-1',
        operationId: 'op-123',
        status: 'created',
        success: true,
        timestamp: new Date().toISOString(),
        topicId: 'topic-1',
        userMessageId: 'user-msg-1',
      });

      const result = await service.execSubAgent({
        agentId: 'agent-1',
        groupId: 'group-1',
        instruction: 'Test instruction',
        parentMessageId: 'parent-msg-1',
        topicId: 'topic-1',
      });

      expect(result).toEqual({
        assistantMessageId: 'assistant-msg-1',
        error: undefined,
        operationId: 'op-123',
        success: true,
        threadId: 'thread-123',
      });
    });
  });

  describe('execAgent failure handling', () => {
    it('should update Thread status to failed when execAgent fails', async () => {
      vi.spyOn(service, 'execAgent').mockResolvedValue({
        agentId: 'agent-1',
        assistantMessageId: 'assistant-msg-1',
        autoStarted: false,
        createdAt: new Date().toISOString(),
        error: 'Agent execution failed',
        message: 'Agent operation failed to start',
        operationId: 'op-123',
        status: 'error',
        success: false,
        timestamp: new Date().toISOString(),
        topicId: 'topic-1',
        userMessageId: 'user-msg-1',
      });

      await service.execSubAgent({
        agentId: 'agent-1',
        groupId: 'group-1',
        instruction: 'Test instruction',
        parentMessageId: 'parent-msg-1',
        topicId: 'topic-1',
      });

      // Should update Thread status to failed with metadata
      expect(mockThreadModel.update).toHaveBeenCalledWith('thread-123', {
        metadata: expect.objectContaining({
          completedAt: expect.any(String),
          duration: expect.any(Number),
          error: { kind: 'runtime' },
          operationId: 'op-123',
          startedAt: expect.any(String),
        }),
        status: ThreadStatus.Failed,
      });
    });

    it('should store a safe error kind with duration when execAgent fails', async () => {
      vi.spyOn(service, 'execAgent').mockResolvedValue({
        agentId: 'agent-1',
        assistantMessageId: 'assistant-msg-1',
        autoStarted: false,
        createdAt: new Date().toISOString(),
        error: 'QStash service unavailable',
        message: 'Agent operation failed to start',
        operationId: 'op-123',
        status: 'error',
        success: false,
        timestamp: new Date().toISOString(),
        topicId: 'topic-1',
        userMessageId: 'user-msg-1',
      });

      await service.execSubAgent({
        agentId: 'agent-1',
        groupId: 'group-1',
        instruction: 'Test instruction',
        parentMessageId: 'parent-msg-1',
        topicId: 'topic-1',
      });

      // Last update call should contain error info, completedAt, startedAt, and duration
      const lastUpdateCall = mockThreadModel.update.mock.calls.find(
        (call) => call[1].status === ThreadStatus.Failed,
      );
      expect(lastUpdateCall).toBeDefined();
      expect(lastUpdateCall![1].metadata).toMatchObject({
        completedAt: expect.any(String),
        duration: expect.any(Number),
        error: { kind: 'runtime' },
        operationId: 'op-123',
        startedAt: expect.any(String),
      });
    });

    it('should return result with error info when execAgent fails', async () => {
      vi.spyOn(service, 'execAgent').mockResolvedValue({
        agentId: 'agent-1',
        assistantMessageId: 'assistant-msg-1',
        autoStarted: false,
        createdAt: new Date().toISOString(),
        error: 'Agent execution failed',
        message: 'Agent operation failed to start',
        operationId: 'op-123',
        status: 'error',
        success: false,
        timestamp: new Date().toISOString(),
        topicId: 'topic-1',
        userMessageId: 'user-msg-1',
      });

      const result = await service.execSubAgent({
        agentId: 'agent-1',
        groupId: 'group-1',
        instruction: 'Test instruction',
        parentMessageId: 'parent-msg-1',
        topicId: 'topic-1',
      });

      expect(result).toEqual({
        assistantMessageId: 'assistant-msg-1',
        error: 'Agent execution failed',
        operationId: 'op-123',
        success: false,
        threadId: 'thread-123',
      });
    });
  });

  describe('Thread creation failure', () => {
    it('should throw error when Thread creation fails', async () => {
      mockThreadModel.create.mockResolvedValue(null);

      await expect(
        service.execSubAgent({
          agentId: 'agent-1',
          groupId: 'group-1',
          instruction: 'Test instruction',
          parentMessageId: 'parent-msg-1',
          topicId: 'topic-1',
        }),
      ).rejects.toThrow('Failed to create thread for agent execution');
    });

    it('should throw error when Thread creation throws', async () => {
      mockThreadModel.create.mockRejectedValue(new Error('Database connection failed'));

      await expect(
        service.execSubAgent({
          agentId: 'agent-1',
          groupId: 'group-1',
          instruction: 'Test instruction',
          parentMessageId: 'parent-msg-1',
          topicId: 'topic-1',
        }),
      ).rejects.toThrow('Database connection failed');
    });
  });

  describe('source message summary update', () => {
    it('should pass sourceMessageId (parentMessageId) to callbacks for summary update', async () => {
      const execAgentSpy = vi.spyOn(service, 'execAgent').mockResolvedValue({
        agentId: 'agent-1',
        assistantMessageId: 'assistant-msg-1',
        autoStarted: true,
        createdAt: new Date().toISOString(),
        message: 'Agent operation created successfully',
        messageId: 'queue-msg-1',
        operationId: 'op-123',
        status: 'created',
        success: true,
        timestamp: new Date().toISOString(),
        topicId: 'topic-1',
        userMessageId: 'user-msg-1',
      });

      await service.execSubAgent({
        agentId: 'agent-1',
        groupId: 'group-1',
        instruction: 'Test instruction',
        parentMessageId: 'parent-msg-1',
        topicId: 'topic-1',
      });

      // Verify that hooks were passed with onComplete
      expect(execAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          hooks: expect.arrayContaining([
            expect.objectContaining({ id: 'thread-completion', type: 'onComplete' }),
          ]),
        }),
      );

      // Get the onComplete hook handler
      const callArgs = execAgentSpy.mock.calls[0][0];
      const onCompleteHook = callArgs.hooks?.find((h: any) => h.id === 'thread-completion');

      expect(onCompleteHook).toBeDefined();
      expect(onCompleteHook!.handler).toBeInstanceOf(Function);
    });
  });
});
