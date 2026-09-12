import { GeneralChatAgent, GraphAgent } from '@lobechat/agent-runtime';
import { PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import { SELF_FEEDBACK_INTENT_IDENTIFIER } from '@lobechat/builtin-tool-self-iteration';
import { RequestTrigger } from '@lobechat/types';
import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createServerAgentToolsEngine } from '@/server/modules/Mecha';
import { AgentService } from '@/server/services/agent';
import { AgentRuntimeService } from '@/server/services/agentRuntime';

import { AiAgentService } from '../index';
import {
  getPlatformManagedExecutionContext,
  grantPlatformManagedExecution,
  hasPlatformManagedExecutionCapability,
} from '../platformManagedExecution';

// Phone verification is covered by verifiedPhone tests; this runtime fixture
// exercises already-authorized runs without a live account database.
vi.mock('../verifiedPhone', () => ({ assertGroupAiPhoneVerified: vi.fn() }));

const {
  mockDebugLog,
  mockBindSharedBudget,
  mockCompleteSharedBudget,
  mockCreateOperation,
  mockCreateSharedBudget,
  mockGetAgentConfig,
  mockGetBuiltinAgent,
  mockGetInfoForAIGeneration,
  mockGetSharedBudget,
  mockHasGlobalRole,
  mockIsAgentSignalEnabledForUser,
  mockMessageCreate,
  mockMessageQuery,
  mockMessageUpdate,
  mockGetUserSettings,
  mockGetUserPreference,
  mockGetPersona,
  mockResolveTask,
  mockToolsEnv,
} = vi.hoisted(() => ({
  mockDebugLog: vi.fn(),
  mockBindSharedBudget: vi.fn(),
  mockCompleteSharedBudget: vi.fn(),
  mockCreateOperation: vi.fn(),
  mockCreateSharedBudget: vi.fn(),
  mockGetAgentConfig: vi.fn(),
  mockGetBuiltinAgent: vi.fn(),
  mockGetInfoForAIGeneration: vi.fn(),
  mockGetSharedBudget: vi.fn(),
  mockHasGlobalRole: vi.fn(),
  mockIsAgentSignalEnabledForUser: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockMessageQuery: vi.fn(),
  mockMessageUpdate: vi.fn(),
  mockGetUserSettings: vi.fn(),
  mockGetUserPreference: vi.fn(),
  mockGetPersona: vi.fn(),
  mockResolveTask: vi.fn(),
  mockToolsEnv: {
    MULTIMODAL_UNDERSTANDING_MODEL: undefined as string | undefined,
    MULTIMODAL_UNDERSTANDING_PROVIDER: undefined as string | undefined,
  },
}));

vi.mock('debug', () => ({ default: () => mockDebugLog }));

vi.mock('@/envs/tools', () => ({
  toolsEnv: mockToolsEnv,
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: mockMessageCreate,
    getLatestNonToolMessageId: vi.fn().mockResolvedValue(undefined),
    getLatestSpineMessageId: vi.fn().mockResolvedValue(undefined),
    query: mockMessageQuery,
    update: mockMessageUpdate,
  })),
}));

vi.mock('@/database/models/chatGroup', () => ({
  ChatGroupModel: vi.fn().mockImplementation(() => ({
    findById: vi.fn().mockResolvedValue({ title: 'Group', content: 'Group work' }),
    getGroupAgentsWithMeta: vi
      .fn()
      .mockResolvedValue([{ agentId: 'supervisor', role: 'supervisor', title: 'Supervisor' }]),
  })),
}));

vi.mock('@/database/models/rbac', () => ({
  RbacModel: vi.fn().mockImplementation((_db, principalUserId) => ({
    hasGlobalRole: (role: string) => mockHasGlobalRole(role, principalUserId),
  })),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn(),
    getBuiltinAgent: mockGetBuiltinAgent,
    queryAgents: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation((_db, resourceOwnerUserId) => ({
    getAgentConfig: (identifier: string) => mockGetAgentConfig(identifier, resourceOwnerUserId),
  })),
}));

vi.mock('@/server/services/agentSignal/featureGate', () => ({
  isAgentSignalEnabledForUser: mockIsAgentSignalEnabledForUser,
  isLobeAiAgentSlug: (slug?: string | null) => slug === 'inbox',
  resolveAgentSelfIterationCapability: ({
    agentSelfIterationEnabled,
    isAgentSelfIterationFeatureEnabled,
    isLobeAiAgent,
  }: {
    agentSelfIterationEnabled?: boolean;
    isAgentSelfIterationFeatureEnabled: boolean;
    isLobeAiAgent: boolean;
  }) => isAgentSelfIterationFeatureEnabled && (isLobeAiAgent || agentSelfIterationEnabled === true),
}));

vi.mock('@/server/services/agentSignal', () => ({
  enqueueAgentSignalSourceEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn().mockImplementation(() => ({
    queryByIdentifiers: vi.fn().mockResolvedValue([]),
    resolveByIdentifiers: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/connectorTool', () => ({
  ConnectorToolModel: vi.fn().mockImplementation(() => ({
    queryByConnector: vi.fn().mockResolvedValue([]),
    queryByConnectorIds: vi.fn().mockResolvedValue([]),
    queryAllByConnectorIds: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    releaseTaskCallbackReservation: vi.fn().mockResolvedValue(undefined),
    tryReserveTaskCallback: vi.fn().mockResolvedValue(true),
    create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
    findById: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => ({
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: Object.assign(
    vi.fn().mockImplementation(() => ({
      getUserSettings: mockGetUserSettings,
      getUserPreference: mockGetUserPreference,
    })),
    {
      getInfoForAIGeneration: mockGetInfoForAIGeneration,
    },
  ),
}));

vi.mock('@/database/models/userMemory/persona', () => ({
  UserPersonaModel: vi.fn().mockImplementation(() => ({
    getLatestPersonaDocument: mockGetPersona,
  })),
}));

vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn().mockImplementation(() => ({
    resolve: mockResolveTask,
  })),
}));

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    createOperation: mockCreateOperation,
  })),
}));

