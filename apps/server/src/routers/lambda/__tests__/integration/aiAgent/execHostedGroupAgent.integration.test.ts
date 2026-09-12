// @vitest-environment node
import {
  ChatGroupSponsoredCreditModel,
  type LobeChatDatabase,
  PlatformCreditAdminModel,
  PlatformCreditModel,
} from '@lobechat/database';
import {
  agentOperations,
  agents,
  chatGroups,
  chatGroupSponsoredCreditPolicies,
  chatGroupUserMemberships,
  messages,
  platformCreditAccounts,
  platformCreditBudgets,
  platformCreditEntries,
  platformCreditReservations,
  roles,
  topics,
  userRoles,
  users,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq } from 'drizzle-orm';
import OpenAI from 'openai';
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { createStreamEventManager } from '@/server/modules/AgentRuntime/factory';
import { inMemoryAgentStateManager } from '@/server/modules/AgentRuntime/InMemoryAgentStateManager';
import { inMemoryStreamEventManager } from '@/server/modules/AgentRuntime/InMemoryStreamEventManager';
import type { StreamEvent } from '@/server/modules/AgentRuntime/StreamEventManager';
import { GroupConversationAccessRepository } from '@/server/services/groupConversationAccess/conversationRepository';
import { hashHostedGroupRunHandle } from '@/server/services/platformUsageBilling/hostedGroupOperationAccess';
import {
  DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
  TRAVEL_SPECIALIST_TEMPLATES,
} from '@/server/services/user/travelServiceGroup';

import { aiAgentRouter } from '../../../aiAgent';
import { groupConversationRouter } from '../../../groupConversation';
import { groupMembershipRouter } from '../../../groupMembership';
import { cleanupTestUser, createTestContext, createTestUser } from '../setup';
import {
  createMockResponsesAPIStream,
  createMockResponsesStream,
  waitForOperationComplete,
} from './helpers';

process.env.OPENAI_API_KEY = 'sk-test-fake-api-key-for-testing';

let testDB: LobeChatDatabase;
const pricingMocks = vi.hoisted(() => ({ resolvePlatformModelPricing: vi.fn() }));
const generationMocks = vi.hoisted(() => ({ run: vi.fn() }));
const jwtMocks = vi.hoisted(() => ({
  signUserJWT: vi.fn().mockResolvedValue('owner-gateway-jwt'),
}));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(() => testDB) }));
vi.mock('@/envs/auth', () => ({
  authEnv: { AUTH_EMAIL_VERIFICATION: false, AUTH_SECRET: 'hosted-group-chat-test-secret' },
}));
vi.mock('@/libs/trpc/utils/internalJwt', async (importOriginal) => ({
  ...(await importOriginal()),
  signUserJWT: jwtMocks.signUserJWT,
}));
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    getFullFileUrl: vi.fn().mockImplementation((path: string) => (path ? `/files${path}` : null)),
  })),
}));
vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(() => ({
    getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
  })),
}));
vi.mock('@/server/services/platformUsageBilling/modelPricing', async (importOriginal) => ({
  ...(await importOriginal()),
  resolvePlatformModelPricing: pricingMocks.resolvePlatformModelPricing,
}));
vi.mock('@/server/services/travelGeneration/production', async (importOriginal) => ({
  ...(await importOriginal()),
  createHostedTravelCopyGenerationOrchestrator: vi.fn(() => ({ run: generationMocks.run })),
}));

let toolCallSequence = 0;
const createToolCallStream = (name: string, arguments_: Record<string, unknown>) => {
  const callId = `call_${name}_${Date.now()}_${++toolCallSequence}`;
  const args = JSON.stringify(arguments_);
  return createMockResponsesStream([
    {
      response: { id: `resp_${callId}`, status: 'in_progress' },
      type: 'response.created',
    },
    {
      item: { arguments: args, call_id: callId, name, type: 'function_call' },
      output_index: 0,
      type: 'response.output_item.added',
    },
    {
      response: {
        id: `resp_${callId}`,
        model: 'gpt-5-pro',
        output: [{ arguments: args, call_id: callId, name, type: 'function_call' }],
        status: 'completed',
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
      },
      type: 'response.completed',
    },
  ]);
};

const waitForStreamEnd = async (operationId: string) => {
  const manager = createStreamEventManager();
  const events: StreamEvent[] = [];
  const deadline = Date.now() + 10_000;
  let lastEventId = '0';

  while (Date.now() < deadline) {
    const result = await manager.readEventsOnce(operationId, lastEventId, 500);
    events.push(...result.events);
    lastEventId = result.lastEventId;
    if (result.events.some(({ type }) => type === 'agent_runtime_end')) return events;
  }
  throw new Error(`Hosted group stream did not finish for ${operationId}`);
};

// The runtime stream ends before CompletionLifecycle persists the publication marker.
// Member clients wait on the durable status RPC, not on the in-memory/stream status.
const waitForDurableCompletion = (readStatus: () => Promise<{ status: string } | undefined>) =>
  vi.waitFor(
    async () => {
      expect((await readStatus())?.status).toBe('done');
    },
    { interval: 20, timeout: 5000 },
  );

