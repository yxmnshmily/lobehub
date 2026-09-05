// @vitest-environment node
import type * as DatabaseModule from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deriveHostedGroupChatRequestIdentity,
  HOSTED_GROUP_CHAT_BILLING_UNAVAILABLE,
  resolveHostedTravelGroupTarget,
  runHostedGroupChatWithBudget,
} from './groupChat';
import type * as SharedBudgetModule from './sharedBudget';

const mocks = vi.hoisted(() => ({
  createAgentService: vi.fn(),
  createGroupModel: vi.fn(),
  createOwnerBudget: vi.fn(),
  createSponsoredBudget: vi.fn(),
  findGroup: vi.fn(),
  getAgentConfig: vi.fn(),
  getRoster: vi.fn(),
  getSupervisorId: vi.fn(),
  resolveAdmission: vi.fn(),
  resolvePrincipal: vi.fn(),
  runIdempotently: vi.fn(),
  queueRuntimeEnabled: vi.fn(),
}));

vi.mock('@/database/models/chatGroup', () => ({
  ChatGroupModel: mocks.createGroupModel,
}));
vi.mock('@/server/services/agent', () => ({
  AgentService: mocks.createAgentService,
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
    mocks.resolveAdmission.mockResolvedValue({
      actorUserId: memberPrincipal.actorUserId,
      chatGroupId: memberPrincipal.groupId,
      membershipVersion: memberPrincipal.membershipVersion,
      payerUserId: memberPrincipal.resourceOwnerUserId,
      policyVersion: 7,
      workspaceId: null,
    });
  });

  it('preserves the owner self-budget path', async () => {
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
      maxCredits: 100,
      requestIdentity: expect.stringMatching(/^group-chat:v2:/),
      workspaceId: null,
    });
    expect(mocks.resolveAdmission).not.toHaveBeenCalled();
    expect(mocks.createSponsoredBudget).not.toHaveBeenCalled();
  });

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

  it('rechecks member authorization and creates only a sponsored owner-paid handle', async () => {
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
