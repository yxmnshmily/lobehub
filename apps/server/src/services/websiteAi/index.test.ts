import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getWebsiteAiCapabilities,
  WEBSITE_AI_CONTENT_BLOCKED,
  WEBSITE_AI_MODERATION_UNAVAILABLE,
  WEBSITE_AI_PRODUCTION_CAPABILITY_UNAVAILABLE,
  WebsiteAiService,
} from './index';

const mocks = vi.hoisted(() => ({
  assertCredits: vi.fn(),
  beginPreviousTurn: vi.fn(),
  createSharedBudget: vi.fn(),
  createStreamManager: vi.fn(),
  execGroupAgent: vi.fn(),
  getAgentConfig: vi.fn(),
  findGroup: vi.fn(),
  findOperation: vi.fn(),
  findTopic: vi.fn(),
  getRoster: vi.fn(),
  getSupervisor: vi.fn(),
  listPlatformModels: vi.fn(),
  recordCompletion: vi.fn(),
  recordModeration: vi.fn(),
  resolvePricing: vi.fn(),
  reserveAdmission: vi.fn(),
  scanModeration: vi.fn(),
  settleStep: vi.fn(),
}));

vi.mock('@/database/models/chatGroup', () => ({
  ChatGroupModel: class {
    findByClientId = mocks.findGroup;
    getGroupAgentsWithMeta = mocks.getRoster;
    getSupervisorAgentId = mocks.getSupervisor;
  },
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    findById = mocks.findTopic;
  },
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: class {
    findById = mocks.findOperation;
    recordCompletion = mocks.recordCompletion;
    reserveWebsiteAiAdmission = mocks.reserveAdmission;
  },
}));
vi.mock('@/database/models/platformModeration', () => ({
  PlatformModerationAuditModel: class {
    recordScanResult = mocks.recordModeration;
  },
}));
vi.mock('@/server/services/platformModeration', () => ({
  scanPlatformContent: mocks.scanModeration,
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: class {
    execPlatformManagedGroupAgent = mocks.execGroupAgent;
  },
}));
vi.mock('@/server/services/agent', () => ({
  AgentService: class {
    getAgentConfig = mocks.getAgentConfig;
  },
}));
vi.mock('@/server/services/platformAiRuntime', () => ({
  PlatformAiRuntime: class {
    listEnabledModels = mocks.listPlatformModels;
  },
}));
vi.mock('@/server/services/platformUsageBilling/settlement', () => ({
  PlatformManagedTextUsageSettlement: class {
    assertCanCallProvider = mocks.assertCredits;
    settleStep = mocks.settleStep;
  },
}));
vi.mock('@/server/services/platformUsageBilling/modelPricing', () => ({
  resolvePlatformModelPricing: mocks.resolvePricing,
}));
vi.mock('@/server/services/platformUsageBilling/sharedBudget', () => ({
  createPlatformUsageSharedBudget: mocks.createSharedBudget,
}));
vi.mock('@/server/services/websiteAi/previousTurn', () => ({
  websiteAiPreviousTurnStore: {
    begin: mocks.beginPreviousTurn,
    read: vi.fn(),
  },
}));
vi.mock('@/server/modules/AgentRuntime/factory', () => ({
  createStreamEventManager: mocks.createStreamManager,
}));

const expectNoModelOrBillingWork = () => {
  expect(mocks.findGroup).not.toHaveBeenCalled();
  expect(mocks.getRoster).not.toHaveBeenCalled();
  expect(mocks.getSupervisor).not.toHaveBeenCalled();
  expect(mocks.reserveAdmission).not.toHaveBeenCalled();
  expect(mocks.assertCredits).not.toHaveBeenCalled();
  expect(mocks.execGroupAgent).not.toHaveBeenCalled();
  expect(mocks.settleStep).not.toHaveBeenCalled();
  expect(mocks.recordCompletion).not.toHaveBeenCalled();
  expect(mocks.listPlatformModels).not.toHaveBeenCalled();
};

