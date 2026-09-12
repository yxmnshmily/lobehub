// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRuntimeService } from '@/server/services/agentRuntime';

import { aiAgentRouter } from '../aiAgent';

const mocks = vi.hoisted(() => ({
  getAccessiblePublishedAssistantRequest: vi.fn(),
  listAccessibleTopics: vi.fn(),
  ownedFiles: vi.fn(),
  createBudget: vi.fn(),
  createSponsoredBudget: vi.fn(),
  execPlatformManagedAgent: vi.fn(),
  execGroupAgent: vi.fn(),
  execPlatformManagedGroupAgent: vi.fn(),
  getMessagesAndTopics: vi.fn(),
  authorizeHostedRun: vi.fn(),
  resolveTarget: vi.fn(),
  resolveAdmission: vi.fn(),
  runIdempotently: vi.fn(),
  findResultTopic: vi.fn(),
}));

vi.mock('@/server/services/groupConversationAccess/conversationRepository', () => ({
  GroupConversationAccessRepository: vi.fn(() => ({
    getAccessiblePublishedAssistantRequest: mocks.getAccessiblePublishedAssistantRequest,
    listAccessibleTopics: mocks.listAccessibleTopics,
  })),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(() => ({ findByIds: mocks.ownedFiles })),
}));
vi.mock('@lobechat/database', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  ChatGroupSponsoredCreditModel: vi.fn(() => ({ resolveAdmission: mocks.resolveAdmission })),
}));
vi.mock('@/server/services/groupConversationAccess/principal', () => ({
  resolveGroupConversationPrincipal: mocks.resolveAdmission,
}));
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => ({
    query: {
      topics: { findFirst: mocks.findResultTopic },
      users: { findFirst: async () => ({ phone: '13800000000', phoneNumberVerified: true }) },
    },
  })),
}));
vi.mock('@/envs/auth', () => ({ authEnv: { AUTH_SECRET: 'group-chat-test-secret' } }));
vi.mock('@/server/routers/lambda/_helpers/workspaceAgentGuard', () => ({
  assertCanUseWorkspaceAgent: vi.fn(),
}));
vi.mock('@/server/routers/lambda/_helpers/conversationResourceGuard', () => ({
  assertCanUseMessageTargets: vi.fn(),
  assertCanUseTopicTargets: vi.fn(),
  assertCanViewMessageTargets: vi.fn(),
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({
    execAgent: mocks.execGroupAgent,
    execGroupAgent: mocks.execGroupAgent,
    execPlatformManagedAgent: mocks.execPlatformManagedAgent,
    execPlatformManagedGroupAgent: mocks.execPlatformManagedGroupAgent,
  })),
}));
vi.mock('@/server/services/aiChat', () => ({
  AiChatService: vi.fn().mockImplementation(() => ({
    getMessagesAndTopics: mocks.getMessagesAndTopics,
  })),
}));
vi.mock('@/server/services/platformUsageBilling/groupChat', async (importOriginal) => ({
  ...(await importOriginal()),
  resolveHostedTravelGroupTarget: mocks.resolveTarget,
}));
vi.mock(
  '@/server/services/platformUsageBilling/hostedGroupOperationAccess',
  async (importOriginal) => ({
    ...(await importOriginal()),
    authorizeHostedGroupRun: mocks.authorizeHostedRun,
  }),
);
vi.mock('@/server/services/platformUsageBilling/sharedBudget', () => ({
  createPlatformUsageSharedBudget: mocks.createBudget,
  createSponsoredPlatformUsageSharedBudget: mocks.createSponsoredBudget,
}));
vi.mock('@/server/services/websiteAi/idempotency', () => ({
  runWebsiteAiStartIdempotently: mocks.runIdempotently,
}));

const userId = 'user-a';
const groupId = 'group-a';
const agentId = 'agent-supervisor';
const copywriterId = 'agent-copywriter';
const result = {
  assistantMessageId: 'message-assistant',
  isCreateNewTopic: true,
  operationId: 'operation-a',
  success: true,
  topicId: 'topic-a',
  userMessageId: 'message-user',
};

const caller = () => aiAgentRouter.createCaller({ jwtPayload: { userId }, userId } as any);

