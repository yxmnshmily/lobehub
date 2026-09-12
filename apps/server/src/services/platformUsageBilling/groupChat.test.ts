// @vitest-environment node
import type * as DatabaseModule from '@lobechat/database';
import {
  CHAT_GROUP_SPONSORED_CREDIT_POLICY_DISABLED,
  type LobeChatDatabase,
} from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as GroupTemplateModule from '@/server/services/user/travelServiceGroupTemplate';

import {
  deriveHostedGroupChatRequestIdentity,
  HOSTED_GROUP_CHAT_BILLING_UNAVAILABLE,
  resolveHostedTravelGroupTarget,
  runHostedGroupChatWithBudget,
} from './groupChat';
import { PlatformManagedTextUsageSettlementError } from './settlement';
import type * as SharedBudgetModule from './sharedBudget';

const mocks = vi.hoisted(() => ({
  phoneGuard: vi.fn(),
  createAgentService: vi.fn(),
  createGroupModel: vi.fn(),
  createOwnerBudget: vi.fn(),
  createSponsoredBudget: vi.fn(),
  findGroup: vi.fn(),
  getAgentConfig: vi.fn(),
  getRoster: vi.fn(),
  getSupervisorId: vi.fn(),
  getTemplate: vi.fn(),
  resolveAdmission: vi.fn(),
  resolvePrincipal: vi.fn(),
  runIdempotently: vi.fn(),
  queueRuntimeEnabled: vi.fn(),
}));
vi.mock('@/server/services/aiAgent/verifiedPhone', () => ({
  assertGroupAiPhoneVerified: mocks.phoneGuard,
}));

vi.mock('@/database/models/chatGroup', () => ({
  ChatGroupModel: mocks.createGroupModel,
}));
vi.mock('@/server/services/agent', () => ({
  AgentService: mocks.createAgentService,
}));
vi.mock('@/server/services/user/travelServiceGroupTemplate', async (importOriginal) => ({
  ...(await importOriginal<typeof GroupTemplateModule>()),
  getSuperGroupTemplate: mocks.getTemplate,
}));
vi.mock('@/server/services/groupConversationAccess/principal', () => ({
  resolveGroupConversationPrincipal: mocks.resolvePrincipal,
}));
vi.mock('@/server/services/websiteAi/idempotency', () => ({
  runWebsiteAiStartIdempotently: mocks.runIdempotently,
}));
vi.mock('@/server/services/queue/impls', () => ({
  isQueueAgentRuntimeEnabled: mocks.queueRuntimeEnabled,
}));
vi.mock('@lobechat/database', async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  ChatGroupSponsoredCreditModel: vi.fn(() => ({ resolveAdmission: mocks.resolveAdmission })),
}));
vi.mock('./sharedBudget', async (importOriginal) => ({
  ...(await importOriginal<typeof SharedBudgetModule>()),
  createPlatformUsageSharedBudget: mocks.createOwnerBudget,
  createSponsoredPlatformUsageSharedBudget: mocks.createSponsoredBudget,
}));

describe('hosted group chat billing identity', () => {
  const principal = {
    actorUserId: 'actor-a',
    billingUserId: 'payer-a',
    groupId: 'group-a',
    kind: 'owner' as const,
    membershipVersion: 7,
    policyVersion: 11,
    resourceOwnerUserId: 'owner-a',
    workspaceId: 'workspace-a',
  };
  const input = {
    idempotencyKey: 'browser-retry-1',
    principal,
    secret: 'server-only-secret',
  };

  it('is stable for the same server principal and browser key', () => {
    expect(deriveHostedGroupChatRequestIdentity(input)).toBe(
      deriveHostedGroupChatRequestIdentity(input),
    );
  });

  it.each([
    ['actorUserId', 'actor-b'],
    ['billingUserId', 'payer-b'],
    ['resourceOwnerUserId', 'owner-b'],
    ['workspaceId', 'workspace-b'],
    ['groupId', 'group-b'],
    ['kind', 'owner-sponsored-member'],
    ['membershipVersion', 8],
    ['policyVersion', 12],
  ] as const)('changes when principal.%s changes', (field, value) => {
    expect(
      deriveHostedGroupChatRequestIdentity({
        ...input,
        principal: { ...principal, [field]: value },
      }),
    ).not.toBe(deriveHostedGroupChatRequestIdentity(input));
  });

  it('changes when the browser retry key changes', () => {
    expect(
      deriveHostedGroupChatRequestIdentity({ ...input, idempotencyKey: 'browser-retry-2' }),
    ).not.toBe(deriveHostedGroupChatRequestIdentity(input));
  });

  it('does not serialize caller identifiers or the browser key', () => {
    const identity = deriveHostedGroupChatRequestIdentity(input);

    expect(identity).toMatch(/^group-chat:v2:[a-f0-9]{64}$/);
    expect(identity).not.toContain(principal.actorUserId);
    expect(identity).not.toContain(principal.billingUserId);
    expect(identity).not.toContain(principal.resourceOwnerUserId);
    expect(identity).not.toContain(principal.workspaceId);
    expect(identity).not.toContain(principal.groupId);
    expect(identity).not.toContain(input.idempotencyKey);
  });
});