vi.mock('@/server/services/platformUsageBilling/sharedBudget', () => ({
  bindPlatformUsageSharedBudget: mockBindSharedBudget,
  completePlatformUsageSharedBudgetForOperation: mockCompleteSharedBudget,
  createPlatformUsageSharedBudget: mockCreateSharedBudget,
  getPlatformUsageSharedBudgetForOperation: mockGetSharedBudget,
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(() => ({
    getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/composio', () => ({
  ComposioService: vi.fn().mockImplementation(() => ({
    getComposioManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    getFullFileUrl: (path: string | null) => Promise.resolve(path || ''),
    uploadFromUrl: vi.fn(),
  })),
}));

vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockImplementation(() => ({ enabledToolIds: [], tools: [] })),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
  serverMessagesEngine: vi.fn().mockResolvedValue([{ content: 'test', role: 'user' }]),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('model-bank', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelBankModule>();
  return {
    ...actual,
    LOBE_DEFAULT_MODEL_LIST: [
      {
        abilities: { audio: false, functionCall: true, video: false, vision: true },
        id: 'gpt-4',
        providerId: 'openai',
      },
      {
        abilities: { audio: false, functionCall: true, video: false, vision: false },
        id: 'text-only',
        providerId: 'openai',
      },
      {
        abilities: { audio: true, functionCall: true, video: true, vision: true },
        id: 'gemini-3.1-flash-lite-preview',
        providerId: 'google',
      },
    ],
  };
});

describe('AiAgentService.execAgent - builtin agent runtime config', () => {
  let service: AiAgentService;
  const mockDb = {} as any;
  const userId = 'test-user-id';
  const minimalGraph = {
    edges: [{ from: '__root__', instruction: 'Answer with the graph runtime.', to: 'answer' }],
    fields: {},
    name: 'answer-graph',
    nodes: { answer: { type: 'llm' } },
    terminal: 'answer',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockMessageQuery.mockResolvedValue([]);
    mockMessageUpdate.mockResolvedValue({});
    mockGetUserSettings.mockResolvedValue({ memory: { enabled: false } });
    mockGetUserPreference.mockResolvedValue({});
    mockGetPersona.mockResolvedValue(null);
    mockIsAgentSignalEnabledForUser.mockResolvedValue(true);
    mockResolveTask.mockResolvedValue(null);
    mockGetInfoForAIGeneration.mockResolvedValue({
      responseLanguage: 'en-US',
      userName: 'Test User',
    });
    mockHasGlobalRole.mockResolvedValue(false);
    mockCompleteSharedBudget.mockResolvedValue(true);
    mockCreateSharedBudget.mockResolvedValue({});
    mockGetSharedBudget.mockReturnValue(undefined);
    mockToolsEnv.MULTIMODAL_UNDERSTANDING_MODEL = 'vision-model';
    mockToolsEnv.MULTIMODAL_UNDERSTANDING_PROVIDER = 'test-provider';
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });
    mockGetBuiltinAgent.mockResolvedValue(null);
    service = new AiAgentService(mockDb, userId);
  });

  describe('graph runtime factory', () => {
    const getLatestAgentFactory = () => {
      const options = vi.mocked(AgentRuntimeService).mock.calls.at(-1)?.[2] as any;
      const agentFactory = options?.agentFactory;

      expect(agentFactory).toEqual(expect.any(Function));

      return agentFactory as (config: any) => unknown;
    };

    it('creates GraphAgent when graph mode is enabled with a valid graph snapshot', () => {
      service = new AiAgentService(mockDb, userId);

      const agent = getLatestAgentFactory()({
        agentConfig: {
          agencyConfig: {
            enableGraphMode: true,
            graph: minimalGraph,
          },
        },
        operationId: 'op-graph',
      });

      expect(agent).toBeInstanceOf(GraphAgent);
    });

    it('falls back to GeneralChatAgent when the graph snapshot is invalid', () => {
      service = new AiAgentService(mockDb, userId);

      const agent = getLatestAgentFactory()({
        agentConfig: {
          agencyConfig: {
            enableGraphMode: true,
            graph: { ...minimalGraph, edges: [] },
          },
        },
        operationId: 'op-invalid-graph',
      });

      expect(agent).toBeInstanceOf(GeneralChatAgent);
    });

    it('falls back to a legacy chatConfig graph snapshot', () => {
      service = new AiAgentService(mockDb, userId);

      const agent = getLatestAgentFactory()({
        agentConfig: {
          chatConfig: {
            enableGraphMode: true,
            graph: minimalGraph,
          },
        },
        operationId: 'op-legacy-graph',
      });

      expect(agent).toBeInstanceOf(GraphAgent);
    });

    it('keeps an upstream runtime agent factory authoritative', () => {
      const upstreamAgent = { runner: vi.fn() };
      const upstreamFactory = vi.fn(() => upstreamAgent);
      service = new AiAgentService(mockDb, userId, {
        runtimeOptions: {
          agentFactory: upstreamFactory,
        },
      } as any);

      const config = {
        agentConfig: {
          chatConfig: {
            enableGraphMode: true,
            graph: minimalGraph,
          },
        },
        operationId: 'op-upstream',
      };
      const agent = getLatestAgentFactory()(config);

      expect(agent).toBe(upstreamAgent);
      expect(upstreamFactory).toHaveBeenCalledWith(config);
    });
  });

  it('materializes a builtin agent addressed by slug when no row exists yet', async () => {
    // Background self-iteration runs dispatch via execAgent({ slug }) before any
    // persisted row exists. The first resolve (by slug) misses; execAgent must
    // lazily materialize the virtual builtin row (getBuiltinAgent) and re-resolve
    // — without it the run throws `Agent not found: self-reflection`.
    mockGetAgentConfig.mockResolvedValueOnce(null).mockResolvedValueOnce({
      chatConfig: {},
      id: 'agent-self-reflection',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      slug: 'self-reflection',
      systemRole: '',
    });
    mockGetBuiltinAgent.mockResolvedValueOnce({
      id: 'agent-self-reflection',
      slug: 'self-reflection',
    });

    await service.execAgent({ prompt: 'reflect', slug: 'self-reflection' });

    expect(mockGetBuiltinAgent).toHaveBeenCalledWith('self-reflection');
    expect(mockCreateOperation).toHaveBeenCalledTimes(1);
    expect(mockCreateOperation.mock.calls[0][0].agentConfig.slug).toBe('self-reflection');
  });

  it('throws for an unknown non-builtin identifier without materializing a row', async () => {
    mockGetAgentConfig.mockResolvedValue(null);

    await expect(service.execAgent({ agentId: 'does-not-exist', prompt: 'hi' })).rejects.toThrow(
      'Agent not found: does-not-exist',
    );
    expect(mockGetBuiltinAgent).not.toHaveBeenCalled();
  });

  it('does not log prompt content or caller-controlled agent identifiers', async () => {
    const secret = 'passenger@example.com sk-private-api-key';
    mockGetAgentConfig.mockResolvedValue(null);

    await expect(
      service.execAgent({ agentId: 'agent-private-customer', prompt: secret }),
    ).rejects.toThrow('Agent not found');

    const logged = JSON.stringify(mockDebugLog.mock.calls);
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain('passenger@example.com');
    expect(logged).not.toContain('sk-private-api-key');
    expect(logged).not.toContain('agent-private-customer');
  });

  it('does not log model, provider, operation, topic, message, or user identifiers', async () => {
    const privateValues = [
      'agent-private-id',
      'model-private-id',
      'provider-private-id',
      'operation-private-id',
      'queue-message-private-id',
      userId,
    ];
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: privateValues[0],
      model: privateValues[1],
      plugins: [],
      provider: privateValues[2],
      systemRole: '',
    });
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: privateValues[4],
      operationId: privateValues[3],
      success: true,
    });

    await service.execAgent({ agentId: privateValues[0], prompt: 'safe request' });

    const logged = JSON.stringify(mockDebugLog.mock.calls);
    for (const value of privateValues) expect(logged).not.toContain(value);
    for (const [event, ...fields] of mockDebugLog.mock.calls) {
      expect([
        'ai_agent.execution.aborted',
        'ai_agent.execution.completed',
        'ai_agent.execution.error',
        'ai_agent.lifecycle',
        'ai_agent.operation.created',
        'ai_agent.request.accepted',
      ]).toContain(event);
      expect(fields.every((field) => typeof field === 'number')).toBe(true);
    }
  });

  it('does not persist or log a raw provider failure in the assistant error detail', async () => {
    const maliciousError =
      'provider=db-internal user=passenger@example.com api_key=sk-private-provider-token';
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-safe',
      model: 'model-safe',
      plugins: [],
      provider: 'provider-safe',
      systemRole: '',
    });
    mockCreateOperation.mockRejectedValueOnce(new Error(maliciousError));

    const result = await service.execAgent({ agentId: 'agent-safe', prompt: 'safe request' });

    expect(JSON.stringify(mockDebugLog.mock.calls)).not.toContain(maliciousError);
    expect(JSON.stringify(mockMessageUpdate.mock.calls)).not.toContain(maliciousError);
    expect(JSON.stringify(result)).not.toContain(maliciousError);
    expect(mockMessageUpdate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        error: {
          body: { detail: 'Agent execution failed.' },
          message: 'Agent execution failed.',
          type: 'ServerAgentRuntimeError',
        },
      }),
    );
  });

  it('does not expose a database error containing PII through debug or console output', async () => {
    const maliciousError =
      'database host=private-db user=traveler@example.com token=private-database-token';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetInfoForAIGeneration.mockRejectedValueOnce(new Error(maliciousError));
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-inbox',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      slug: 'inbox',
      systemRole: '',
    });

    try {
      await service.execAgent({ agentId: 'agent-inbox', prompt: 'safe request' });

      const emitted = JSON.stringify([
        mockDebugLog.mock.calls,
        consoleError.mock.calls,
        consoleWarn.mock.calls,
      ]);
      expect(emitted).not.toContain(maliciousError);
      expect(emitted).not.toContain('traveler@example.com');
      expect(emitted).not.toContain('private-database-token');
    } finally {
      consoleError.mockRestore();
      consoleWarn.mockRestore();
    }
  });

  it('rejects a customer direct execAgent call for a stored platform-managed agent', async () => {
    mockGetAgentConfig.mockResolvedValue({
      agencyConfig: { modelRuntimeMode: 'platform-managed' },
      chatConfig: {},
      id: 'agent-travel-supervisor',
      model: 'deepseek-chat',
      plugins: [],
      provider: 'deepseek',
      systemRole: 'Coordinate travel work.',
      userId,
    });

    await expect(
      service.execAgent({ agentId: 'agent-travel-supervisor', prompt: 'make a poster' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mockCreateOperation).not.toHaveBeenCalled();
  });

  it('rejects a customer direct execGroupAgent call before creating a group topic', async () => {
    mockGetAgentConfig.mockResolvedValue({
      agencyConfig: { modelRuntimeMode: 'platform-managed' },
      chatConfig: {},
      id: 'agent-travel-supervisor',
      model: 'deepseek-chat',
      plugins: [],
      provider: 'deepseek',
      systemRole: 'Coordinate travel work.',
      userId,
    });

    await expect(
      service.execGroupAgent({
        agentId: 'agent-travel-supervisor',
        groupId: 'group-travel',
        message: 'make a poster',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mockCreateOperation).not.toHaveBeenCalled();
  });

  it('does not log group message content or caller-controlled group identifiers', async () => {
    const secret = '护照号E12345678 token=private-token-value';
    mockGetAgentConfig.mockResolvedValue({
      agencyConfig: { modelRuntimeMode: 'platform-managed' },
      chatConfig: {},
      id: 'agent-travel-supervisor',
      model: 'deepseek-chat',
      plugins: [],
      provider: 'deepseek',
      systemRole: 'Coordinate travel work.',
      userId,
    });

    await expect(
      service.execGroupAgent({
        agentId: 'agent-private-supervisor',
        groupId: 'group-private-customer',
        message: secret,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const logged = JSON.stringify(mockDebugLog.mock.calls);
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain('E12345678');
    expect(logged).not.toContain('private-token-value');
    expect(logged).not.toContain('agent-private-supervisor');
    expect(logged).not.toContain('group-private-customer');
  });

  it('does not log in-group member instructions or caller-controlled identifiers', async () => {
    const secret = 'guest@example.com api_key=private-member-key';
    vi.spyOn(service, 'execAgent').mockResolvedValue({
      operationId: 'operation-1',
      success: true,
    } as any);

    await service.execGroupMember({
      agentId: 'agent-private-member',
      anchorMessageId: 'anchor-private-member',
      expectedMembers: 1,
      groupId: 'group-private-member',
      groupToolMessageId: 'tool-private-member',
      instruction: secret,
      mode: 'in_group',
      onComplete: 'resume',
      parentOperationId: 'operation-private-parent',
      topicId: 'topic-private-member',
    });

    const logged = JSON.stringify(mockDebugLog.mock.calls);
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain('guest@example.com');
    expect(logged).not.toContain('private-member-key');
    expect(logged).not.toContain('agent-private-member');
    expect(logged).not.toContain('group-private-member');
    expect(logged).not.toContain('topic-private-member');
  });

  it('inherits the parent shared budget into an in-group member only through the Symbol capability', async () => {
    const sharedBudget = {};
    mockGetSharedBudget.mockReturnValue(sharedBudget);
    const execAgent = vi.spyOn(service, 'execAgent').mockResolvedValue({
      operationId: 'member-operation',
      success: true,
    } as any);

    await service.execGroupMember({
      agentId: 'member-agent',
      anchorMessageId: 'anchor-message',
      expectedMembers: 1,
      groupId: 'travel-group',
      groupToolMessageId: 'group-tool-message',
      instruction: 'prepare copy',
      mode: 'in_group',
      onComplete: 'resume',
      parentOperationId: 'parent-operation',
      topicId: 'topic-1',
    });

    const childParams = execAgent.mock.calls[0][0];
    expect(mockGetSharedBudget).toHaveBeenCalledWith('parent-operation', {
      actorUserId: userId,
      workspaceId: undefined,
    });
    expect(getPlatformManagedExecutionContext(childParams)).toEqual({ sharedBudget });
    expect(JSON.stringify(childParams)).not.toContain('sharedBudget');
    expect(JSON.stringify(childParams)).not.toContain('platformManagedMaxCredits');
  });

  it('starts an authorized admin run without creating an automatic Credits reservation', async () => {
    mockHasGlobalRole.mockResolvedValue(true);
    mockGetAgentConfig.mockResolvedValue({
      agencyConfig: { modelRuntimeMode: 'platform-managed' },
      chatConfig: {},
      id: 'agent-travel-supervisor',
      model: 'deepseek-chat',
      plugins: [],
      provider: 'deepseek',
      systemRole: 'Coordinate travel work.',
      userId,
    });

    await service.execAgent({ agentId: 'agent-travel-supervisor', prompt: 'inspect the setup' });

    expect(mockHasGlobalRole).toHaveBeenCalledWith('super_admin', userId);
    expect(mockCreateOperation).toHaveBeenCalled();
    expect(mockCreateSharedBudget).toHaveBeenCalledWith(
      mockDb,
      userId,
      expect.objectContaining({ maxCredits: undefined }),
    );
  });

  it.each([true, false])(
    'ignores a legacy task ceiling for admin metering without granting authorization (admin=%s)',
    async (isAdmin) => {
      mockHasGlobalRole.mockResolvedValue(isAdmin);
      mockGetAgentConfig.mockResolvedValue({
        agencyConfig: { modelRuntimeMode: 'platform-managed' },
        chatConfig: {},
        id: 'agent-travel-supervisor',
        model: 'deepseek-chat',
        plugins: [],
        provider: 'deepseek',
        systemRole: 'Coordinate travel work.',
        userId,
      });
      const execution = service.execAgent({
        agentId: 'agent-travel-supervisor',
        platformManagedMaxCredits: 650_000,
        prompt: 'inspect the setup',
      });
      if (!isAdmin) {
        await expect(execution).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(mockCreateSharedBudget).not.toHaveBeenCalled();
        return;
      }
      await execution;
      expect(mockCreateSharedBudget).toHaveBeenCalledWith(
        mockDb,
        userId,
        expect.objectContaining({ maxCredits: undefined }),
      );
    },
  );

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid task ceiling %s before reservation',
    async (maxCredits) => {
      mockHasGlobalRole.mockResolvedValue(true);
      mockGetAgentConfig.mockResolvedValue({
        agencyConfig: { modelRuntimeMode: 'platform-managed' },
        chatConfig: {},
        id: 'agent-travel-supervisor',
        model: 'deepseek-chat',
        plugins: [],
        provider: 'deepseek',
        userId,
      });
      await expect(
        service.execAgent({
          agentId: 'agent-travel-supervisor',
          platformManagedMaxCredits: maxCredits,
          prompt: 'test',
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(mockCreateSharedBudget).not.toHaveBeenCalled();
    },
  );

  it('creates and binds the hosted limit as an opaque root budget without operation metadata', async () => {
    mockGetAgentConfig.mockResolvedValue({
      agencyConfig: { modelRuntimeMode: 'platform-managed' },
      chatConfig: {},
      id: 'agent-travel-supervisor',
      model: 'deepseek-chat',
      plugins: [],
      provider: 'deepseek',
      systemRole: 'Coordinate travel work.',
      userId,
    });

    await service.execAgent(
      grantPlatformManagedExecution(
        { agentId: 'agent-travel-supervisor', prompt: 'make a document' },
        { maxCredits: 4321 },
      ),
    );

    expect(mockCreateOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        appContext: expect.not.objectContaining({
          platformManagedExecutionAuthorized: expect.anything(),
          platformManagedMaxCredits: expect.anything(),
        }),
      }),
    );
    expect(mockCreateSharedBudget).toHaveBeenCalledWith(
      mockDb,
      userId,
      expect.objectContaining({
        maxCredits: 4321,
        requestIdentity: expect.stringMatching(/^platform-usage-request:/),
      }),
    );
    expect(mockBindSharedBudget).toHaveBeenCalledWith(
      expect.stringMatching(/^op_/),
      {},
      {
        actorUserId: userId,
        workspaceId: undefined,
      },
    );
    expect((service as any).withholdGatewayToken).toBe(false);
    expect(JSON.stringify(mockDebugLog.mock.calls)).not.toContain('4321');
  });

  it('reads hosted group resources as the owner while binding usage to the acting member', async () => {
    const actorUserId = 'invited-member';
    const resourceOwnerUserId = 'group-owner';
    const sharedBudget = {};
    mockGetAgentConfig.mockImplementation(async (_identifier, lookupUserId) =>
      lookupUserId === resourceOwnerUserId
        ? {
            agencyConfig: { modelRuntimeMode: 'platform-managed' },
            chatConfig: {},
            id: 'agent-travel-supervisor',
            model: 'deepseek-chat',
            plugins: [],
            provider: 'deepseek',
            systemRole: 'Coordinate travel work.',
            userId: resourceOwnerUserId,
          }
        : undefined,
    );
    service = new AiAgentService(mockDb, actorUserId, { resourceOwnerUserId } as any);

    const result = await service.execPlatformManagedAgent(
      { agentId: 'agent-travel-supervisor', prompt: 'write travel copy' },
      {
        actorUserId,
        maxCredits: 4321,
        resourceOwnerUserId,
        sharedBudget,
      } as any,
    );

    expect(vi.mocked(AgentService)).toHaveBeenLastCalledWith(
      mockDb,
      resourceOwnerUserId,
      undefined,
    );
    expect(mockBindSharedBudget).toHaveBeenCalledWith(expect.stringMatching(/^op_/), sharedBudget, {
      actorUserId,
      workspaceId: undefined,
    });
    expect((service as any).withholdGatewayToken).toBe(true);
    expect(result.token).toBeUndefined();
  });

  it.each(['owner', 'member'] as const)(
    'preserves hosted group history for a new %s turn',
    async (actor) => {
      const owner = 'group-owner';
      const actorUserId = actor === 'owner' ? owner : 'invited-member';
      mockGetAgentConfig.mockResolvedValue({
        agencyConfig: { modelRuntimeMode: 'platform-managed' },
        chatConfig: {},
        id: 'supervisor',
        model: 'deepseek-chat',
        provider: 'deepseek',
        plugins: [],
        systemRole: 'Coordinate group work.',
        userId: owner,
      });
      const previousReply = {
        id: 'previous-reply',
        role: 'assistant',
        content: 'Previous itinerary',
      };
      mockMessageQuery.mockResolvedValue([
        previousReply,
        { id: 'msg-1', role: 'user', content: 'current' },
      ]);
      service = new AiAgentService(mockDb, actorUserId, { resourceOwnerUserId: owner });
      await service.execPlatformManagedAgent(
        {
          agentId: 'supervisor',
          appContext: { groupId: 'group-a' },
          prompt: 'Revise the previous itinerary',
        },
        { actorUserId, resourceOwnerUserId: owner, sharedBudget: {} as any },
      );
      expect(mockMessageQuery).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: 'group-a' }),
        expect.objectContaining({ groupTimeline: true, allowShareVisitor: false }),
      );
      expect(mockCreateOperation.mock.calls[0][0].initialMessages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'previous-reply', content: 'Previous itinerary' }),
        ]),
      );
      expect(
        mockCreateOperation.mock.calls[0][0].initialMessages.filter(
          (message: any) => message.content === 'current',
        ),
      ).toHaveLength(0);
    },
  );

  it.each(['owner', 'member'] as const)(
    'isolates personal memory in hosted %s runs',
    async (actor) => {
      const owner = 'group-owner';
      const actorUserId = actor === 'owner' ? owner : 'invited-member';
      mockGetUserSettings.mockResolvedValue({ memory: { enabled: true } });
      mockGetUserPreference.mockResolvedValue({ lab: { enableSelfLearning: true } });
      mockGetPersona.mockResolvedValue({
        persona: 'Owner private persona',
        tagline: 'private',
        version: 1,
      });
      mockGetAgentConfig.mockResolvedValue({
        agencyConfig: { modelRuntimeMode: 'platform-managed' },
        chatConfig: { memory: { enabled: true } },
        id: 'supervisor',
        model: 'deepseek-chat',
        provider: 'deepseek',
        plugins: [],
        systemRole: 'Coordinate group work.',
        userId: owner,
      });
      service = new AiAgentService(mockDb, actorUserId, { resourceOwnerUserId: owner });
      await service.execPlatformManagedAgent(
        { agentId: 'supervisor', prompt: 'Hello' },
        { actorUserId, resourceOwnerUserId: owner, sharedBudget: {} as any },
      );
      const operation = mockCreateOperation.mock.calls[0][0];
      if (actor === 'member') {
        expect(mockGetPersona).not.toHaveBeenCalled();
        expect(operation.userMemory).toBeUndefined();
        expect(operation.enableExpertise).toBe(false);
      } else {
        expect(operation.userMemory?.memories.persona.narrative).toBe('Owner private persona');
        expect(operation.enableExpertise).toBe(true);
      }
    },
  );

  it('does not inherit platform admin authority from the hosted resource owner', async () => {
    const actorUserId = 'invited-member';
    const resourceOwnerUserId = 'admin-group-owner';
    mockHasGlobalRole.mockImplementation(
      async (_role, principalUserId) => principalUserId === resourceOwnerUserId,
    );
    mockGetAgentConfig.mockResolvedValue({
      agencyConfig: { modelRuntimeMode: 'platform-managed' },
      chatConfig: {},
      id: 'agent-travel-supervisor',
      model: 'deepseek-chat',
      plugins: [],
      provider: 'deepseek',
      systemRole: 'Coordinate travel work.',
      userId: resourceOwnerUserId,
    });
    service = new AiAgentService(mockDb, actorUserId, { resourceOwnerUserId } as any);

    await expect(
      service.execAgent({ agentId: 'agent-travel-supervisor', prompt: 'bypass hosted billing' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mockHasGlobalRole).toHaveBeenCalledWith('super_admin', actorUserId);
    expect(mockCreateOperation).not.toHaveBeenCalled();
  });

  it('rejects a hosted capability whose actor identity does not match the service principal', async () => {
    const actorUserId = 'invited-member';
    const resourceOwnerUserId = 'group-owner';
    mockGetAgentConfig.mockResolvedValue({
      agencyConfig: { modelRuntimeMode: 'platform-managed' },
      chatConfig: {},
      id: 'agent-travel-supervisor',
      model: 'deepseek-chat',
      plugins: [],
      provider: 'deepseek',
      systemRole: 'Coordinate travel work.',
      userId: resourceOwnerUserId,
    });
    service = new AiAgentService(mockDb, actorUserId, { resourceOwnerUserId } as any);

    await expect(
      service.execPlatformManagedAgent(
        { agentId: 'agent-travel-supervisor', prompt: 'write travel copy' },
        {
          actorUserId: 'attacker',
          maxCredits: 4321,
          resourceOwnerUserId,
          sharedBudget: {},
        } as any,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mockCreateOperation).not.toHaveBeenCalled();
  });

  it('allows the hosted group entry without granting the browser a serializable capability', async () => {
    mockGetAgentConfig.mockResolvedValue({
      agencyConfig: { modelRuntimeMode: 'platform-managed' },
      chatConfig: {},
      id: 'agent-travel-supervisor',
      model: 'deepseek-chat',
      plugins: [],
      provider: 'deepseek',
      systemRole: 'Coordinate travel work.',
      userId,
    });
    const execAgent = vi.spyOn(service, 'execAgent').mockResolvedValue({
      assistantMessageId: 'assistant-1',
      operationId: 'operation-1',
      success: true,
      topicId: 'topic-1',
      userMessageId: 'user-message-1',
    } as any);

    await service.execPlatformManagedGroupAgent(
      {
        agentId: 'agent-travel-supervisor',
        groupId: 'group-travel',
        message: 'make a poster',
      },
      { maxCredits: 4321 },
    );

    expect(mockHasGlobalRole).not.toHaveBeenCalled();
    const internalParams = execAgent.mock.calls[0][0];
    expect(hasPlatformManagedExecutionCapability(internalParams)).toBe(true);
    expect(getPlatformManagedExecutionContext(internalParams)).toEqual({ maxCredits: 4321 });
    expect(JSON.stringify(internalParams)).not.toContain('platform-managed-execution-capability');
    expect(JSON.stringify(internalParams)).not.toContain('4321');
  });

  it('reuses the original user message when regenerating a hosted group reply', async () => {
    mockGetAgentConfig.mockResolvedValue({
      agencyConfig: { modelRuntimeMode: 'platform-managed' },
      chatConfig: {},
      id: 'agent-travel-supervisor',
      model: 'deepseek-chat',
      plugins: [],
      provider: 'deepseek',
      systemRole: 'Coordinate travel work.',
      userId,
    });
    const execAgent = vi.spyOn(service, 'execAgent').mockResolvedValue({
      assistantMessageId: 'assistant-2',
      operationId: 'operation-2',
      success: true,
      topicId: 'topic-1',
      userMessageId: 'original-user-message',
    } as any);

    await service.execPlatformManagedGroupAgent(
      {
        agentId: 'agent-travel-supervisor',
        groupId: 'group-travel',
        message: 'make a poster',
        parentMessageId: 'original-user-message',
        topicId: 'topic-1',
      },
      { maxCredits: 4321 },
    );

    expect(execAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        appContext: expect.objectContaining({ groupId: 'group-travel', topicId: 'topic-1' }),
        parentMessageId: 'original-user-message',
        resume: true,
      }),
    );
  });

  it('should merge runtime systemRole for inbox agent when DB systemRole is empty', async () => {
    // Inbox agent with no user-customized systemRole in DB
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-inbox',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      slug: 'inbox',
      systemRole: '', // empty in DB
    });

    await service.execAgent({
      agentId: 'agent-inbox',
      prompt: 'Hello',
    });

    // Verify createOperation was called with agentConfig containing the runtime systemRole
    expect(mockCreateOperation).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.systemRole).toContain('You are Lobe');
    // Model identity is injected by ModelInfoProvider now, not the `{{model}}`
    // template placeholder; `{{date}}` still proves the runtime template merged.
    expect(callArgs.agentConfig.systemRole).toContain('{{date}}');
  });

  it('should pass user response language into web onboarding runtime systemRole', async () => {
    mockGetInfoForAIGeneration.mockResolvedValue({
      responseLanguage: 'zh-CN',
      userName: 'Test User',
    });
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-web-onboarding',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      slug: 'web-onboarding',
      systemRole: '',
    });

    await service.execAgent({
      agentId: 'agent-web-onboarding',
      prompt: '你好',
    });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.agencyConfig?.executionTarget).toBe('none');
    expect(callArgs.agentConfig.systemRole).toContain('Preferred reply language: zh-CN');
    expect(callArgs.agentConfig.systemRole).toContain(
      'Every visible reply, question, and visible choice label must be entirely in zh-CN',
    );
  });

  it('should NOT override user-customized systemRole for inbox agent', async () => {
    const customSystemRole = 'You are a custom assistant.';
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-inbox',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      slug: 'inbox',
      systemRole: customSystemRole, // user has customized
    });

    await service.execAgent({
      agentId: 'agent-inbox',
      prompt: 'Hello',
    });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.systemRole).toBe(customSystemRole);
  });

  it('should not apply runtime config for non-builtin agents', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-custom',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      slug: 'my-custom-slug', // not a builtin slug
      systemRole: '',
    });

    await service.execAgent({
      agentId: 'agent-custom',
      prompt: 'Hello',
    });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    // Should remain empty - no runtime config applied
    expect(callArgs.agentConfig.systemRole).toBe('');
  });

  it('should not apply runtime config for agents without slug', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-no-slug',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      systemRole: '',
    });

    await service.execAgent({
      agentId: 'agent-no-slug',
      prompt: 'Hello',
    });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.systemRole).toBe('');
  });

  it('should persist request trigger metadata on the created user message', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-custom',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      systemRole: '',
    });

    await service.execAgent({
      agentId: 'agent-custom',
      appContext: { topicId: 'topic-1' },
      prompt: 'Hello',
      trigger: RequestTrigger.Onboarding,
    });

    expect(mockMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Hello',
        metadata: { trigger: RequestTrigger.Onboarding },
        role: 'user',
      }),
      undefined,
    );
  });

  it('should inject self-feedback intent tool for Lobe AI when user gate is enabled', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-inbox',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      slug: 'inbox',
      systemRole: '',
    });

    await service.execAgent({
      agentId: 'agent-inbox',
      prompt: 'Hello',
    });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.toolSet.enabledToolIds).toContain(SELF_FEEDBACK_INTENT_IDENTIFIER);
    expect(callArgs.toolSet.manifestMap[SELF_FEEDBACK_INTENT_IDENTIFIER]).toBeDefined();
    expect(callArgs.toolSet.sourceMap[SELF_FEEDBACK_INTENT_IDENTIFIER]).toBe('builtin');
  });

  it('should not inject self-feedback intent tool for custom agents without agent self-iteration', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-custom',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      slug: 'custom-agent',
      systemRole: '',
    });

    await service.execAgent({
      agentId: 'agent-custom',
      prompt: 'Hello',
    });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.toolSet.enabledToolIds).not.toContain(SELF_FEEDBACK_INTENT_IDENTIFIER);
    expect(callArgs.toolSet.manifestMap[SELF_FEEDBACK_INTENT_IDENTIFIER]).toBeUndefined();
    expect(callArgs.toolSet.sourceMap[SELF_FEEDBACK_INTENT_IDENTIFIER]).toBeUndefined();
  });

  it('should inject self-feedback intent tool for custom agents with agent self-iteration', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: { selfIteration: { enabled: true } },
      id: 'agent-custom',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      slug: 'custom-agent',
      systemRole: '',
    });

    await service.execAgent({
      agentId: 'agent-custom',
      prompt: 'Hello',
    });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.toolSet.enabledToolIds).toContain(SELF_FEEDBACK_INTENT_IDENTIFIER);
    expect(callArgs.toolSet.manifestMap[SELF_FEEDBACK_INTENT_IDENTIFIER]).toBeDefined();
    expect(callArgs.toolSet.sourceMap[SELF_FEEDBACK_INTENT_IDENTIFIER]).toBe('builtin');
  });

  it('should inject page-agent runtime for regular agents in page scope', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: { enableHistoryCount: true },
      id: 'agent-custom',
      model: 'gpt-4',
      plugins: ['lobe-agent-documents'],
      provider: 'openai',
      systemRole: 'Custom role.',
    });

    await service.execAgent({
      agentId: 'agent-custom',
      appContext: {
        documentId: 'docs-1',
        scope: 'page',
        topicId: 'topic-1',
      },
      prompt: 'Rewrite this page',
    });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.appContext).toMatchObject({
      documentId: 'docs-1',
      scope: 'page',
    });
    expect(callArgs.agentConfig.plugins).toEqual([PageAgentIdentifier, 'lobe-agent-documents']);
    expect(callArgs.agentConfig.chatConfig.enableHistoryCount).toBe(false);
    expect(callArgs.agentConfig.systemRole).toContain('Custom role.');
    expect(callArgs.agentConfig.systemRole).toContain(
      'You are a helpful document (page) editing assistant',
    );

    expect(createServerAgentToolsEngine).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        agentConfig: expect.objectContaining({
          plugins: [PageAgentIdentifier, 'lobe-agent-documents'],
        }),
      }),
    );
  });

  it('should normalize task identifier from appContext before creating runtime operation', async () => {
    mockResolveTask.mockResolvedValue({ id: 'task-row-1', identifier: 'T-1' });
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-task',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      systemRole: '',
    });

    await service.execAgent({
      agentId: 'agent-task',
      appContext: {
        defaultTaskAssigneeAgentId: 'agt_inbox',
        scope: 'task',
        taskId: 'T-1',
        topicId: 'topic-1',
      },
      prompt: 'Show current task',
    });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(mockResolveTask).toHaveBeenCalledWith('T-1');
    expect(callArgs.appContext).toMatchObject({
      defaultTaskAssigneeAgentId: 'agt_inbox',
      scope: 'task',
      taskId: 'task-row-1',
      topicId: 'topic-1',
    });
    expect(callArgs.initialContext.initialContext.taskManager.contextPrompt).toContain(
      'Default Lobe AI agent id: agt_inbox',
    );
  });

  it.each(['task', 'goal'] as const)(
    'loads only the work topic rather than the whole group during a hosted %s run',
    async (kind) => {
      service = new AiAgentService(mockDb, 'user-1');
      mockResolveTask.mockResolvedValue({ id: 'task-row-1', identifier: 'T-1' });
      mockGetAgentConfig.mockResolvedValue({
        agencyConfig: { modelRuntimeMode: 'platform-managed' },
        chatConfig: {},
        id: 'worker',
        model: 'deepseek-chat',
        provider: 'deepseek',
        plugins: [],
        systemRole: '',
        userId: 'user-1',
      });
      await service.execPlatformManagedAgent(
        {
          agentId: 'worker',
          taskId: kind === 'task' ? 'task-row-1' : undefined,
          appContext: {
            groupId: 'group-a',
            topicId: 'topic-1',
            ...(kind === 'goal' ? { viewedGoal: 'goal-1' } : {}),
          },
          prompt: 'Perform assigned work',
        },
        { actorUserId: 'user-1', resourceOwnerUserId: 'user-1', sharedBudget: {} as any },
      );
      expect(mockMessageQuery).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: 'group-a', topicId: 'topic-1' }),
        expect.objectContaining({ groupTimeline: false }),
      );
    },
  );

  it('should inject lobe-agent when history has audio and model lacks native audio support', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-custom',
      model: 'text-only',
      plugins: [],
      provider: 'openai',
      systemRole: '',
    });
    mockMessageQuery.mockResolvedValue([
      {
        audioList: [{ alt: 'audio.mp3', id: 'file-audio', url: 'https://example.com/audio.mp3' }],
        id: 'history-audio',
        role: 'user',
      },
    ]);

    await service.execAgent({
      agentId: 'agent-custom',
      appContext: { topicId: 'topic-1' },
      prompt: 'What is said in the previous audio?',
    });

    expect(createServerAgentToolsEngine).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        agentConfig: expect.objectContaining({
          plugins: expect.arrayContaining(['lobe-agent']),
        }),
      }),
    );
  });

  it('should not inject lobe-agent when the LobeHub routed model supports audio natively', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-custom',
      model: 'gemini-3.1-flash-lite-preview',
      plugins: [],
      provider: 'lobehub',
      systemRole: '',
    });
    mockMessageQuery.mockResolvedValue([
      {
        audioList: [{ id: 'file-audio', url: 'https://example.com/audio.mp3' }],
        id: 'history-audio',
        role: 'user',
      },
    ]);

    await service.execAgent({
      agentId: 'agent-custom',
      appContext: { topicId: 'topic-1' },
      prompt: 'What is said in the previous audio?',
    });

    const callArgs = vi.mocked(createServerAgentToolsEngine).mock.calls[0][1];
    expect(callArgs.agentConfig.plugins).not.toContain('lobe-agent');
  });
});