const useInvitedMemberPrincipal = () => {
  mocks.resolveAdmission.mockResolvedValue({
    actorUserId: userId,
    chatGroupId: groupId,
    membershipVersion: 4,
    payerUserId: 'group-owner',
    policyVersion: 2,
    workspaceId: null,
  });
  return mocks.resolveTarget.mockResolvedValue({
    groupId,
    platformModel: { model: 'platform-model', provider: 'platform-provider' },
    principal: {
      actorUserId: userId,
      billingUserId: 'group-owner',
      groupId,
      kind: 'owner-sponsored-member',
      membershipVersion: 4,
      policyVersion: 2,
      resourceOwnerUserId: 'group-owner',
      workspaceId: null,
    },
    routingMembers: [
      { clientId: 'group-supervisor', id: agentId },
      { clientId: 'default-travel-copywriter', id: copywriterId },
    ],
    supervisorId: agentId,
  });
};

describe('execGroupAgent hosted billing contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAccessibleTopics.mockResolvedValue({ items: [], nextCursor: null });
    mocks.findResultTopic.mockResolvedValue({ id: 'topic-a' });
    mocks.getMessagesAndTopics.mockResolvedValue({ messages: [], topics: [] });
    mocks.resolveTarget.mockResolvedValue({
      groupId,
      platformModel: { model: 'platform-model', provider: 'platform-provider' },
      principal: {
        actorUserId: userId,
        billingUserId: userId,
        groupId,
        kind: 'owner',
        membershipVersion: 0,
        policyVersion: 0,
        resourceOwnerUserId: userId,
        workspaceId: null,
      },
      routingMembers: [
        { clientId: 'group-supervisor', id: agentId },
        { clientId: 'default-travel-copywriter', id: copywriterId },
      ],
      supervisorId: agentId,
    });
    mocks.createBudget.mockResolvedValue({});
    mocks.createSponsoredBudget.mockResolvedValue({});
    mocks.resolveAdmission.mockResolvedValue({
      actorUserId: 'invited-member',
      chatGroupId: groupId,
      membershipVersion: 1,
      payerUserId: userId,
      policyVersion: 1,
      workspaceId: null,
    });
    mocks.execPlatformManagedGroupAgent.mockResolvedValue(result);
    mocks.execPlatformManagedAgent.mockResolvedValue(result);
    mocks.execGroupAgent.mockResolvedValue(result);
    mocks.runIdempotently.mockImplementation(async ({ start }) => start());
    mocks.authorizeHostedRun.mockResolvedValue({
      completedAt: null,
      error: null,
      operationId: 'internal-operation-id',
      startedAt: new Date('2026-09-04T00:00:00.000Z'),
      status: 'running',
      updatedAt: new Date('2026-09-04T00:01:00.000Z'),
    });
  });

  it('accepts a hosted send without a per-request Credits ceiling', async () => {
    const response = await caller().execGroupAgent({
      agentId,
      billing: { idempotencyKey: 'uncapped-send' },
      groupId,
      message: '你好',
    } as any);
    expect(response).toMatchObject(result);
    expect(mocks.createBudget).toHaveBeenCalledWith(
      expect.anything(),
      userId,
      expect.objectContaining({ maxCredits: undefined }),
    );
    expect(mocks.execPlatformManagedGroupAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxCredits: undefined, sharedBudget: expect.anything() }),
    );
  });

  it('derives a server-owned budget and uses only the hosted entry for the default group', async () => {
    const response = await caller().execGroupAgent({
      agentId,
      billing: { idempotencyKey: 'browser-request-1', maxCredits: 500 },
      groupId,
      message: '写一篇西藏旅游文案',
    } as any);
    expect(response).toMatchObject(result);
    expect(JSON.stringify(response)).not.toContain('group-chat:v2:');

    expect(mocks.createBudget).toHaveBeenCalledWith(
      expect.anything(),
      userId,
      expect.objectContaining({
        maxCredits: undefined,
        requestIdentity: expect.stringMatching(/^group-chat:v2:[a-f0-9]{64}$/),
      }),
    );
    expect(mocks.execPlatformManagedGroupAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId, groupId, message: '写一篇西藏旅游文案' }),
      expect.objectContaining({ maxCredits: undefined, sharedBudget: expect.anything() }),
    );
    expect(mocks.execGroupAgent).not.toHaveBeenCalled();
  });

  it('preserves owner files and topic creation on the legacy hosted entry', async () => {
    await caller().execGroupAgent({
      agentId,
      billing: { idempotencyKey: 'owner-rich-request', maxCredits: 500 },
      files: ['owner-file'],
      groupId,
      message: '继续完善文案',
      newTopic: { title: '主题', topicMessageIds: ['owner-message'] },
      topicId: 'owner-topic',
    } as any);

    expect(mocks.execPlatformManagedGroupAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        files: ['owner-file'],
        newTopic: { title: '主题', topicMessageIds: ['owner-message'] },
        topicId: 'owner-topic',
      }),
      expect.anything(),
    );
  });

  it.each([
    ['files', { files: ['owner-private-file'] }],
    ['topicId', { topicId: 'owner-private-topic' }],
    [
      'newTopic',
      { newTopic: { title: '偷用群主上下文', topicMessageIds: ['owner-private-message'] } },
    ],
  ] as const)(
    'rejects invited-member %s context on the legacy hosted entry',
    async (_name, richContext) => {
      mocks.resolveTarget.mockResolvedValue({
        groupId,
        principal: {
          actorUserId: 'invited-member',
          billingUserId: userId,
          groupId,
          kind: 'owner-sponsored-member',
          membershipVersion: 1,
          policyVersion: 1,
          resourceOwnerUserId: userId,
          workspaceId: null,
        },
        routingMembers: [{ clientId: 'group-supervisor', id: agentId }],
        supervisorId: agentId,
      });

      await expect(
        caller().execGroupAgent({
          agentId,
          billing: { idempotencyKey: 'member-rich-request', maxCredits: 500 },
          groupId,
          message: '读取群主上下文',
          ...richContext,
        } as any),
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
      expect(mocks.createBudget).not.toHaveBeenCalled();
      expect(mocks.execPlatformManagedGroupAgent).not.toHaveBeenCalled();
    },
  );

  it('fails closed before reserving Credits when a non-owner principal reaches this version', async () => {
    mocks.resolveTarget.mockResolvedValue({
      groupId,
      principal: {
        actorUserId: 'invited-member',
        billingUserId: userId,
        groupId,
        kind: 'owner-sponsored-member',
        membershipVersion: 1,
        policyVersion: 1,
        resourceOwnerUserId: userId,
        workspaceId: null,
      },
      routingMembers: [{ clientId: 'group-supervisor', id: agentId }],
      supervisorId: agentId,
    });

    await expect(
      caller().execAgent({
        agentId,
        appContext: { groupId },
        billing: { idempotencyKey: 'member-request-1', maxCredits: 500 },
        prompt: '写一篇旅游文案',
      } as any),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(mocks.createBudget).not.toHaveBeenCalled();
    expect(mocks.execPlatformManagedAgent).not.toHaveBeenCalled();
  });

  it.each(['agentId', 'fileIds', 'topicId', 'parentMessageId'])(
    'rejects caller-controlled %s on the member-safe hosted start',
    async (field) => {
      await expect(
        (caller() as any).startHostedTravelGroupTask({
          billing: { idempotencyKey: 'member-safe-start' },
          groupId,
          prompt: '写一篇旅游文案',
          [field]: 'attacker-controlled',
        }),
      ).rejects.toBeInstanceOf(TRPCError);
      expect(mocks.execPlatformManagedAgent).not.toHaveBeenCalled();
    },
  );

  it('starts the hosted group through the server-resolved supervisor without exposing it', async () => {
    useInvitedMemberPrincipal();
    mocks.execPlatformManagedAgent.mockResolvedValueOnce({
      ...result,
      agentId,
      token: 'owner-gateway-jwt',
    });

    const response = await (caller() as any).startHostedTravelGroupTask({
      billing: { idempotencyKey: 'member-safe-start', maxCredits: 500 },
      groupId,
      prompt: '写一篇旅游文案',
    });

    expect(mocks.resolveTarget).toHaveBeenCalledWith(expect.objectContaining({ groupId, userId }));
    expect(mocks.resolveTarget.mock.calls[0]?.[0]).not.toHaveProperty('agentId');
    expect(mocks.execPlatformManagedAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId,
        appContext: expect.objectContaining({ groupId, orchestrationRole: 'supervisor' }),
      }),
      expect.anything(),
    );
    expect(response).toEqual({
      accepted: true,
      resultTopicId: 'topic-a',
      runHandle: expect.stringMatching(/^[\w-]{43}$/),
    });
    expect(Object.keys(response).sort()).toEqual(['accepted', 'resultTopicId', 'runHandle']);
    const hostedRun = mocks.execPlatformManagedAgent.mock.calls[0]?.[0]?.appContext?.hostedGroupRun;
    expect(hostedRun).toMatchObject({
      actorUserIdSnapshot: userId,
      groupId,
      membershipVersion: 4,
      ownerUserIdSnapshot: 'group-owner',
    });
    expect(hostedRun.handleHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(hostedRun)).not.toContain(response.runHandle);
  });

  it('uses the sponsorship policy ceiling without creating an automatic budget', async () => {
    useInvitedMemberPrincipal();
    mocks.resolveAdmission.mockResolvedValueOnce({
      actorUserId: userId,
      chatGroupId: groupId,
      groupPeriodLimitCredits: 2_000,
      maxCreditsPerPeriod: 1_500,
      maxCreditsPerRequest: 500,
      membershipVersion: 4,
      payerUserId: 'group-owner',
      policyVersion: 2,
      workspaceId: null,
    });

    await expect(
      (caller() as any).startHostedTravelGroupTask({
        billing: { idempotencyKey: 'member-automatic-budget' },
        groupId,
        prompt: '请只回复：测试成功',
      }),
    ).resolves.toMatchObject({ accepted: true });

    expect(mocks.createSponsoredBudget).toHaveBeenCalledWith(
      expect.anything(),
      userId,
      expect.objectContaining({ maxCredits: 500 }),
    );
    expect(mocks.execPlatformManagedAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxCredits: 500, sharedBudget: expect.anything() }),
    );
  });

  it('regenerates the server-saved original request in its original archive, not the latest topic', async () => {
    useInvitedMemberPrincipal();
    const original = {
      prompt: '原始要求\n\n[附件](</api/file/proxy/original>)',
      mentionedAgentIds: [],
      topicId: 'original-topic',
    };
    mocks.getAccessiblePublishedAssistantRequest.mockResolvedValueOnce(original);
    mocks.listAccessibleTopics.mockResolvedValue({ items: [{ id: 'newer-topic' }] });
    await caller().startHostedTravelGroupTask({
      billing: { idempotencyKey: 'retry-original', maxCredits: 500 },
      groupId,
      regenerateMessageId: 'a'.repeat(64),
    });
    expect(mocks.getAccessiblePublishedAssistantRequest).toHaveBeenCalledWith(
      userId,
      groupId,
      'a'.repeat(64),
    );
    expect(mocks.execPlatformManagedAgent.mock.calls[0][0]).toMatchObject({
      prompt: original.prompt,
      appContext: {
        topicId: original.topicId,
        hostedGroupRun: {
          originalRequest: { prompt: original.prompt, mentionedAgentIds: [] },
        },
      },
    });
    await expect(
      caller().startHostedTravelGroupTask({
        billing: { idempotencyKey: 'tampered-retry' },
        groupId,
        regenerateMessageId: 'a'.repeat(64),
        prompt: '替换原文',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('continues the current accessible group conversation without creating another topic', async () => {
    useInvitedMemberPrincipal();
    mocks.listAccessibleTopics.mockResolvedValue({
      items: [{ id: 'existing-group-topic' }],
      nextCursor: null,
    });
    await caller().startHostedTravelGroupTask({
      billing: { idempotencyKey: 'member-continue', maxCredits: 500 },
      groupId,
      prompt: '继续上一条消息',
    });
    expect(mocks.listAccessibleTopics).toHaveBeenCalledWith(userId, groupId, {
      recent: true,
      limit: 1,
    });
    expect(mocks.execPlatformManagedAgent.mock.calls[0][0].appContext.topicId).toBe(
      'existing-group-topic',
    );
  });

  it.each([
    '请帮我规划一份多日游行程，按天列出路线、交通、体验和休息时间。',
    '出个 短视频文案吧',
    '根据之前的文案，做一个封面9:16，象鼻山当主视觉',
  ])('creates a separate topic for an independent request: %s', async (prompt) => {
    useInvitedMemberPrincipal();
    mocks.listAccessibleTopics.mockResolvedValue({
      items: [{ id: 'old-greeting-topic', title: '简单问候对话' }],
      nextCursor: null,
    });
    await caller().startHostedTravelGroupTask({
      billing: { idempotencyKey: 'independent-request', maxCredits: 500 },
      groupId,
      prompt,
    });
    expect(mocks.execPlatformManagedAgent.mock.calls[0][0].appContext.topicId).toBeUndefined();
  });

  it.each([
    '桂林4天2个人',
    '马来西亚，2000元',
    '继续作封面图',
    '重试制作一张西藏封面图',
    '把封面改成双人背影',
  ])('keeps follow-up context: %s', async (prompt) => {
    useInvitedMemberPrincipal();
    mocks.listAccessibleTopics.mockResolvedValue({
      items: [{ id: 'current-topic', title: '封面制作' }],
      nextCursor: null,
    });
    await caller().startHostedTravelGroupTask({
      billing: { idempotencyKey: 'follow-up-request', maxCredits: 500 },
      groupId,
      prompt,
    });
    expect(mocks.execPlatformManagedAgent.mock.calls[0][0].appContext.topicId).toBe(
      'current-topic',
    );
  });

  it('passes only authorized attachment links to the group task', async () => {
    useInvitedMemberPrincipal();
    mocks.ownedFiles.mockResolvedValueOnce([
      { id: 'own-file', name: 'note.txt', fileType: 'text/plain' },
    ]);
    await caller().startHostedTravelGroupTask({
      billing: { idempotencyKey: 'attachment-task', maxCredits: 500 },
      groupId,
      fileIds: ['own-file'],
      prompt: 'read this',
    });
    expect(mocks.execPlatformManagedAgent.mock.calls[0][0].prompt).toContain('/f/own-file');
  });
  it('rejects unavailable attachments before starting a group task', async () => {
    useInvitedMemberPrincipal();
    mocks.ownedFiles.mockResolvedValueOnce([]);
    await expect(
      caller().startHostedTravelGroupTask({
        billing: { idempotencyKey: 'foreign-attachment-task' },
        groupId,
        fileIds: ['foreign-file'],
        prompt: 'read this',
      }),
    ).rejects.toThrow();
    expect(mocks.execPlatformManagedAgent).not.toHaveBeenCalled();
  });
  it('routes a member mention through the trusted supervisor and binds the target to idempotency', async () => {
    useInvitedMemberPrincipal();
    await caller().startHostedTravelGroupTask({
      billing: { idempotencyKey: 'member-mention-start', maxCredits: 500 },
      groupId,
      mentionedAgentId: copywriterId,
      prompt: '请帮我整理这个想法',
    });
    const input = mocks.execPlatformManagedAgent.mock.calls[0][0];
    expect(input.agentId).toBe(agentId);
    expect(input.appContext.toolDispatchPolicy.steps).toEqual([
      expect.objectContaining({ apiName: 'speak', identifier: 'lobe-group-management' }),
    ]);
    expect(JSON.parse(input.appContext.toolDispatchPolicy.steps[0].arguments)).toMatchObject({
      agentId: copywriterId,
      instruction: '请帮我整理这个想法',
    });
    expect(mocks.runIdempotently.mock.calls[0][0].message).toContain(copywriterId);
  });

  it.each(['outside-group-agent', agentId])(
    'rejects a non-participant mention %s before reserving credits',
    async (mentionedAgentId) => {
      useInvitedMemberPrincipal();
      await expect(
        caller().startHostedTravelGroupTask({
          billing: { idempotencyKey: 'invalid-member-mention', maxCredits: 500 },
          groupId,
          mentionedAgentId,
          prompt: '处理这个任务',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mocks.createSponsoredBudget).not.toHaveBeenCalled();
      expect(mocks.execPlatformManagedAgent).not.toHaveBeenCalled();
    },
  );

  it('returns a safe hosted run status through the opaque handle only', async () => {
    const response = await (caller() as any).getHostedTravelGroupRunStatus({
      groupId,
      runHandle: 'A'.repeat(43),
    });

    expect(mocks.authorizeHostedRun).toHaveBeenCalledWith(
      expect.objectContaining({ groupId, runHandle: 'A'.repeat(43), userId }),
    );
    expect(response).toEqual({
      completedAt: null,
      errorSummary: null,
      startedAt: '2026-09-04T00:00:00.000Z',
      status: 'running',
      updatedAt: '2026-09-04T00:01:00.000Z',
    });
    expect(JSON.stringify(response)).not.toContain('internal-operation-id');
  });

  it('interrupts a hosted run only after opaque-handle authorization', async () => {
    const interrupt = vi
      .spyOn(AgentRuntimeService.prototype, 'interruptOperation')
      .mockResolvedValueOnce(true);
    const response = await (caller() as any).interruptHostedTravelGroupRun({
      groupId,
      runHandle: 'B'.repeat(43),
    });

    expect(mocks.authorizeHostedRun).toHaveBeenCalledWith(
      expect.objectContaining({ groupId, runHandle: 'B'.repeat(43), userId }),
    );
    expect(interrupt).toHaveBeenCalledWith('internal-operation-id');
    expect(response).toEqual({ interrupted: true });
  });

  it('rejects internal operation identifiers on hosted status and interrupt', async () => {
    for (const method of [
      'getHostedTravelGroupRunStatus',
      'interruptHostedTravelGroupRun',
    ] as const) {
      await expect(
        (caller() as any)[method]({
          groupId,
          operationId: 'internal-operation-id',
          runHandle: 'C'.repeat(43),
        }),
      ).rejects.toBeInstanceOf(TRPCError);
    }
    expect(mocks.authorizeHostedRun).not.toHaveBeenCalled();
  });

  it('rejects server-owned fields nested inside billing', async () => {
    await expect(
      caller().execGroupAgent({
        agentId,
        billing: {
          idempotencyKey: 'browser-request-1',
          maxCredits: 500,
          requestIdentity: 'attacker-controlled',
        },
        groupId,
        message: '继续',
      } as any),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(mocks.createBudget).not.toHaveBeenCalled();
  });

  it('fails closed for the hosted group when billing is omitted', async () => {
    await expect(
      caller().execGroupAgent({ agentId, groupId, message: '继续' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(mocks.execPlatformManagedGroupAgent).not.toHaveBeenCalled();
    expect(mocks.execGroupAgent).not.toHaveBeenCalled();
  });

  it('keeps the existing non-platform group path when billing is omitted', async () => {
    mocks.resolveTarget.mockResolvedValue(undefined);

    await expect(
      caller().execGroupAgent({ agentId, groupId, message: '继续' }),
    ).resolves.toMatchObject(result);
    expect(mocks.execGroupAgent).toHaveBeenCalled();
    expect(mocks.execPlatformManagedGroupAgent).not.toHaveBeenCalled();
  });

  it.each([
    { idempotencyKey: '', maxCredits: 1 },
    { idempotencyKey: '\u4E0D可打印', maxCredits: 1 },
    { idempotencyKey: 'a'.repeat(129), maxCredits: 1 },
    { idempotencyKey: 'valid', maxCredits: 0 },
    { idempotencyKey: 'valid', maxCredits: 1.5 },
  ])('rejects malformed billing before any execution: %j', async (billing) => {
    await expect(
      caller().execGroupAgent({ agentId, billing, groupId, message: '继续' } as any),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(mocks.resolveTarget).not.toHaveBeenCalled();
    expect(mocks.execPlatformManagedGroupAgent).not.toHaveBeenCalled();
  });

  it.each(['model', 'provider', 'pricing', 'requestIdentity', 'workspaceId', 'userId', 'tools'])(
    'rejects caller-controlled %s',
    async (field) => {
      await expect(
        caller().execGroupAgent({
          agentId,
          billing: { idempotencyKey: 'browser-request-2', maxCredits: 500 },
          groupId,
          message: '继续',
          [field]: 'attacker-controlled',
        } as any),
      ).rejects.toBeInstanceOf(TRPCError);
      expect(mocks.execPlatformManagedGroupAgent).not.toHaveBeenCalled();
    },
  );

  it('separates an owner composer request without losing the group context', async () => {
    await caller().execAgent({
      agentId,
      appContext: { groupId, topicId: 'old-topic' },
      billing: { idempotencyKey: 'owner-new-request' },
      prompt: '出个短视频文案吧',
    } as any);
    expect(mocks.execPlatformManagedAgent.mock.calls[0][0].appContext).toMatchObject({
      groupId,
      topicId: undefined,
    });
  });

  it('does not split a private thread when it contains a new production request', async () => {
    await caller().execAgent({
      agentId,
      appContext: { groupId, topicId: 'old-topic', threadId: 'private-thread' },
      billing: { idempotencyKey: 'thread-request' },
      prompt: '制作一张封面图',
    } as any);
    expect(mocks.execPlatformManagedAgent.mock.calls[0][0].appContext.topicId).toBe('old-topic');
  });

  it('applies the same boundary on the legacy owner group entry', async () => {
    await caller().execGroupAgent({
      agentId,
      groupId,
      topicId: 'old-topic',
      message: '请帮我规划行程',
      billing: { idempotencyKey: 'legacy-independent-request' },
    });
    expect(mocks.execPlatformManagedGroupAgent.mock.calls[0][0].topicId).toBeUndefined();
  });

  it('keeps a hosted retry on its original topic and forwards the parent message', async () => {
    await caller().execGroupAgent({
      agentId,
      billing: { idempotencyKey: 'legacy-retry-request' },
      groupId,
      message: '请帮我规划行程',
      parentMessageId: 'original-user-message',
      topicId: 'original-topic',
    });

    expect(mocks.execPlatformManagedGroupAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        parentMessageId: 'original-user-message',
        topicId: 'original-topic',
      }),
      expect.anything(),
    );
  });

  it('uses the same hosted budget contract for the current execAgent group entry', async () => {
    await expect(
      caller().execAgent({
        agentId,
        appContext: { groupId, topicId: 'topic-a' },
        billing: { idempotencyKey: 'current-entry-turn-1', maxCredits: 500 },
        prompt: '继续改写',
      } as any),
    ).resolves.toMatchObject(result);

    expect(mocks.execPlatformManagedAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId,
        appContext: expect.objectContaining({
          groupId,
          orchestrationRole: 'supervisor',
          topicId: 'topic-a',
        }),
        prompt: '继续改写',
      }),
      expect.objectContaining({ maxCredits: undefined, sharedBudget: expect.anything() }),
    );
    expect(mocks.execGroupAgent).not.toHaveBeenCalled();
  });

  it('routes an explicit copy request through the fixed copywriter production policy', async () => {
    await caller().execAgent({
      agentId,
      appContext: { groupId },
      billing: { idempotencyKey: 'copy-turn-1', maxCredits: 500 },
      prompt: '写一篇西藏旅游文案',
    } as any);

    expect(mocks.execPlatformManagedAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        appContext: expect.objectContaining({
          toolDispatchPolicy: expect.objectContaining({
            finishAfterSteps: true,
            steps: [
              expect.objectContaining({
                arguments: expect.stringContaining(copywriterId),
                identifier: 'lobe-group-management',
                memberToolDispatchPolicies: {
                  [copywriterId]: expect.objectContaining({
                    steps: [
                      expect.objectContaining({
                        apiName: 'generateCopy',
                        identifier: 'lobe-travel-production',
                      }),
                    ],
                  }),
                },
              }),
            ],
          }),
        }),
      }),
      expect.anything(),
    );
  });

  it('keeps non-copy hosted chat on the existing supervisor path', async () => {
    await caller().execAgent({
      agentId,
      appContext: { groupId },
      billing: { idempotencyKey: 'chat-turn-1', maxCredits: 500 },
      prompt: '今天天气怎么样',
    } as any);

    expect(mocks.execPlatformManagedAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        appContext: expect.not.objectContaining({ toolDispatchPolicy: expect.anything() }),
      }),
      expect.anything(),
    );
  });

  it('fails closed on the current execAgent hosted group entry without billing', async () => {
    await expect(
      caller().execAgent({
        agentId,
        appContext: { groupId, topicId: 'topic-a' },
        prompt: '继续改写',
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(mocks.execPlatformManagedAgent).not.toHaveBeenCalled();
    expect(mocks.execGroupAgent).not.toHaveBeenCalled();
  });

  it('rejects caller-selected tools on the current hosted group entry', async () => {
    await expect(
      caller().execAgent({
        agentId,
        appContext: { groupId, topicId: 'topic-a' },
        billing: { idempotencyKey: 'current-entry-turn-2', maxCredits: 500 },
        prompt: '继续改写',
        selectedToolIds: ['attacker-tool'],
      } as any),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(mocks.execPlatformManagedAgent).not.toHaveBeenCalled();
  });

  it('keeps the current execAgent non-platform path unchanged without billing', async () => {
    mocks.resolveTarget.mockResolvedValue(undefined);

    await expect(
      caller().execAgent({
        agentId,
        appContext: { groupId, topicId: 'topic-a' },
        prompt: '普通群聊',
      }),
    ).resolves.toMatchObject(result);
    expect(mocks.execGroupAgent).toHaveBeenCalled();
    expect(mocks.execPlatformManagedAgent).not.toHaveBeenCalled();
  });
});
