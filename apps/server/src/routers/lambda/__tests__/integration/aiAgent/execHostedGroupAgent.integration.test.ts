// @vitest-environment node
import {
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
  userRoles,
  users,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq } from 'drizzle-orm';
import OpenAI from 'openai';
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

const createToolCallStream = (name: string, arguments_: Record<string, unknown>) => {
  const callId = `call_${name}_${Date.now()}`;
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

describe('hosted default group two-turn execution', () => {
  let adminId: string;
  let copywriterId: string;
  let groupId: string;
  let memberId: string;
  let supervisorId: string;
  let userId: string;
  let mockResponsesCreate: ReturnType<typeof vi.spyOn>;
  let previousCredentialOwnerId: string | undefined;

  beforeEach(async () => {
    pricingMocks.resolvePlatformModelPricing.mockResolvedValue({
      model: 'gpt-5-pro',
      pricing: {
        currency: 'USD',
        units: [
          { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
          { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
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
    const ownerAccount = await new PlatformCreditModel(testDB, userId).getAccount();
    const periodStartedAt = new Date();
    await testDB.insert(chatGroupUserMemberships).values({
      canUsePaidAi: true,
      chatGroupId: groupId,
      invitedByUserId: userId,
      maxCreditsPerPeriod: 5000,
      maxCreditsPerRequest: 1000,
      membershipVersion: 2,
      userId: memberId,
    });
    await testDB.insert(chatGroupSponsoredCreditPolicies).values({
      chatGroupId: groupId,
      defaultMemberPeriodLimitCredits: 5000,
      defaultMemberRequestLimitCredits: 1000,
      defaultMemberSponsorshipEnabled: true,
      enabled: true,
      groupPeriodLimitCredits: 10_000,
      payerAccountId: ownerAccount.id,
      payerUserId: userId,
      payerUserIdSnapshot: userId,
      periodDurationSeconds: 3600,
      periodEndsAt: new Date(periodStartedAt.getTime() + 3_600_000),
      periodStartedAt,
      policyVersion: 1,
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

    const second = await caller.execAgent({
      agentId: supervisorId,
      appContext: { groupId, topicId: first.topicId },
      billing: { idempotencyKey: 'turn-2', maxCredits: 1000 },
      prompt: '第二轮：继续补充注意事项',
    });
    await waitForOperationComplete(inMemoryAgentStateManager, second.operationId);
    const secondEvents = await waitForStreamEnd(second.operationId);

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

  it('completes invite, bilateral chat, sponsored copy, safe publish and removal revocation', async () => {
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
    const invitation = await ownerMembershipCaller.createInvitation({ email: memberEmail, groupId });
    expect(invitation).toMatchObject({ status: 'created', token: expect.any(String) });
    const pendingInvitations = await memberMembershipCaller.listMyPendingInvitations();
    expect(pendingInvitations.items).toEqual([
      expect.objectContaining({
        groupId,
        sponsorship: {
          billingResponsibility: 'group_owner',
          maxCreditsPerPeriod: 5000,
          maxCreditsPerRequest: 1000,
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
        expect.objectContaining({ authorKind: 'owner', content: expect.stringContaining('群主回复') }),
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
    expect(result).toEqual({ accepted: true, runHandle: expect.stringMatching(/^[\w-]{43}$/) });
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
    const internalOperationId = operation!.id;
    const finalState = await waitForOperationComplete(
      inMemoryAgentStateManager,
      internalOperationId,
    );
    await waitForStreamEnd(internalOperationId);
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
    const publishedForMember =
      await new GroupConversationAccessRepository(testDB).listAccessiblePublishedAssistantMessages(
        memberId,
        groupId,
        operation!.topicId!,
      );
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
          eq(platformCreditEntries.actorUserIdSnapshot, memberId),
          eq(platformCreditEntries.type, 'usage_charge'),
        ),
      );
    const [sponsoredBudget] = await testDB
      .select()
      .from(platformCreditBudgets)
      .where(
        and(
          eq(platformCreditBudgets.actorUserIdSnapshot, memberId),
          eq(platformCreditBudgets.userIdSnapshot, userId),
          eq(platformCreditBudgets.sponsorChatGroupIdSnapshot, groupId),
          eq(platformCreditBudgets.authorizationKind, 'group_member_sponsored'),
        ),
      );
    const sponsoredReservations = sponsoredBudget
      ? await testDB
          .select()
          .from(platformCreditReservations)
          .where(eq(platformCreditReservations.budgetId, sponsoredBudget.id))
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
    expect(sponsoredBudget).toMatchObject({
      actorUserIdSnapshot: memberId,
      authorizationKind: 'group_member_sponsored',
      sponsorChatGroupIdSnapshot: groupId,
      status: 'settled',
      userIdSnapshot: userId,
    });
    expect(sponsoredBudget?.consumedCredits).toBeGreaterThan(0);
    expect(sponsoredReservations.length).toBeGreaterThan(0);
    expect(
      sponsoredReservations.every(
        ({ actualUsage, status, usageEntryId }) =>
          status === 'settled' && Boolean(actualUsage) && Boolean(usageEntryId),
      ),
    ).toBe(true);
    expect(charge).toMatchObject({
      actorUserIdSnapshot: memberId,
      userIdSnapshot: userId,
    });

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
