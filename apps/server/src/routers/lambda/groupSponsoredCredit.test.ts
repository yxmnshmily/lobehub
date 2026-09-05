// @vitest-environment node
import { readFile } from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { groupSponsoredCreditRouter } from './groupSponsoredCredit';

const mocks = vi.hoisted(() => ({
  disablePolicy: vi.fn(),
  enablePolicy: vi.fn(),
  getActiveMembership: vi.fn(),
  getPolicy: vi.fn(),
  membershipConstructor: vi.fn(),
  resolvePrincipal: vi.fn(),
  revokeMemberPaidAi: vi.fn(),
  setMemberPaidAiLimits: vi.fn(),
  sponsoredConstructor: vi.fn(),
  updateDefaultMemberSponsorshipTemplate: vi.fn(),
  updatePolicyLimit: vi.fn(),
}));

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: vi.fn((opts: { ctx: unknown; next: (input: { ctx: unknown }) => unknown }) =>
    opts.next({ ctx: opts.ctx }),
  ),
}));

vi.mock('@/server/services/groupConversationAccess/principal', () => {
  class AccessUnavailableError extends Error {}
  return {
    GroupConversationAccessUnavailableError: AccessUnavailableError,
    resolveGroupConversationPrincipal: mocks.resolvePrincipal,
  };
});

vi.mock('@lobechat/database', () => ({
  CHAT_GROUP_MEMBERSHIP_VERSION_CONFLICT: 'CHAT_GROUP_MEMBERSHIP_VERSION_CONFLICT',
  CHAT_GROUP_SPONSORED_CREDIT_FORBIDDEN: 'CHAT_GROUP_SPONSORED_CREDIT_FORBIDDEN',
  CHAT_GROUP_SPONSORED_CREDIT_INVALID_LIMIT: 'CHAT_GROUP_SPONSORED_CREDIT_INVALID_LIMIT',
  CHAT_GROUP_SPONSORED_CREDIT_MEMBER_NOT_AUTHORIZED:
    'CHAT_GROUP_SPONSORED_CREDIT_MEMBER_NOT_AUTHORIZED',
  CHAT_GROUP_SPONSORED_CREDIT_PERIOD_CHANGE_NOT_ALLOWED:
    'CHAT_GROUP_SPONSORED_CREDIT_PERIOD_CHANGE_NOT_ALLOWED',
  CHAT_GROUP_SPONSORED_CREDIT_POLICY_DISABLED: 'CHAT_GROUP_SPONSORED_CREDIT_POLICY_DISABLED',
  CHAT_GROUP_SPONSORED_CREDIT_POLICY_VERSION_CONFLICT:
    'CHAT_GROUP_SPONSORED_CREDIT_POLICY_VERSION_CONFLICT',
  CHAT_GROUP_SPONSORED_CREDIT_PRINCIPAL_BLOCKED: 'CHAT_GROUP_SPONSORED_CREDIT_PRINCIPAL_BLOCKED',
  CHAT_GROUP_SPONSORED_CREDIT_WORKSPACE_FROZEN: 'CHAT_GROUP_SPONSORED_CREDIT_WORKSPACE_FROZEN',
  ChatGroupSponsoredCreditModel: mocks.sponsoredConstructor,
  ChatGroupUserMembershipModel: mocks.membershipConstructor,
}));

const ownerId = 'sponsored-router-owner';
const memberId = 'sponsored-router-member';
const groupId = 'sponsored-router-group';
const now = new Date('2026-09-04T10:00:00.000Z');
const later = new Date('2026-09-05T10:00:00.000Z');

const ownerPrincipal = {
  actorUserId: ownerId,
  groupId,
  joinedAt: null,
  kind: 'owner' as const,
  membershipVersion: 0 as const,
  resourceOwnerUserId: ownerId,
};
const memberPrincipal = {
  actorUserId: memberId,
  groupId,
  joinedAt: now,
  kind: 'member' as const,
  membershipVersion: 2,
  resourceOwnerUserId: ownerId,
};
const policy = {
  defaultMemberPeriodLimitCredits: null,
  defaultMemberRequestLimitCredits: null,
  defaultMemberSponsorshipEnabled: false,
  enabled: true,
  groupPeriodLimitCredits: 10_000,
  payerAccountId: 'must-not-leak-account',
  payerUserId: ownerId,
  payerUserIdSnapshot: ownerId,
  periodDurationSeconds: 86_400,
  periodEndsAt: later,
  periodStartedAt: now,
  policyVersion: 1,
};