describe('hosted default travel group target', () => {
  const userId = 'user-a';
  const groupId = 'group-a';
  const supervisorId = 'supervisor-a';
  const roster = [
    { agentId: supervisorId, clientId: 'group-supervisor', role: 'supervisor' },
    { agentId: 'copywriter-a', clientId: 'default-travel-copywriter', role: 'member' },
    { agentId: 'designer-a', clientId: 'default-travel-image-designer', role: 'member' },
    { agentId: 'video-a', clientId: 'default-travel-video-producer', role: 'member' },
    { agentId: 'document-a', clientId: 'default-travel-document-assistant', role: 'member' },
  ];
  const fixedConfig = (agentId: string) => ({
    agencyConfig: { modelRuntimeMode: 'platform-managed', modelSelectionPolicy: 'fixed' },
    model: 'platform-model',
    plugins: agentId === 'copywriter-a' ? ['lobe-travel-production', 'tourism-copywriting'] : [],
    provider: 'platform-provider',
    userId,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queueRuntimeEnabled.mockReturnValue(false);
    mocks.createAgentService.mockImplementation(() => ({ getAgentConfig: mocks.getAgentConfig }));
    mocks.createGroupModel.mockImplementation(() => ({
      findByClientId: mocks.findGroup,
      getGroupAgentsWithMeta: mocks.getRoster,
      getSupervisorAgentId: mocks.getSupervisorId,
    }));
    mocks.findGroup.mockResolvedValue({
      content: '按意图调度旅游助理',
      id: groupId,
      userId,
      visibility: 'private',
    });
    mocks.getSupervisorId.mockResolvedValue(supervisorId);
    mocks.getRoster.mockResolvedValue(roster);
    mocks.getTemplate.mockResolvedValue({ revision: 0, members: [] });
    mocks.getAgentConfig.mockImplementation(async (agentId) => fixedConfig(agentId));
    mocks.resolvePrincipal.mockResolvedValue({
      actorUserId: userId,
      groupId,
      joinedAt: null,
      kind: 'owner',
      membershipVersion: 0,
      resourceOwnerUserId: userId,
    });
  });

  it('fails closed when the fixed copywriter is missing its production tool or skill binding', async () => {
    mocks.getAgentConfig.mockImplementation(async (agentId) => ({
      ...fixedConfig(agentId),
      plugins: agentId === 'copywriter-a' ? ['lobe-travel-production'] : [],
    }));

    await expect(
      resolveHostedTravelGroupTarget({
        agentId: supervisorId,
        db: {} as any,
        groupId,
        userId,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(HOSTED_GROUP_CHAT_BILLING_UNAVAILABLE),
    });
  });

  it.each(['owner', 'member'] as const)(
    'uses the published roster for a %s instead of requiring bootstrap assistants',
    async (actor) => {
      mocks.getTemplate.mockResolvedValue({
        revision: 2,
        members: [{ key: 'custom-expert', plugins: [] }],
      });
      mocks.getRoster.mockResolvedValue([
        roster[0],
        { agentId: 'expert-a', clientId: 'supergroup-template-custom-expert', role: 'member' },
      ]);
      if (actor === 'member')
        mocks.resolvePrincipal.mockResolvedValue({
          actorUserId: 'member-a',
          groupId,
          kind: 'member',
          membershipVersion: 3,
          resourceOwnerUserId: userId,
        });
      await expect(
        resolveHostedTravelGroupTarget({
          db: {} as any,
          groupId,
          userId: actor === 'owner' ? userId : 'member-a',
        }),
      ).resolves.toMatchObject({
        platformModel: { model: 'platform-model', provider: 'platform-provider' },
        supervisorId,
        routingMembers: [
          { id: supervisorId, clientId: 'group-supervisor' },
          { id: 'expert-a', clientId: 'supergroup-template-custom-expert' },
        ],
      });
    },
  );

  it('allows a published supervisor-only roster', async () => {
    mocks.getTemplate.mockResolvedValue({ revision: 2, members: [] });
    mocks.getRoster.mockResolvedValue([roster[0]]);
    await expect(
      resolveHostedTravelGroupTarget({ db: {} as any, groupId, userId }),
    ).resolves.toMatchObject({ supervisorId });
  });

  it('honors a published copywriter without the bootstrap tool requirements', async () => {
    mocks.getTemplate.mockResolvedValue({
      revision: 2,
      members: [{ key: 'copywriter', plugins: [] }],
    });
    mocks.getRoster.mockResolvedValue(roster.slice(0, 2));
    mocks.getAgentConfig.mockImplementation(async (id) => ({ ...fixedConfig(id), plugins: [] }));
    await expect(
      resolveHostedTravelGroupTarget({ db: {} as any, groupId, userId }),
    ).resolves.toMatchObject({ supervisorId });
  });

  it('rejects a missing published member', async () => {
    mocks.getTemplate.mockResolvedValue({
      revision: 2,
      members: [{ key: 'custom-expert', plugins: [] }],
    });
    await expect(
      resolveHostedTravelGroupTarget({ db: {} as any, groupId, userId }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('still rejects a foreign-owned agent in a published roster', async () => {
    mocks.getTemplate.mockResolvedValue({ revision: 2, members: [] });
    mocks.getRoster.mockResolvedValue([roster[0]]);
    mocks.getAgentConfig.mockResolvedValue({
      ...fixedConfig(supervisorId),
      userId: 'another-owner',
    });
    await expect(
      resolveHostedTravelGroupTarget({ db: {} as any, groupId, userId }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('returns only server-owned routing identities for a fully bound group', async () => {
    await expect(
      resolveHostedTravelGroupTarget({
        agentId: supervisorId,
        db: {} as any,
        groupId,
        userId,
      }),
    ).resolves.toMatchObject({
      groupId,
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
      routingMembers: expect.arrayContaining([
        { clientId: 'default-travel-copywriter', id: 'copywriter-a' },
      ]),
      supervisorId,
    });
  });

  it('loads a human member group and every agent config through the resource owner', async () => {
    const memberUserId = 'member-a';
    mocks.resolvePrincipal.mockResolvedValue({
      actorUserId: memberUserId,
      groupId,
      joinedAt: new Date(),
      kind: 'member',
      membershipVersion: 3,
      resourceOwnerUserId: userId,
    });

    await expect(
      resolveHostedTravelGroupTarget({
        agentId: supervisorId,
        db: {} as any,
        groupId,
        userId: memberUserId,
      }),
    ).resolves.toMatchObject({
      principal: {
        actorUserId: memberUserId,
        billingUserId: userId,
        kind: 'owner-sponsored-member',
        membershipVersion: 3,
        resourceOwnerUserId: userId,
      },
    });
    expect(mocks.createGroupModel).toHaveBeenCalledWith(expect.anything(), userId);
    expect(mocks.createAgentService).toHaveBeenCalledWith(expect.anything(), userId);
    expect(mocks.getAgentConfig).toHaveBeenCalledTimes(roster.length);
  });
});

describe('hosted group chat budget admission', () => {
  const ownerPrincipal = {
    actorUserId: 'owner-a',
    billingUserId: 'owner-a',
    groupId: 'group-a',
    kind: 'owner' as const,
    membershipVersion: 0,
    policyVersion: 0,
    resourceOwnerUserId: 'owner-a',
    workspaceId: null,
  };
  const memberPrincipal = {
    actorUserId: 'member-a',
    billingUserId: 'owner-a',
    groupId: 'group-a',
    kind: 'owner-sponsored-member' as const,
    membershipVersion: 3,
    policyVersion: 0,
    resourceOwnerUserId: 'owner-a',
    workspaceId: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queueRuntimeEnabled.mockReturnValue(false);
    mocks.runIdempotently.mockImplementation(async ({ start }) => start());
    mocks.createOwnerBudget.mockResolvedValue({ kind: 'owner-handle' });
    mocks.createSponsoredBudget.mockResolvedValue({ kind: 'sponsored-handle' });
    mocks.resolvePrincipal.mockResolvedValue({
      kind: 'member',
      actorUserId: memberPrincipal.actorUserId,
      groupId: memberPrincipal.groupId,
      resourceOwnerUserId: memberPrincipal.resourceOwnerUserId,
      membershipVersion: memberPrincipal.membershipVersion,
    });
    mocks.resolveAdmission.mockResolvedValue({
      actorUserId: memberPrincipal.actorUserId,
      chatGroupId: memberPrincipal.groupId,
      membershipVersion: memberPrincipal.membershipVersion,
      payerUserId: memberPrincipal.resourceOwnerUserId,
      policyVersion: 7,
      workspaceId: null,
    });
  });

  it('ignores a legacy owner ceiling and does not create a Credits hold', async () => {
    const start = vi.fn().mockResolvedValue('owner started');

    await expect(
      runHostedGroupChatWithBudget({
        billing: { idempotencyKey: 'owner-request', maxCredits: 100 },
        db: {} as any,
        fingerprint: { prompt: 'owner prompt' },
        principal: ownerPrincipal,
        secret: 'server-secret',
        start,
      }),
    ).resolves.toBe('owner started');

    expect(mocks.createOwnerBudget).toHaveBeenCalledWith(expect.anything(), 'owner-a', {
      expiresAt: expect.any(Date),
      maxCredits: undefined,
      requestIdentity: expect.stringMatching(/^group-chat:v2:/),
      workspaceId: null,
    });
    expect(mocks.resolveAdmission).not.toHaveBeenCalled();
    expect(mocks.createSponsoredBudget).not.toHaveBeenCalled();
  });

  it('rejects an unbound actor before creating a budget or starting AI', async () => {
    mocks.phoneGuard.mockRejectedValueOnce(new Error('PHONE_BINDING_REQUIRED'));
    const start = vi.fn();
    await expect(
      runHostedGroupChatWithBudget({
        billing: { idempotencyKey: 'unbound' },
        db: {} as any,
        fingerprint: {},
        principal: memberPrincipal,
        secret: 'server-secret',
        start,
      }),
    ).rejects.toThrow('PHONE_BINDING_REQUIRED');
    expect(mocks.phoneGuard).toHaveBeenCalledWith(
      expect.anything(),
      memberPrincipal.actorUserId,
      memberPrincipal,
    );
    expect(mocks.createOwnerBudget).not.toHaveBeenCalled();
    expect(mocks.createSponsoredBudget).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it.each(['owner', 'member'] as const)(
    'identifies whose Credits block %s admission without starting AI',
    async (kind) => {
      const start = vi.fn();
      const budget = kind === 'member' ? mocks.createSponsoredBudget : mocks.createOwnerBudget;
      budget.mockRejectedValueOnce(
        new PlatformManagedTextUsageSettlementError('BALANCE_FLOOR_REACHED', 'private ledger detail'),
      );
      await expect(
        runHostedGroupChatWithBudget({
          billing: { idempotencyKey: 'empty-balance', maxCredits: 80 },
          db: {} as any,
          fingerprint: { prompt: 'hello' },
          principal: kind === 'member' ? memberPrincipal : ownerPrincipal,
          secret: 'server-secret',
          start,
        }),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: expect.stringContaining(
          kind === 'member' ? '[GROUP_OWNER_CREDITS_EMPTY]' : '[PLATFORM_CREDITS_EMPTY]',
        ),
      });
      expect(start).not.toHaveBeenCalled();
      if (kind === 'member') expect(mocks.createOwnerBudget).not.toHaveBeenCalled();
    },
  );

  it.each(['BALANCE_LOOKUP_FAILED', 'BALANCE_INVALID'] as const)(
    'does not mislabel %s as insufficient Credits',
    async (code) => {
      const error = new PlatformManagedTextUsageSettlementError(code, 'ledger unavailable');
      mocks.createSponsoredBudget.mockRejectedValueOnce(error);
      const start = vi.fn();
      await expect(
        runHostedGroupChatWithBudget({
          billing: { idempotencyKey: 'ledger-error', maxCredits: 80 },
          db: {} as any,
          fingerprint: { prompt: 'hello' },
          principal: memberPrincipal,
          secret: 'server-secret',
          start,
        }),
      ).rejects.toBe(error);
      expect(start).not.toHaveBeenCalled();
    },
  );

  it('fails closed before creating a process-local budget in distributed queue mode', async () => {
    mocks.queueRuntimeEnabled.mockReturnValue(true);

    await expect(
      runHostedGroupChatWithBudget({
        billing: { idempotencyKey: 'queued-request', maxCredits: 100 },
        db: {} as any,
        fingerprint: { prompt: 'queued prompt' },
        principal: ownerPrincipal,
        secret: 'server-secret',
        start: vi.fn(),
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(HOSTED_GROUP_CHAT_BILLING_UNAVAILABLE),
    });

    expect(mocks.runIdempotently).not.toHaveBeenCalled();
    expect(mocks.createOwnerBudget).not.toHaveBeenCalled();
    expect(mocks.createSponsoredBudget).not.toHaveBeenCalled();
  });

  it('rechecks sponsor authorization and creates only a sponsored owner-paid handle', async () => {
    const start = vi.fn().mockResolvedValue('member started');

    await expect(
      runHostedGroupChatWithBudget({
        billing: { idempotencyKey: 'member-request', maxCredits: 80 },
        db: {} as any,
        fingerprint: { prompt: 'member prompt' },
        principal: memberPrincipal,
        secret: 'server-secret',
        start,
      }),
    ).resolves.toBe('member started');

    expect(mocks.resolveAdmission).toHaveBeenCalledWith({ chatGroupId: 'group-a', maxCredits: 80 });
    expect(mocks.createSponsoredBudget).toHaveBeenCalledWith(expect.anything(), 'member-a', {
      chatGroupId: 'group-a',
      expectedMembershipVersion: 3,
      expectedPolicyVersion: 7,
      expiresAt: expect.any(Date),
      maxCredits: 80,
      requestIdentity: expect.stringMatching(/^group-chat:v2:/),
    });
    expect(mocks.createOwnerBudget).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith({
      maxCredits: 80,
      sharedBudget: { kind: 'sponsored-handle' },
    });
  });

  it('derives an owner-sponsored ceiling when the browser omits maxCredits', async () => {
    mocks.resolveAdmission.mockResolvedValueOnce({
      actorUserId: 'member-a',
      chatGroupId: 'group-a',
      groupPeriodLimitCredits: 1_000,
      maxCreditsPerPeriod: 800,
      maxCreditsPerRequest: 300,
      membershipVersion: 3,
      payerUserId: 'owner-a',
      policyVersion: 7,
      workspaceId: null,
    });
    const start = vi.fn().mockResolvedValue('member started');

    await expect(
      runHostedGroupChatWithBudget({
        billing: { idempotencyKey: 'member-automatic-request' },
        db: {} as LobeChatDatabase,
        fingerprint: { prompt: 'member prompt' },
        principal: memberPrincipal,
        secret: 'server-secret',
        start,
      }),
    ).resolves.toBe('member started');

    expect(mocks.resolveAdmission).toHaveBeenCalledWith({ chatGroupId: 'group-a', maxCredits: 1 });
    expect(mocks.createSponsoredBudget).toHaveBeenCalledWith(
      expect.anything(),
      'member-a',
      expect.objectContaining({ maxCredits: 300 }),
    );
    expect(start).toHaveBeenCalledWith({
      maxCredits: 300,
      sharedBudget: { kind: 'sponsored-handle' },
    });
  });

  it('uses the invited member own Credits when no sponsorship policy exists', async () => {
    mocks.resolveAdmission.mockRejectedValueOnce(
      new Error(CHAT_GROUP_SPONSORED_CREDIT_POLICY_DISABLED),
    );
    const start = vi.fn().mockResolvedValue('self-paid member started');

    await expect(
      runHostedGroupChatWithBudget({
        billing: { idempotencyKey: 'member-self-paid-request' },
        db: {} as LobeChatDatabase,
        fingerprint: { prompt: 'member prompt' },
        principal: memberPrincipal,
        secret: 'server-secret',
        start,
      }),
    ).resolves.toBe('self-paid member started');

    expect(mocks.createOwnerBudget).toHaveBeenCalledWith(expect.anything(), 'member-a', {
      expiresAt: expect.any(Date),
      maxCredits: undefined,
      requestIdentity: expect.stringMatching(/^group-chat:v2:/),
      workspaceId: null,
    });
    expect(mocks.createSponsoredBudget).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith({
      maxCredits: undefined,
      sharedBudget: { kind: 'owner-handle' },
    });
  });

  it('fails closed on membership or payer version drift before creating a handle', async () => {
    mocks.resolveAdmission.mockResolvedValue({
      actorUserId: memberPrincipal.actorUserId,
      chatGroupId: memberPrincipal.groupId,
      membershipVersion: memberPrincipal.membershipVersion + 1,
      payerUserId: 'different-owner',
      policyVersion: 8,
      workspaceId: null,
    });

    await expect(
      runHostedGroupChatWithBudget({
        billing: { idempotencyKey: 'member-request', maxCredits: 80 },
        db: {} as any,
        fingerprint: { prompt: 'member prompt' },
        principal: memberPrincipal,
        secret: 'server-secret',
        start: vi.fn(),
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(HOSTED_GROUP_CHAT_BILLING_UNAVAILABLE),
    });
    expect(mocks.createSponsoredBudget).not.toHaveBeenCalled();
  });
});