describe('hosted default group two-turn execution', () => {
  let adminId: string;
  let copywriterId: string;
  let groupId: string;
  let memberId: string;
  let supervisorId: string;
  let userId: string;
  let mockResponsesCreate: MockInstance<OpenAI.Responses['create']>;
  let previousCredentialOwnerId: string | undefined;

  beforeEach(async () => {
    pricingMocks.resolvePlatformModelPricing.mockResolvedValue({
      contextWindowTokens: 128_000,
      maxOutput: 16_384,
      model: 'gpt-5-pro',
      pricing: {
        currency: 'USD',
        units: [
          { name: 'textInput', rate: 0.001, strategy: 'fixed', unit: 'millionTokens' },
          { name: 'textOutput', rate: 0.002, strategy: 'fixed', unit: 'millionTokens' },
        ],
      },
      provider: 'openai',
    });
    generationMocks.run.mockResolvedValue({
      artifacts: [{ content: '成员请求生成的西藏旅游文案', type: 'text' }],
      id: 'travel-copy-task-member',
      status: 'succeeded',
      type: 'copy',
    });
    testDB = await getTestDB();
    userId = await createTestUser(testDB);
    memberId = await createTestUser(testDB);
    adminId = await createTestUser(testDB);
    for (const [id, phone] of [
      [userId, '13800000101'],
      [memberId, '13800000102'],
      [adminId, '13800000103'],
    ]) {
      await testDB.update(users).set({ phone, phoneNumberVerified: true }).where(eq(users.id, id));
    }
    previousCredentialOwnerId = process.env.TRAVEL_PLATFORM_CREDENTIAL_OWNER_ID;
    process.env.TRAVEL_PLATFORM_CREDENTIAL_OWNER_ID = adminId;
    await testDB
      .insert(roles)
      .values({ displayName: 'Super Admin', isActive: true, isSystem: true, name: 'super_admin' })
      .onConflictDoNothing();
    const role = await testDB.query.roles.findFirst({ where: eq(roles.name, 'super_admin') });
    if (!role) throw new Error('Missing super_admin role in hosted group test setup');
    await testDB
      .insert(userRoles)
      .values({ roleId: role.id, userId: adminId, workspaceId: null })
      .onConflictDoNothing();

    const [supervisor] = await testDB
      .insert(agents)
      .values({
        agencyConfig: { modelRuntimeMode: 'platform-managed', modelSelectionPolicy: 'fixed' },
        model: 'gpt-5-pro',
        provider: 'openai',
        slug: 'group-supervisor',
        systemRole: '你是旅游群主AI。',
        title: '旅游群主AI',
        userId,
      })
      .returning();
    supervisorId = supervisor.id;

    const [group] = await testDB
      .insert(chatGroups)
      .values({
        clientId: DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
        content: '只能调度群内经过配置的旅游助理。',
        title: '私人旅游服务群',
        userId,
        visibility: 'private',
      })
      .returning();
    groupId = group.id;

    const groupModel = new ChatGroupModel(testDB, userId);
    await groupModel.ensureSupervisorAgent(groupId, supervisorId);
    const specialistIds: string[] = [];
    for (const template of TRAVEL_SPECIALIST_TEMPLATES) {
      const [specialist] = await testDB
        .insert(agents)
        .values({
          agencyConfig: { modelRuntimeMode: 'platform-managed', modelSelectionPolicy: 'fixed' },
          clientId: template.clientId,
          model: 'gpt-5-pro',
          plugins: [...template.plugins, ...template.skillSlots],
          provider: 'openai',
          systemRole: template.systemRole,
          title: template.label,
          userId,
        })
        .returning();
      specialistIds.push(specialist.id);
      if (template.clientId === 'default-travel-copywriter') copywriterId = specialist.id;
    }
    await groupModel.addAgentsToGroup(groupId, specialistIds);

    await new PlatformCreditAdminModel(testDB, adminId).topUp({
      credits: 10_000,
      idempotencyKey: `hosted-group-test:${userId}`,
      reason: 'hosted group integration test',
      targetUserId: userId,
    });
    await testDB.insert(chatGroupUserMemberships).values({
      canUsePaidAi: false,
      chatGroupId: groupId,
      invitedByUserId: userId,
      membershipVersion: 2,
      userId: memberId,
    });
    mockResponsesCreate = vi.spyOn(OpenAI.Responses.prototype, 'create');
  });

  afterEach(async () => {
    await cleanupTestUser(testDB, memberId);
    await cleanupTestUser(testDB, userId);
    await cleanupTestUser(testDB, adminId);
    if (previousCredentialOwnerId === undefined) {
      delete process.env.TRAVEL_PLATFORM_CREDENTIAL_OWNER_ID;
    } else {
      process.env.TRAVEL_PLATFORM_CREDENTIAL_OWNER_ID = previousCredentialOwnerId;
    }
    vi.restoreAllMocks();
    inMemoryAgentStateManager.clear();
    inMemoryStreamEventManager.clear();
  });

  it('persists two turns, reuses context, settles Credits and isolates the group', async () => {
    mockResponsesCreate
      .mockResolvedValueOnce(createMockResponsesAPIStream('第一轮回答') as any)
      .mockResolvedValueOnce(createMockResponsesAPIStream('第二轮回答') as any);
    const caller = aiAgentRouter.createCaller({ jwtPayload: { userId }, userId });

    const first = await caller.execAgent({
      agentId: supervisorId,
      appContext: { groupId },
      billing: { idempotencyKey: 'turn-1', maxCredits: 1000 },
      prompt: '第一轮：去西藏8天路线怎么安排？',
    });
    expect(first.token).toEqual(expect.any(String));
    await waitForOperationComplete(inMemoryAgentStateManager, first.operationId);
    const firstEvents = await waitForStreamEnd(first.operationId);
    await waitForDurableCompletion(() =>
      testDB.query.agentOperations.findFirst({ where: eq(agentOperations.id, first.operationId) }),
    );

    const previousActivity = new Date('2026-09-01T00:00:00.000Z');
    await testDB
      .update(topics)
      .set({ updatedAt: previousActivity })
      .where(eq(topics.id, first.topicId!));

    const second = await caller.execAgent({
      agentId: supervisorId,
      appContext: { groupId, topicId: first.topicId },
      billing: { idempotencyKey: 'turn-2', maxCredits: 1000 },
      prompt: '第二轮：继续补充注意事项',
    });
    await waitForOperationComplete(inMemoryAgentStateManager, second.operationId);
    const secondEvents = await waitForStreamEnd(second.operationId);
    await waitForDurableCompletion(() =>
      testDB.query.agentOperations.findFirst({ where: eq(agentOperations.id, second.operationId) }),
    );
    const continuedTopic = await testDB.query.topics.findFirst({
      where: eq(topics.id, first.topicId!),
    });
    expect(continuedTopic!.updatedAt.getTime()).toBeGreaterThan(previousActivity.getTime());

    expect(second.topicId).toBe(first.topicId);
    expect(firstEvents.some(({ type }) => type === 'agent_runtime_end')).toBe(true);
    expect(secondEvents.some(({ type }) => type === 'agent_runtime_end')).toBe(true);

    const persisted = await testDB
      .select({ content: messages.content, role: messages.role, userId: messages.userId })
      .from(messages)
      .where(and(eq(messages.topicId, first.topicId), eq(messages.groupId, groupId)));
    expect(persisted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: '第一轮：去西藏8天路线怎么安排？',
          role: 'user',
          userId,
        }),
        expect.objectContaining({ content: '第一轮回答', role: 'assistant', userId }),
        expect.objectContaining({ content: '第二轮：继续补充注意事项', role: 'user', userId }),
        expect.objectContaining({ content: '第二轮回答', role: 'assistant', userId }),
      ]),
    );
    expect(JSON.stringify(mockResponsesCreate.mock.calls[1][0])).toContain('第一轮回答');
    expect(JSON.stringify(mockResponsesCreate.mock.calls[1][0])).toContain(
      '第二轮：继续补充注意事项',
    );

    const ledger = new PlatformCreditModel(testDB, userId);
    await expect(ledger.getAvailableCredits()).resolves.toMatchObject({ heldCredits: 0 });
    const charges = await testDB
      .select()
      .from(platformCreditEntries)
      .where(
        and(
          eq(platformCreditEntries.userId, userId),
          eq(platformCreditEntries.type, 'usage_charge'),
        ),
      );
    expect(charges).toHaveLength(2);
    expect(charges.every(({ amountCredits }) => amountCredits < 0)).toBe(true);

    const replay = await caller.execAgent({
      agentId: supervisorId,
      appContext: { groupId, topicId: first.topicId },
      billing: { idempotencyKey: 'turn-2', maxCredits: 1000 },
      prompt: '第二轮：继续补充注意事项',
    });
    expect(replay.operationId).toBe(second.operationId);
    expect(mockResponsesCreate).toHaveBeenCalledTimes(2);

    const otherUserId = await createTestUser(testDB);
    try {
      const otherCaller = aiAgentRouter.createCaller({
        jwtPayload: { userId: otherUserId },
        userId: otherUserId,
      });
      await expect(
        otherCaller.execAgent({
          agentId: supervisorId,
          appContext: { groupId },
          billing: { idempotencyKey: 'cross-user', maxCredits: 1000 },
          prompt: '读取别人的群聊',
        }),
      ).rejects.toMatchObject({
        code: expect.stringMatching(/FORBIDDEN|NOT_FOUND|PRECONDITION_FAILED/),
      });
      expect(mockResponsesCreate).toHaveBeenCalledTimes(2);
    } finally {
      await cleanupTestUser(testDB, otherUserId);
    }
  }, 30_000);

  it('runs review, quoted revision, and unquoted continuation in one member discussion', async () => {
    const reviewer = await testDB.query.agents.findFirst({
      where: and(
        eq(agents.userId, userId),
        eq(
          agents.clientId,
          TRAVEL_SPECIALIST_TEMPLATES.find(
            ({ clientId }) => clientId !== 'default-travel-copywriter',
          )!.clientId,
        ),
      ),
    });
    const reviewerId = reviewer!.id;
    await testDB
      .update(chatGroups)
      .set({ config: { maxDiscussionRounds: 4 } })
      .where(eq(chatGroups.id, groupId));

    let firstMessageId = '';
    let reviewMessageId = '';
    mockResponsesCreate
      .mockResolvedValueOnce(
        createToolCallStream('lobe-group-management____speak', {
          agentId: copywriterId,
          instruction: '完成文案后交给审核员。',
        }) as any,
      )
      .mockResolvedValueOnce(createMockResponsesAPIStream('好的，文案完毕了请检查。') as any)
      .mockImplementationOnce((body) => {
        const strings: string[] = [];
        const collectStrings = (value: unknown) => {
          if (typeof value === 'string') strings.push(value);
          else if (Array.isArray(value)) value.forEach(collectStrings);
          else if (value && typeof value === 'object') Object.values(value).forEach(collectStrings);
        };
        collectStrings(body);
        const source = strings.find(
          (value) =>
            value.includes('<message_reference id="') && value.includes('好的，文案完毕了请检查。'),
        );
        const reference = source?.match(/<message_reference id="([^"]+)"/u)?.[1];
        firstMessageId = reference ? decodeURIComponent(reference) : '';
        return createToolCallStream('lobe-group-management____speak', {
          agentId: reviewerId,
          instruction: '检查文案。',
          replyToMessageId: reference,
        }) as any;
      })
      .mockResolvedValueOnce(createMockResponsesAPIStream('我来检查你的文案。') as any)
      .mockImplementationOnce((body) => {
        const strings: string[] = [];
        const collectStrings = (value: unknown) => {
          if (typeof value === 'string') strings.push(value);
          else if (Array.isArray(value)) value.forEach(collectStrings);
          else if (value && typeof value === 'object') Object.values(value).forEach(collectStrings);
        };
        collectStrings(body);
        const source = strings.find(
          (value) =>
            value.includes('<message_reference id="') && value.includes('我来检查你的文案。'),
        );
        const reference = source?.match(/<message_reference id="([^"]+)"/u)?.[1];
        reviewMessageId = reference ? decodeURIComponent(reference) : '';
        return createToolCallStream('lobe-group-management____speak', {
          agentId: copywriterId,
          instruction: '根据审核意见修改。',
          replyToMessageId: reference,
        }) as any;
      })
      .mockResolvedValueOnce(createMockResponsesAPIStream('我已按建议修改文案。') as any)
      .mockResolvedValueOnce(
        createToolCallStream('lobe-group-management____speak', {
          agentId: copywriterId,
          instruction: '继续独立润色。',
        }) as any,
      )
      .mockResolvedValueOnce(createMockResponsesAPIStream('我继续完善这条文案。') as any);

    const caller = aiAgentRouter.createCaller({ jwtPayload: { userId }, userId });
    const started = await caller.execAgent({
      agentId: supervisorId,
      appContext: { groupId },
      billing: { idempotencyKey: 'quoted-review-revision', maxCredits: 1000 },
      prompt:
        'A 先交初稿；B 引用 A 提审核意见；A 引用 B 返回修订；A 再独立续写一次。',
    });
    const completed = await waitForOperationComplete(
      inMemoryAgentStateManager,
      started.operationId,
    );
    await waitForStreamEnd(started.operationId);
    await waitForDurableCompletion(() =>
      testDB.query.agentOperations.findFirst({
        where: eq(agentOperations.id, started.operationId),
      }),
    );

    expect(completed.status).toBe('done');
    expect(mockResponsesCreate).toHaveBeenCalledTimes(8);
    expect(firstMessageId).not.toBe('');
    expect(reviewMessageId).not.toBe('');
    const children = await testDB
      .select({ agentId: agentOperations.agentId })
      .from(agentOperations)
      .where(eq(agentOperations.parentOperationId, started.operationId));
    expect(children).toHaveLength(4);
    expect(children.filter(({ agentId }) => agentId === copywriterId)).toHaveLength(3);
    expect(children.filter(({ agentId }) => agentId === reviewerId)).toHaveLength(1);
    const discussion = await testDB
      .select({ agentId: messages.agentId, content: messages.content })
      .from(messages)
      .where(and(eq(messages.groupId, groupId), eq(messages.topicId, started.topicId!)));
    const encodedFirstMessageId = encodeURIComponent(firstMessageId).replaceAll('_', '%5F');
    const encodedReviewMessageId = encodeURIComponent(reviewMessageId).replaceAll('_', '%5F');
    expect(discussion).toEqual(
      expect.arrayContaining([
        { agentId: copywriterId, content: '好的，文案完毕了请检查。' },
        {
          agentId: reviewerId,
          content: `<group_reply ref="${encodedFirstMessageId}" />\n我来检查你的文案。`,
        },
        {
          agentId: copywriterId,
          content: `<group_reply ref="${encodedReviewMessageId}" />\n我已按建议修改文案。`,
        },
        { agentId: copywriterId, content: '我继续完善这条文案。' },
      ]),
    );
    expect(
      discussion.find(({ content }) => content === '我继续完善这条文案。')?.content,
    ).not.toContain('<group_reply');
  }, 30_000);

  it('publishes the selected assistant response through the hosted supervisor final-text boundary', async () => {
    const recordCompletion = AgentOperationModel.prototype.recordCompletion;
    let releaseCompletion!: () => void;
    const completionGate = new Promise<void>((resolve) => {
      releaseCompletion = resolve;
    });
    vi.spyOn(AgentOperationModel.prototype, 'recordCompletion').mockImplementation(async function (
      this: AgentOperationModel,
      operationId,
      input,
    ) {
      if (input.hostedGroupMemberFinal) await completionGate;
      return recordCompletion.call(this, operationId, input);
    });
    try {
      mockResponsesCreate
        .mockResolvedValueOnce(
          createToolCallStream('lobe-group-management____speak', {
            agentId: supervisorId,
            instruction: 'This target is overridden by the trusted mention.',
          }) as any,
        )
        .mockResolvedValueOnce(createMockResponsesAPIStream('先明确客群，再整理行程亮点。') as any)
        .mockResolvedValueOnce(
          createMockResponsesAPIStream('文案助理建议：先明确客群，再整理行程亮点。') as any,
        );
      const memberCaller = aiAgentRouter.createCaller({
        jwtPayload: { userId: memberId },
        userId: memberId,
      });
      const started = await memberCaller.startHostedTravelGroupTask({
        billing: { idempotencyKey: 'member-mention-final', maxCredits: 1000 },
        groupId,
        mentionedAgentId: copywriterId,
        prompt: '请帮我整理这个想法',
      });
      const [operation] = await testDB
        .select()
        .from(agentOperations)
        .where(
          and(
            eq(agentOperations.chatGroupId, groupId),
            eq(agentOperations.topicId, started.resultTopicId!),
          ),
        );
      const completed = await waitForOperationComplete(inMemoryAgentStateManager, operation.id);
      await waitForStreamEnd(operation.id);
      expect(completed.status).toBe('done');
      expect(
        (
          await memberCaller.getHostedTravelGroupRunStatus({
            groupId,
            runHandle: started.runHandle,
          })
        ).status,
      ).not.toBe('done');
      expect(
        await new GroupConversationAccessRepository(
          testDB,
        ).listAccessiblePublishedAssistantMessages(memberId, groupId, started.resultTopicId!),
      ).toEqual([]);
      releaseCompletion();
      await waitForDurableCompletion(() =>
        memberCaller.getHostedTravelGroupRunStatus({ groupId, runHandle: started.runHandle }),
      );
      const published = await new GroupConversationAccessRepository(
        testDB,
      ).listAccessiblePublishedAssistantMessages(memberId, groupId, started.resultTopicId!);
      expect(published).toEqual([
        expect.objectContaining({
          content: '文案助理建议：先明确客群，再整理行程亮点。',
          kind: 'assistant',
        }),
      ]);
      const child = await testDB.query.agentOperations.findFirst({
        where: eq(agentOperations.parentOperationId, operation.id),
      });
      expect(child?.agentId).toBe(copywriterId);
    } finally {
      releaseCompletion();
    }
  });

  it('dispatches each selected group assistant once and rejects foreign selections before execution', async () => {
    const secondAssistant = await testDB.query.agents.findFirst({
      where: and(
        eq(agents.userId, userId),
        eq(
          agents.clientId,
          TRAVEL_SPECIALIST_TEMPLATES.find(
            ({ clientId }) => clientId !== 'default-travel-copywriter',
          )!.clientId,
        ),
      ),
    });
    const secondId = secondAssistant!.id;
    const sponsorship = new ChatGroupSponsoredCreditModel(testDB, userId);
    await sponsorship.enablePolicy({
      chatGroupId: groupId,
      expectedPolicyVersion: 0,
      groupPeriodLimitCredits: 10_000,
      periodDurationSeconds: 86_400,
    });
    await sponsorship.setMemberPaidAiLimits({
      chatGroupId: groupId,
      expectedMembershipVersion: 2,
      maxCreditsPerPeriod: 3000,
      maxCreditsPerRequest: 1000,
      memberUserId: memberId,
    });
    const memberCaller = aiAgentRouter.createCaller({
      jwtPayload: { userId: memberId },
      userId: memberId,
    });
    await expect(
      memberCaller.startHostedTravelGroupTask({
        billing: { idempotencyKey: 'multi-foreign', maxCredits: 1000 },
        groupId,
        mentionedAgentIds: [copywriterId, 'foreign-assistant-id'],
        prompt: '请各位提出建议',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mockResponsesCreate).not.toHaveBeenCalled();

    mockResponsesCreate
      .mockResolvedValueOnce(
        createToolCallStream('lobe-group-management____speak', {
          agentId: supervisorId,
          instruction: 'trusted override',
        }) as any,
      )
      .mockResolvedValueOnce(createMockResponsesAPIStream('第一位助理的建议。') as any)
      .mockResolvedValueOnce(
        createToolCallStream('lobe-group-management____speak', {
          agentId: supervisorId,
          instruction: 'trusted override',
        }) as any,
      )
      .mockResolvedValueOnce(createMockResponsesAPIStream('第二位助理的建议。') as any)
      .mockResolvedValueOnce(createMockResponsesAPIStream('已汇总两位助理的建议。') as any);
    const started = await memberCaller.startHostedTravelGroupTask({
      billing: { idempotencyKey: 'member-multiple-mentions', maxCredits: 1000 },
      groupId,
      mentionedAgentId: copywriterId,
      mentionedAgentIds: [copywriterId, secondId, copywriterId],
      prompt: '请各位提出建议',
    });
    const [operation] = await testDB
      .select()
      .from(agentOperations)
      .where(
        and(
          eq(agentOperations.chatGroupId, groupId),
          eq(agentOperations.topicId, started.resultTopicId!),
        ),
      );
    const completed = await waitForOperationComplete(inMemoryAgentStateManager, operation.id);
    await waitForStreamEnd(operation.id);
    expect(completed).toMatchObject({ status: 'done' });
    await waitForDurableCompletion(() =>
      memberCaller.getHostedTravelGroupRunStatus({ groupId, runHandle: started.runHandle }),
    );
    const children = await testDB
      .select({ agentId: agentOperations.agentId })
      .from(agentOperations)
      .where(eq(agentOperations.parentOperationId, operation.id));
    expect(children.map(({ agentId }) => agentId).sort()).toEqual([copywriterId, secondId].sort());
    const published = await new GroupConversationAccessRepository(
      testDB,
    ).listAccessiblePublishedAssistantMessages(memberId, groupId, started.resultTopicId!);
    expect(published).toEqual([expect.objectContaining({ content: '已汇总两位助理的建议。' })]);
  }, 30_000);

  it('completes invite, bilateral chat, automatic owner-funded copy, safe publish and removal revocation', async () => {
    mockResponsesCreate
      .mockResolvedValueOnce(
        createToolCallStream('lobe-group-management____speak', {
          agentId: supervisorId,
          instruction: '模型返回的调度参数将被服务端固定策略覆盖',
        }) as any,
      )
      .mockResolvedValueOnce(
        createToolCallStream('lobe-travel-production____generateCopy', {
          prompt: '模型返回的文案参数将被服务端固定策略覆盖',
        }) as any,
      )
      .mockResolvedValueOnce(createMockResponsesAPIStream('文案制作完成') as any)
      .mockResolvedValueOnce(createMockResponsesAPIStream('已为你完成西藏旅游文案') as any);

    await testDB
      .delete(chatGroupUserMemberships)
      .where(
        and(
          eq(chatGroupUserMemberships.chatGroupId, groupId),
          eq(chatGroupUserMemberships.userId, memberId),
        ),
      );
    const memberEmail = `${memberId}@example.test`;
    await testDB.update(users).set({ email: memberEmail }).where(eq(users.id, memberId));

    const ownerMembershipCaller = groupMembershipRouter.createCaller(createTestContext(userId));
    const memberMembershipCaller = groupMembershipRouter.createCaller(createTestContext(memberId));
    const invitation = await ownerMembershipCaller.createInvitation({
      email: memberEmail,
      groupId,
    });
    expect(invitation).toMatchObject({ status: 'created', token: expect.any(String) });
    const pendingInvitations = await memberMembershipCaller.listMyPendingInvitations();
    expect(pendingInvitations.items).toEqual([
      expect.objectContaining({
        billingMode: 'automatic_owner',
        groupId,
        sponsorship: {
          billingResponsibility: null,
          maxCreditsPerPeriod: null,
          maxCreditsPerRequest: null,
        },
      }),
    ]);
    expect(JSON.stringify(pendingInvitations)).not.toMatch(
      /payerAccountId|payerUserId|policyVersion|token/iu,
    );
    const accepted = await memberMembershipCaller.acceptInvitation({ token: invitation.token });
    expect(accepted).toMatchObject({ groupId, status: 'accepted' });

    const ownerConversationCaller = groupConversationRouter.createCaller(createTestContext(userId));
    const memberConversationCaller = groupConversationRouter.createCaller(
      createTestContext(memberId),
    );
    const humanTopic = await memberConversationCaller.createTopic({
      groupId,
      idempotencyKey: 'full-journey-human-topic',
      title: '真人双向群聊',
    });
    await memberConversationCaller.createTextMessage({
      content: '成员说：你好，我想了解西藏旅游',
      groupId,
      idempotencyKey: 'full-journey-member-message',
      topicId: humanTopic.id,
    });
    await expect(
      ownerConversationCaller.listTextMessages({ groupId, topicId: humanTopic.id }),
    ).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          authorKind: 'member',
          content: '成员说：你好，我想了解西藏旅游',
        }),
      ]),
    });
    await ownerConversationCaller.createTextMessage({
      content: '群主回复：收到，可以在群里直接发起文案任务',
      groupId,
      idempotencyKey: 'full-journey-owner-message',
      topicId: humanTopic.id,
    });
    const humanMessages = await memberConversationCaller.listTextMessages({
      groupId,
      topicId: humanTopic.id,
    });
    expect(humanMessages.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ authorKind: 'self', content: expect.stringContaining('成员说') }),
        expect.objectContaining({
          authorKind: 'owner',
          content: expect.stringContaining('群主回复'),
        }),
      ]),
    );
    expect(JSON.stringify(humanMessages)).not.toMatch(new RegExp(`${memberId}|${userId}`));

    const memberAccountsBefore = await testDB
      .select()
      .from(platformCreditAccounts)
      .where(eq(platformCreditAccounts.userIdSnapshot, memberId));
    const memberLedgerBefore = await testDB
      .select()
      .from(platformCreditEntries)
      .where(eq(platformCreditEntries.userIdSnapshot, memberId));
    const ownerCreditsBefore = await new PlatformCreditModel(testDB, userId).getAvailableCredits();
    const memberCaller = aiAgentRouter.createCaller({
      jwtPayload: { userId: memberId },
      userId: memberId,
    });

    const result = await memberCaller.startHostedTravelGroupTask({
      billing: { idempotencyKey: 'member-copy-turn-1', maxCredits: 1000 },
      groupId,
      prompt: '帮我写一篇西藏旅游文案',
    });
    expect(result).toEqual({
      accepted: true,
      resultTopicId: expect.any(String),
      runHandle: expect.stringMatching(/^[\w-]{43}$/),
    });
    expect(result.resultTopicId).toBe(humanTopic.id);
    const operationRows = await testDB
      .select()
      .from(agentOperations)
      .where(eq(agentOperations.chatGroupId, groupId));
    const operation = operationRows.find(
      ({ metadata }) =>
        (metadata as any)?.hostedGroupRun?.handleHash ===
        hashHostedGroupRunHandle(result.runHandle),
    );
    expect(operation).toBeDefined();
    expect(operation?.agentId).toBe(supervisorId);
    expect(result.resultTopicId).toBe(operation?.topicId);
    const internalOperationId = operation!.id;
    const finalState = await waitForOperationComplete(
      inMemoryAgentStateManager,
      internalOperationId,
    );
    await waitForStreamEnd(internalOperationId);
    await waitForDurableCompletion(() =>
      memberCaller.getHostedTravelGroupRunStatus({ groupId, runHandle: result.runHandle }),
    );
    expect(finalState.status).toBe('done');

    const [publishedOperation] = await testDB
      .select()
      .from(agentOperations)
      .where(eq(agentOperations.id, internalOperationId));
    expect((publishedOperation.metadata as any)?.hostedGroupMemberFinal).toMatchObject({
      actorUserIdSnapshot: memberId,
      assistantMessageId: expect.any(String),
      contentHash: expect.stringMatching(/^[a-f\d]{64}$/),
      groupId,
      membershipVersion: accepted.membershipVersion,
      operationId: internalOperationId,
      ownerUserIdSnapshot: userId,
      publishedAt: expect.any(String),
      version: 1,
    });
    const publishedForMember = await new GroupConversationAccessRepository(
      testDB,
    ).listAccessiblePublishedAssistantMessages(memberId, groupId, operation!.topicId!);
    expect(publishedForMember).toEqual([
      expect.objectContaining({
        content: '已为你完成西藏旅游文案',
        id: expect.stringMatching(/^[a-f\d]{64}$/),
        kind: 'assistant',
        topicId: operation!.topicId,
      }),
    ]);
    expect(JSON.stringify(publishedForMember)).not.toMatch(
      new RegExp(`${memberId}|${userId}|${internalOperationId}`),
    );

    const [copywriter] = await testDB
      .select({ plugins: agents.plugins })
      .from(agents)
      .where(eq(agents.id, copywriterId));
    expect(copywriter.plugins).toContain('tourism-copywriting');
    const completedOperations = await testDB
      .select({ agentId: agentOperations.agentId })
      .from(agentOperations)
      .where(eq(agentOperations.chatGroupId, groupId));
    expect(completedOperations).toContainEqual({ agentId: copywriterId });

    const safeStatus = await memberCaller.getHostedTravelGroupRunStatus({
      groupId,
      runHandle: result.runHandle,
    });
    expect(safeStatus.status).toBe('done');
    expect(safeStatus.resultTopicId).toBe(result.resultTopicId);
    expect(safeStatus).not.toHaveProperty('operationId');

    const toolMessages = await testDB
      .select()
      .from(messages)
      .where(and(eq(messages.topicId, operation!.topicId!), eq(messages.role, 'tool')));

    const memberAccountsAfter = await testDB
      .select()
      .from(platformCreditAccounts)
      .where(eq(platformCreditAccounts.userIdSnapshot, memberId));
    const [charge] = await testDB
      .select()
      .from(platformCreditEntries)
      .where(
        and(
          eq(platformCreditEntries.userIdSnapshot, userId),
          eq(platformCreditEntries.actorUserIdSnapshot, userId),
          eq(platformCreditEntries.type, 'usage_charge'),
        ),
      );
    const [ownerBudget] = await testDB
      .select()
      .from(platformCreditBudgets)
      .where(
        and(
          eq(platformCreditBudgets.actorUserIdSnapshot, userId),
          eq(platformCreditBudgets.userIdSnapshot, userId),
          eq(platformCreditBudgets.authorizationKind, 'self'),
        ),
      );
    const ownerReservations = ownerBudget
      ? await testDB
          .select()
          .from(platformCreditReservations)
          .where(eq(platformCreditReservations.budgetId, ownerBudget.id))
      : [];
    const memberLedgerEntries = await testDB
      .select()
      .from(platformCreditEntries)
      .where(eq(platformCreditEntries.userIdSnapshot, memberId));
    const ownerCreditsAfter = await new PlatformCreditModel(testDB, userId).getAvailableCredits();
    expect(memberAccountsAfter).toEqual(memberAccountsBefore);
    expect(memberLedgerEntries).toEqual(memberLedgerBefore);
    expect(ownerCreditsAfter.availableCredits).toBeLessThan(ownerCreditsBefore.availableCredits);
    expect(JSON.stringify(toolMessages)).toContain('成员请求生成的西藏旅游文案');
    expect(generationMocks.run).toHaveBeenCalledOnce();
    expect(generationMocks.run).toHaveBeenCalledWith(
      expect.objectContaining({
        maxCredits: expect.any(Number),
        owner: { groupId, userId, workspaceId: undefined },
        type: 'copy',
      }),
    );
    expect(ownerBudget).toMatchObject({
      actorUserIdSnapshot: userId,
      authorizationKind: 'self',
      status: 'settled',
      userIdSnapshot: userId,
    });
    expect(ownerBudget?.consumedCredits).toBeGreaterThan(0);
    expect(ownerReservations.length).toBeGreaterThan(0);
    expect(
      ownerReservations.every(
        ({ actualUsage, status, usageEntryId }) =>
          status === 'settled' && Boolean(actualUsage) && Boolean(usageEntryId),
      ),
    ).toBe(true);
    expect(charge).toMatchObject({
      actorUserIdSnapshot: userId,
      userIdSnapshot: userId,
    });
    expect(
      await testDB
        .select()
        .from(chatGroupSponsoredCreditPolicies)
        .where(eq(chatGroupSponsoredCreditPolicies.chatGroupId, groupId)),
    ).toEqual([]);

    const replay = await memberCaller.startHostedTravelGroupTask({
      billing: { idempotencyKey: 'member-copy-turn-1', maxCredits: 1000 },
      groupId,
      prompt: '帮我写一篇西藏旅游文案',
    });
    expect(replay.runHandle).toBe(result.runHandle);
    expect(mockResponsesCreate).toHaveBeenCalledTimes(4);
    expect(generationMocks.run).toHaveBeenCalledOnce();

    await expect(
      ownerMembershipCaller.removeMember({
        expectedMembershipVersion: accepted.membershipVersion,
        groupId,
        memberUserId: memberId,
      }),
    ).resolves.toEqual({ status: 'removed' });
    await expect(
      memberConversationCaller.listTextMessages({ groupId, topicId: humanTopic.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      memberConversationCaller.createTextMessage({
        content: '移除后不应能继续发言',
        groupId,
        idempotencyKey: 'full-journey-removed-member-message',
        topicId: humanTopic.id,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      memberCaller.startHostedTravelGroupTask({
        billing: { idempotencyKey: 'member-copy-after-removal', maxCredits: 1000 },
        groupId,
        prompt: '再写一篇西藏旅游文案',
      }),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/FORBIDDEN|NOT_FOUND|PRECONDITION_FAILED/),
    });
    await expect(
      memberCaller.getHostedTravelGroupRunStatus({ groupId, runHandle: result.runHandle }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      memberConversationCaller.listPublishedAssistantMessages({
        groupId,
        topicId: operation!.topicId!,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const staleOperationId = 'hosted-final-after-member-removal';
    const operationModel = new AgentOperationModel(testDB, userId);
    const staleHostedRun = {
      actorUserIdSnapshot: memberId,
      expiresAt: '2099-09-04T00:00:00.000Z',
      groupId,
      handleHash: 'b'.repeat(64),
      membershipVersion: accepted.membershipVersion,
      ownerUserIdSnapshot: userId,
      version: 1,
    };
    await operationModel.recordStart({
      chatGroupId: groupId,
      metadata: { hostedGroupRun: staleHostedRun },
      operationId: staleOperationId,
    });
    await expect(
      operationModel.recordCompletion(staleOperationId, {
        completionReason: 'done',
        hostedGroupMemberFinal: {
          actorUserIdSnapshot: memberId,
          assistantMessageId: 'must-not-publish',
          contentHash: 'a'.repeat(64),
          groupId,
          membershipVersion: accepted.membershipVersion,
          operationId: staleOperationId,
          ownerUserIdSnapshot: userId,
          publishedAt: new Date().toISOString(),
          version: 1,
        },
        status: 'done',
      }),
    ).resolves.toBe(true);
    const staleOperation = await operationModel.findById(staleOperationId);
    expect(staleOperation?.status).toBe('done');
    expect(staleOperation?.metadata).not.toHaveProperty('hostedGroupMemberFinal');
    expect(mockResponsesCreate).toHaveBeenCalledTimes(4);
  }, 30_000);
});