const callerFor = (userId: string, workspaceId?: string | null) =>
  groupSponsoredCreditRouter.createCaller({ serverDB: {}, userId, workspaceId } as never);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sponsoredConstructor.mockImplementation(() => ({
    disablePolicy: mocks.disablePolicy,
    enablePolicy: mocks.enablePolicy,
    getPolicy: mocks.getPolicy,
    revokeMemberPaidAi: mocks.revokeMemberPaidAi,
    setMemberPaidAiLimits: mocks.setMemberPaidAiLimits,
    updateDefaultMemberSponsorshipTemplate: mocks.updateDefaultMemberSponsorshipTemplate,
    updatePolicyLimit: mocks.updatePolicyLimit,
  }));
  mocks.membershipConstructor.mockImplementation(() => ({
    getActiveMembership: mocks.getActiveMembership,
  }));
});

describe('groupSponsoredCreditRouter', () => {
  it('registers the dedicated sponsorship policy router once', async () => {
    const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');
    expect(
      source.match(/import \{ groupSponsoredCreditRouter \} from '\.\/groupSponsoredCredit';/gu),
    ).toHaveLength(1);
    expect(source.match(/groupSponsoredCredit: groupSponsoredCreditRouter,/gu)).toHaveLength(1);
  });

  it('lets only the authenticated default-group owner enable, update and disable a safe policy', async () => {
    mocks.resolvePrincipal.mockResolvedValue(ownerPrincipal);
    mocks.enablePolicy.mockResolvedValue(policy);
    mocks.getPolicy.mockResolvedValue(policy);
    mocks.updatePolicyLimit.mockResolvedValue({
      ...policy,
      groupPeriodLimitCredits: 20_000,
      policyVersion: 2,
    });
    mocks.disablePolicy.mockResolvedValue({ ...policy, enabled: false, policyVersion: 3 });
    const caller = callerFor(ownerId);

    await expect(
      caller.enablePolicy({
        expectedPolicyVersion: 0,
        groupId,
        groupPeriodLimitCredits: 10_000,
        periodDurationSeconds: 86_400,
      }),
    ).resolves.toEqual({
      defaultMemberTemplate: {
        billingResponsibility: null,
        enabled: false,
        maxCreditsPerPeriod: null,
        maxCreditsPerRequest: null,
      },
      enabled: true,
      groupPeriodLimitCredits: 10_000,
      periodDurationSeconds: 86_400,
      periodEndsAt: later,
      periodStartedAt: now,
      policyVersion: 1,
    });
    await caller.updatePolicyLimit({
      expectedPolicyVersion: 1,
      groupId,
      groupPeriodLimitCredits: 20_000,
    });
    await caller.disablePolicy({ expectedPolicyVersion: 2, groupId });

    expect(mocks.sponsoredConstructor).toHaveBeenCalledWith({}, ownerId);
    expect(mocks.enablePolicy).toHaveBeenCalledWith({
      chatGroupId: groupId,
      expectedPolicyVersion: 0,
      groupPeriodLimitCredits: 10_000,
      periodDurationSeconds: 86_400,
    });
    const ownerPolicy = await caller.getOwnerPolicy({ groupId });
    expect(ownerPolicy.defaultMemberTemplate).toEqual({
      billingResponsibility: null,
      enabled: false,
      maxCreditsPerPeriod: null,
      maxCreditsPerRequest: null,
    });
    expect(JSON.stringify(ownerPolicy)).not.toMatch(/payer|account|balance/iu);
  });

  it('lets only the owner update a strict default member template and returns a safe summary', async () => {
    mocks.resolvePrincipal.mockResolvedValue(ownerPrincipal);
    mocks.updateDefaultMemberSponsorshipTemplate
      .mockResolvedValueOnce({
        ...policy,
        defaultMemberPeriodLimitCredits: 3000,
        defaultMemberRequestLimitCredits: 500,
        defaultMemberSponsorshipEnabled: true,
        policyVersion: 2,
      })
      .mockResolvedValueOnce({ ...policy, policyVersion: 3 });
    const caller = callerFor(ownerId);

    await expect(
      caller.updateDefaultMemberTemplate({
        enabled: true,
        expectedPolicyVersion: 1,
        groupId,
        maxCreditsPerPeriod: 3000,
        maxCreditsPerRequest: 500,
      }),
    ).resolves.toEqual({
      defaultMemberTemplate: {
        billingResponsibility: 'group_owner',
        enabled: true,
        maxCreditsPerPeriod: 3000,
        maxCreditsPerRequest: 500,
      },
      enabled: true,
      groupPeriodLimitCredits: 10_000,
      periodDurationSeconds: 86_400,
      periodEndsAt: later,
      periodStartedAt: now,
      policyVersion: 2,
    });
    await caller.updateDefaultMemberTemplate({
      enabled: false,
      expectedPolicyVersion: 2,
      groupId,
    });

    expect(mocks.updateDefaultMemberSponsorshipTemplate).toHaveBeenNthCalledWith(1, {
      chatGroupId: groupId,
      enabled: true,
      expectedPolicyVersion: 1,
      maxCreditsPerPeriod: 3000,
      maxCreditsPerRequest: 500,
    });
    expect(mocks.updateDefaultMemberSponsorshipTemplate).toHaveBeenNthCalledWith(2, {
      chatGroupId: groupId,
      enabled: false,
      expectedPolicyVersion: 2,
    });

    mocks.resolvePrincipal.mockResolvedValueOnce(memberPrincipal);
    await expect(
      callerFor(memberId).updateDefaultMemberTemplate({
        enabled: false,
        expectedPolicyVersion: 3,
        groupId,
      }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'GROUP_SPONSORED_CREDIT_UNAVAILABLE',
    });
    expect(mocks.updateDefaultMemberSponsorshipTemplate).toHaveBeenCalledTimes(2);
  });

  it('rejects ambiguous or forged default member template inputs before model mutation', async () => {
    const caller = callerFor(ownerId);
    const invalidInputs = [
      { enabled: true, expectedPolicyVersion: 1, groupId },
      {
        enabled: true,
        expectedPolicyVersion: 1,
        groupId,
        maxCreditsPerPeriod: 500,
        maxCreditsPerRequest: 501,
      },
      {
        enabled: false,
        expectedPolicyVersion: 1,
        groupId,
        maxCreditsPerPeriod: 3000,
        maxCreditsPerRequest: 500,
      },
      { enabled: false, expectedPolicyVersion: 1, groupId, payerUserId: ownerId },
    ];

    for (const input of invalidInputs) {
      await expect(caller.updateDefaultMemberTemplate(input as never)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    }
    expect(mocks.updateDefaultMemberSponsorshipTemplate).not.toHaveBeenCalled();
  });

  it('lets the owner grant and revoke a listed member with membership CAS only', async () => {
    mocks.resolvePrincipal.mockResolvedValue(ownerPrincipal);
    mocks.setMemberPaidAiLimits.mockResolvedValue({
      canUsePaidAi: true,
      maxCreditsPerPeriod: 3000,
      maxCreditsPerRequest: 500,
      membershipVersion: 3,
    });
    mocks.revokeMemberPaidAi.mockResolvedValue({
      canUsePaidAi: false,
      maxCreditsPerPeriod: null,
      maxCreditsPerRequest: null,
      membershipVersion: 4,
    });

    await expect(
      callerFor(ownerId).setMemberLimits({
        expectedMembershipVersion: 2,
        groupId,
        maxCreditsPerPeriod: 3000,
        maxCreditsPerRequest: 500,
        memberUserId: memberId,
      }),
    ).resolves.toEqual({
      canUsePaidAi: true,
      maxCreditsPerPeriod: 3000,
      maxCreditsPerRequest: 500,
      membershipVersion: 3,
    });
    await callerFor(ownerId).revokeMemberPaidAi({
      expectedMembershipVersion: 3,
      groupId,
      memberUserId: memberId,
    });
    expect(mocks.setMemberPaidAiLimits).toHaveBeenCalledWith({
      chatGroupId: groupId,
      expectedMembershipVersion: 2,
      maxCreditsPerPeriod: 3000,
      maxCreditsPerRequest: 500,
      memberUserId: memberId,
    });
  });

  it('returns a member only their own safe sponsorship state without owner finances', async () => {
    mocks.resolvePrincipal.mockResolvedValue(memberPrincipal);
    mocks.getPolicy.mockResolvedValue(policy);
    mocks.getActiveMembership.mockResolvedValue({
      canUsePaidAi: true,
      maxCreditsPerPeriod: 3000,
      maxCreditsPerRequest: 500,
      membershipVersion: 2,
      userId: memberId,
    });

    const result = await callerFor(memberId).getMyStatus({ groupId });
    expect(result).toEqual({
      billingResponsibility: 'group_owner',
      canUsePaidAi: true,
      enabled: true,
      maxCreditsPerPeriod: 3000,
      maxCreditsPerRequest: 500,
      membershipVersion: 2,
      periodEndsAt: later,
      policyVersion: 1,
    });
    expect(JSON.stringify(result)).not.toMatch(/payerUser|account|balance|groupPeriod/iu);
    expect(mocks.sponsoredConstructor).toHaveBeenCalledWith({}, ownerId);
    expect(mocks.membershipConstructor).toHaveBeenCalledWith({}, memberId);

    mocks.getPolicy.mockResolvedValueOnce({
      ...policy,
      payerUserId: 'stale-owner',
      payerUserIdSnapshot: 'stale-owner',
    });
    await expect(callerFor(memberId).getMyStatus({ groupId })).resolves.toMatchObject({
      billingResponsibility: null,
      canUsePaidAi: false,
      maxCreditsPerPeriod: null,
      maxCreditsPerRequest: null,
    });
  });

  it('fails closed for a member mutating policy and removed/cross-group access', async () => {
    mocks.resolvePrincipal.mockResolvedValueOnce(memberPrincipal);
    await expect(
      callerFor(memberId).enablePolicy({
        expectedPolicyVersion: 0,
        groupId,
        groupPeriodLimitCredits: 10_000,
        periodDurationSeconds: 86_400,
      }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'GROUP_SPONSORED_CREDIT_UNAVAILABLE',
    });
    expect(mocks.enablePolicy).not.toHaveBeenCalled();

    const AccessError = (await import('@/server/services/groupConversationAccess/principal'))
      .GroupConversationAccessUnavailableError;
    for (const actor of [ownerId, memberId]) {
      mocks.resolvePrincipal.mockRejectedValueOnce(new AccessError());
      await expect(callerFor(actor).getMyStatus({ groupId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'GROUP_SPONSORED_CREDIT_UNAVAILABLE',
      });
    }
  });

  it('strictly rejects forged identity, payer, workspace, role, admin and provider fields', async () => {
    mocks.resolvePrincipal.mockResolvedValue(ownerPrincipal);
    const forgedFields = [
      { actorUserId: ownerId },
      { ownerUserId: ownerId },
      { payerUserId: ownerId },
      { workspaceId: 'workspace-1' },
      { role: 'admin' },
      { admin: true },
      { provider: 'provider-1' },
      { model: 'model-1' },
    ];
    for (const forged of forgedFields) {
      await expect(
        callerFor(ownerId).enablePolicy({
          expectedPolicyVersion: 0,
          groupId,
          groupPeriodLimitCredits: 10_000,
          periodDurationSeconds: 86_400,
          ...forged,
        } as never),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    await expect(
      callerFor(ownerId, 'workspace-1').getOwnerPolicy({ groupId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects unsafe limits and stale/invalid CAS before model mutation', async () => {
    const caller = callerFor(ownerId);
    await expect(
      caller.enablePolicy({
        expectedPolicyVersion: -1,
        groupId,
        groupPeriodLimitCredits: 10_000,
        periodDurationSeconds: 86_400,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.setMemberLimits({
        expectedMembershipVersion: 1,
        groupId,
        maxCreditsPerPeriod: 500,
        maxCreditsPerRequest: 501,
        memberUserId: memberId,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mocks.enablePolicy).not.toHaveBeenCalled();
    expect(mocks.setMemberPaidAiLimits).not.toHaveBeenCalled();
  });

  it('has no provider execution or balance surface', async () => {
    const source = await readFile(new URL('./groupSponsoredCredit.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(
      /providerId|modelId|reserveSponsored|claimSponsored|balanceCredits|apiKey/iu,
    );
  });
});