describe('WebsiteAiService fail-closed boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordModeration.mockResolvedValue({ id: 'moderation-audit-1' });
    mocks.scanModeration.mockReturnValue({
      action: 'allow',
      findings: [],
      fingerprint: 'a'.repeat(64),
      preview: '旅游请求',
    });
    mocks.findGroup.mockResolvedValue({
      content: '根据请求安排旅游助理。',
      id: 'group-1',
      visibility: 'private',
    });
    mocks.getSupervisor.mockResolvedValue('agent-supervisor');
    mocks.getRoster.mockResolvedValue([
      {
        agentId: 'agent-copy',
        clientId: 'default-travel-copywriter',
        description: '旅游文案',
        role: 'member',
        title: '旅游文案助理',
      },
    ]);
    mocks.getAgentConfig.mockImplementation(async (agentId: string) => ({
      agencyConfig: { modelRuntimeMode: 'platform-managed', modelSelectionPolicy: 'fixed' },
      id: agentId,
      model: agentId === 'agent-supervisor' ? 'supervisor-model' : 'copy-model',
      plugins: agentId === 'agent-copy' ? ['lobe-travel-production', 'tourism-copywriting'] : [],
      provider: 'platform-provider',
    }));
    mocks.resolvePricing.mockImplementation(async (_db: unknown, reference: unknown) => ({
      ...(reference as object),
      pricing: { units: [{ name: 'textInput', rate: 1, strategy: 'fixed' }] },
    }));
    mocks.assertCredits.mockResolvedValue(undefined);
    mocks.reserveAdmission.mockResolvedValue('reserved');
    mocks.createSharedBudget.mockResolvedValue({ shared: true });
    mocks.execGroupAgent.mockResolvedValue({
      assistantMessageId: 'assistant-1',
      isCreateNewTopic: true,
      operationId: 'operation-1',
      success: true,
      topicId: 'topic-1',
      userMessageId: 'user-message-1',
    });
    mocks.recordCompletion.mockResolvedValue(true);
    mocks.beginPreviousTurn.mockResolvedValue({ key: 'previous-turn', owner: 'owner-1' });
  });

  it('opens only copy when the private group, hosted models, exact prices, and Credits are ready', async () => {
    await expect(getWebsiteAiCapabilities({} as any, 'user-1')).resolves.toEqual({
      copy: { available: true },
      document: { available: false, reasonCode: 'CAPABILITY_UNAVAILABLE' },
      image: { available: false, reasonCode: 'CAPABILITY_UNAVAILABLE' },
      video: { available: false, reasonCode: 'CAPABILITY_UNAVAILABLE' },
    });

    expect(mocks.findGroup).toHaveBeenCalledOnce();
    expect(mocks.getSupervisor).toHaveBeenCalledWith('group-1');
    expect(mocks.resolvePricing).toHaveBeenCalledTimes(2);
    expect(mocks.assertCredits).toHaveBeenCalledOnce();
  });

  it('keeps copy closed when exact pricing is missing', async () => {
    mocks.resolvePricing.mockResolvedValueOnce(undefined);

    await expect(getWebsiteAiCapabilities({} as any, 'user-1')).resolves.toMatchObject({
      copy: { available: false, reasonCode: 'CAPABILITY_UNAVAILABLE' },
    });
    expect(mocks.createSharedBudget).not.toHaveBeenCalled();
    expect(mocks.execGroupAgent).not.toHaveBeenCalled();
  });

  it('starts a copy-only group run with a stable request budget and settlement-gated text', async () => {
    const result = await new WebsiteAiService({} as any, 'user-1').start({
      maxCredits: 10_000,
      message: '写一篇西藏旅游文案',
      requestIdentity: 'website-ai:v1:stable-request-digest',
    } as any);

    expect(mocks.createSharedBudget).toHaveBeenCalledWith(expect.anything(), 'user-1', {
      expiresAt: expect.any(Date),
      maxCredits: 10_000,
      requestIdentity: 'website-ai:v1:stable-request-digest',
      workspaceId: undefined,
    });
    expect(mocks.execGroupAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-supervisor',
        groupId: 'group-1',
        message: '写一篇西藏旅游文案',
        suppressSignal: true,
        toolDispatchPolicy: expect.objectContaining({
          finishAfterSteps: true,
          steps: [
            expect.objectContaining({
              memberToolDispatchPolicies: {
                'agent-copy': { cursor: 0, finishAfterSteps: true, steps: [], version: 1 },
              },
            }),
          ],
          version: 1,
        }),
      }),
      { maxCredits: 10_000, sharedBudget: { shared: true } },
    );
    expect(result).toMatchObject({
      operationId: 'operation-1',
      previousTurnHandle: { key: 'previous-turn', owner: 'owner-1' },
      responseDelivery: 'settlement-gated-text',
      topicId: 'topic-1',
    });
  });

  it('rejects non-copy production before reserving Credits or calling a provider', async () => {
    await expect(
      new WebsiteAiService({} as any, 'user-1').start({
        maxCredits: 10_000,
        message: '生成一张西藏旅游封面图',
        requestIdentity: 'website-ai:v1:image-request',
      } as any),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    expect(mocks.reserveAdmission).not.toHaveBeenCalled();
    expect(mocks.createSharedBudget).not.toHaveBeenCalled();
    expect(mocks.execGroupAgent).not.toHaveBeenCalled();
  });

  it.each([
    ['document', '制作一份川西行程文档'],
    ['image', '生成一张西藏旅游封面图'],
    ['video', '制作一条西藏旅游视频'],
    ['consultation', '只咨询川西路线怎么走，不执行任何工具'],
  ])(
    'rejects %s before group execution, reservation, provider, or debit',
    async (_kind, message) => {
      const error = await new WebsiteAiService({} as any, 'user-1')
        .start({
          maxCredits: 10_000,
          message,
          requestIdentity: `website-ai:v1:${_kind}-unavailable`,
        })
        .catch((cause) => cause);

      expect(error).toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: `[${WEBSITE_AI_PRODUCTION_CAPABILITY_UNAVAILABLE.code}] ${WEBSITE_AI_PRODUCTION_CAPABILITY_UNAVAILABLE.message}`,
      });
      expect(mocks.recordModeration).toHaveBeenCalledOnce();
      expectNoModelOrBillingWork();
    },
  );

  it('audits only the bounded scanner projection before returning unavailable', async () => {
    const rawMessage = '客户姓名张三，只咨询川西路线';
    mocks.scanModeration.mockReturnValue({
      action: 'review',
      findings: [{ category: 'name', count: 1, severity: 'medium' }],
      fingerprint: 'b'.repeat(64),
      preview: '客户姓名 [NAME]，只咨询川西路线',
      providerSignal: { code: 'PRIVATE_CODE', source: 'PRIVATE_SOURCE' },
    });

    await expect(
      new WebsiteAiService({} as any, 'user-1').start({
        maxCredits: 10_000,
        message: rawMessage,
        requestIdentity: 'website-ai:v1:moderation-projection',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringContaining('CAPABILITY_UNAVAILABLE'),
    });

    expect(mocks.scanModeration).toHaveBeenCalledWith({ text: rawMessage });
    expect(mocks.recordModeration).toHaveBeenCalledWith({
      scanResult: {
        action: 'review',
        findings: [{ category: 'name', count: 1, severity: 'medium' }],
        fingerprint: 'b'.repeat(64),
        preview: '客户姓名 [NAME]，只咨询川西路线',
      },
      sourceId: expect.stringMatching(/^website_ai_admission_/),
      sourceType: 'chat',
      userId: 'user-1',
    });
    expect(JSON.stringify(mocks.recordModeration.mock.calls)).not.toMatch(
      /客户姓名张三|PRIVATE_CODE|PRIVATE_SOURCE/,
    );
    expectNoModelOrBillingWork();
  });

  it('blocks unsafe content without exposing it or doing downstream work', async () => {
    const rawSecret = 'OPENAI_API_KEY=sk-live-RAW_SECRET_MUST_NOT_LEAK';
    mocks.scanModeration.mockReturnValue({
      action: 'block',
      findings: [{ category: 'credential', count: 1, severity: 'critical' }],
      fingerprint: 'c'.repeat(64),
      preview: '[CREDENTIAL]',
    });

    const error = await new WebsiteAiService({} as any, 'user-1')
      .start({
        maxCredits: 10_000,
        message: rawSecret,
        requestIdentity: 'website-ai:v1:blocked-request',
      })
      .catch((cause) => cause);

    expect(error).toMatchObject({
      code: 'BAD_REQUEST',
      message: `[${WEBSITE_AI_CONTENT_BLOCKED.code}] ${WEBSITE_AI_CONTENT_BLOCKED.message}`,
    });
    expect(error.message).not.toContain(rawSecret);
    expectNoModelOrBillingWork();
  });

  it('fails closed without leaking an audit persistence error', async () => {
    mocks.recordModeration.mockRejectedValueOnce(
      new Error('database failed for passenger@example.com sk-private-db-key'),
    );

    const error = await new WebsiteAiService({} as any, 'user-1')
      .start({
        maxCredits: 10_000,
        message: '只咨询川西路线',
        requestIdentity: 'website-ai:v1:audit-error',
      })
      .catch((cause) => cause);

    expect(error).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: `[${WEBSITE_AI_MODERATION_UNAVAILABLE.code}] ${WEBSITE_AI_MODERATION_UNAVAILABLE.message}`,
    });
    expect(JSON.stringify(error)).not.toMatch(/passenger@example|sk-private/);
    expectNoModelOrBillingWork();
  });

  it('reports every model-backed public capability as unavailable', async () => {
    await expect(getWebsiteAiCapabilities({} as any)).resolves.toEqual({
      copy: { available: false, reasonCode: 'CAPABILITY_UNAVAILABLE' },
      document: { available: false, reasonCode: 'CAPABILITY_UNAVAILABLE' },
      image: { available: false, reasonCode: 'CAPABILITY_UNAVAILABLE' },
      video: { available: false, reasonCode: 'CAPABILITY_UNAVAILABLE' },
    });
    expectNoModelOrBillingWork();
  });

  it('keeps operation ownership checks available without model execution', async () => {
    mocks.findOperation.mockResolvedValueOnce({ id: 'operation-owned' });
    await expect(
      new WebsiteAiService({} as any, 'user-1').assertOwnOperation('operation-owned'),
    ).resolves.toEqual({ id: 'operation-owned' });

    mocks.findOperation.mockResolvedValueOnce(undefined);
    await expect(
      new WebsiteAiService({} as any, 'user-1').assertOwnOperation('operation-hidden'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expectNoModelOrBillingWork();
  });

  it('keeps the stream manager available without model execution', () => {
    const manager = { subscribeStreamEvents: vi.fn() };
    mocks.createStreamManager.mockReturnValueOnce(manager);

    expect(new WebsiteAiService({} as any, 'user-1').streamManager()).toBe(manager);
    expectNoModelOrBillingWork();
  });
});
