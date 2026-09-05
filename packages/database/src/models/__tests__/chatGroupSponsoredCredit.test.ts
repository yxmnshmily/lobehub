import { and, eq, getTableColumns, sql } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  CHAT_GROUP_SPONSORED_CREDIT_CLAIM_DENIED,
  CHAT_GROUP_SPONSORED_CREDIT_FORBIDDEN,
  CHAT_GROUP_SPONSORED_CREDIT_INVALID_LIMIT,
  CHAT_GROUP_SPONSORED_CREDIT_MEMBER_NOT_AUTHORIZED,
  CHAT_GROUP_SPONSORED_CREDIT_PERIOD_CHANGE_NOT_ALLOWED,
  CHAT_GROUP_SPONSORED_CREDIT_POLICY_DISABLED,
  CHAT_GROUP_SPONSORED_CREDIT_POLICY_VERSION_CONFLICT,
  CHAT_GROUP_SPONSORED_CREDIT_PRINCIPAL_BLOCKED,
  CHAT_GROUP_SPONSORED_CREDIT_WORKSPACE_FROZEN,
  ChatGroupSponsoredCreditModel,
  PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT,
  PLATFORM_CREDIT_INSUFFICIENT_BALANCE,
  PlatformCreditAdminModel,
  PlatformCreditModel,
} from '../../index';
import { chatGroups } from '../../schemas/chatGroup';
import {
  chatGroupSponsoredCreditAudits,
  chatGroupSponsoredCreditPolicies,
} from '../../schemas/chatGroupSponsoredCredit';
import { chatGroupUserMemberships } from '../../schemas/chatGroupUserMembership';
import {
  platformCreditAccounts,
  platformCreditBudgets,
  platformCreditReservations,
} from '../../schemas/platformCredit';
import { users } from '../../schemas/user';
import { workspaces } from '../../schemas/workspace';
import type { LobeChatDatabase } from '../../type';

const db: LobeChatDatabase = await getTestDB();
const ownerId = 'sponsored-owner';
const memberId = 'sponsored-member';
const outsiderId = 'sponsored-outsider';
const workspaceId = 'sponsored-workspace';
const groupId = 'sponsored-group';
const DEFAULT_TRAVEL_GROUP_CLIENT_ID = 'default-travel-service-group';

beforeAll(async () => {
  const statements = [
    `
    CREATE TABLE IF NOT EXISTS chat_group_user_memberships (
      chat_group_id text NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invited_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
      role text NOT NULL DEFAULT 'member',
      can_use_paid_ai boolean NOT NULL DEFAULT false,
      max_credits_per_request bigint,
      max_credits_per_period bigint,
      membership_version integer NOT NULL DEFAULT 1,
      joined_at timestamptz NOT NULL DEFAULT now(),
      removed_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (chat_group_id, user_id),
      CONSTRAINT chat_group_user_memberships_role_check CHECK (role = 'member'),
      CONSTRAINT chat_group_user_memberships_paid_ai_limits_check CHECK (
        (
          can_use_paid_ai = false
          AND max_credits_per_request IS NULL
          AND max_credits_per_period IS NULL
        ) OR (
          can_use_paid_ai = true
          AND max_credits_per_request IS NOT NULL
          AND max_credits_per_period IS NOT NULL
          AND max_credits_per_request > 0
          AND max_credits_per_period > 0
          AND max_credits_per_request <= max_credits_per_period
          AND max_credits_per_period <= 9007199254740991
        )
      ),
      CONSTRAINT chat_group_user_memberships_version_check CHECK (membership_version > 0)
    )`,
    `ALTER TABLE chat_group_user_memberships
      ADD COLUMN IF NOT EXISTS max_credits_per_request bigint`,
    `ALTER TABLE chat_group_user_memberships
      ADD COLUMN IF NOT EXISTS max_credits_per_period bigint`,
    `ALTER TABLE platform_credit_budgets
      ADD COLUMN IF NOT EXISTS actor_user_id text REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS actor_user_id_snapshot text,
      ADD COLUMN IF NOT EXISTS authorization_kind text,
      ADD COLUMN IF NOT EXISTS sponsor_chat_group_id_snapshot text,
      ADD COLUMN IF NOT EXISTS sponsor_policy_version_snapshot integer,
      ADD COLUMN IF NOT EXISTS sponsor_membership_version_snapshot integer,
      ADD COLUMN IF NOT EXISTS sponsor_period_started_at_snapshot timestamptz,
      ADD COLUMN IF NOT EXISTS sponsor_period_ends_at_snapshot timestamptz,
      ADD COLUMN IF NOT EXISTS sponsor_group_period_limit_credits_snapshot bigint,
      ADD COLUMN IF NOT EXISTS sponsor_member_period_limit_credits_snapshot bigint,
      ADD COLUMN IF NOT EXISTS sponsor_member_request_limit_credits_snapshot bigint`,
    `
    CREATE TABLE IF NOT EXISTS chat_group_sponsored_credit_policies (
      chat_group_id text PRIMARY KEY NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
      payer_account_id uuid NOT NULL REFERENCES platform_credit_accounts(id) ON DELETE RESTRICT,
      payer_user_id text REFERENCES users(id) ON DELETE SET NULL,
      payer_user_id_snapshot text NOT NULL,
      enabled boolean NOT NULL DEFAULT false,
      group_period_limit_credits bigint NOT NULL,
      default_member_sponsorship_enabled boolean NOT NULL DEFAULT false,
      default_member_request_limit_credits bigint,
      default_member_period_limit_credits bigint,
      period_started_at timestamptz NOT NULL,
      period_ends_at timestamptz NOT NULL,
      period_duration_seconds integer NOT NULL,
      policy_version integer NOT NULL DEFAULT 1,
      disabled_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT chat_group_sponsored_credit_policies_limits_check CHECK (
        group_period_limit_credits > 0
        AND group_period_limit_credits <= 9007199254740991
      ),
      CONSTRAINT chat_group_sponsored_credit_policies_default_member_template_check CHECK (
        (
          default_member_sponsorship_enabled = false
          AND default_member_request_limit_credits IS NULL
          AND default_member_period_limit_credits IS NULL
        ) OR (
          default_member_sponsorship_enabled = true
          AND enabled = true
          AND default_member_request_limit_credits IS NOT NULL
          AND default_member_period_limit_credits IS NOT NULL
          AND default_member_request_limit_credits > 0
          AND default_member_period_limit_credits > 0
          AND default_member_request_limit_credits <= default_member_period_limit_credits
          AND default_member_period_limit_credits <= group_period_limit_credits
          AND default_member_period_limit_credits <= 9007199254740991
        )
      ),
      CONSTRAINT chat_group_sponsored_credit_policies_period_check CHECK (
        period_duration_seconds > 0 AND period_ends_at > period_started_at
      ),
      CONSTRAINT chat_group_sponsored_credit_policies_version_check CHECK (policy_version > 0)
    )`,
    `ALTER TABLE chat_group_sponsored_credit_policies
      ADD COLUMN IF NOT EXISTS default_member_sponsorship_enabled boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS default_member_request_limit_credits bigint,
      ADD COLUMN IF NOT EXISTS default_member_period_limit_credits bigint`,
    `
    CREATE TABLE IF NOT EXISTS chat_group_sponsored_credit_audits (
      id text PRIMARY KEY NOT NULL,
      chat_group_id_snapshot text NOT NULL,
      actor_user_id_snapshot text NOT NULL,
      payer_user_id_snapshot text NOT NULL,
      target_user_id_snapshot text,
      action text NOT NULL,
      enabled boolean,
      group_period_limit_credits bigint,
      member_request_limit_credits bigint,
      member_period_limit_credits bigint,
      policy_version integer,
      membership_version integer,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE chat_group_sponsored_credit_audits
      DROP CONSTRAINT IF EXISTS chat_group_sponsored_credit_audits_action_check`,
    `ALTER TABLE chat_group_sponsored_credit_audits
      ADD CONSTRAINT chat_group_sponsored_credit_audits_action_check CHECK (
        action IN (
          'member_granted', 'member_limits_updated', 'member_revoked',
          'policy_disabled', 'policy_default_member_template_updated',
          'policy_enabled', 'policy_limit_updated'
        )
      )`,
  ];
  for (const statement of statements) await db.execute(sql.raw(statement));
});

beforeEach(async () => {
  await db.delete(chatGroupSponsoredCreditAudits);
  await db.delete(users);
  await db.delete(platformCreditAccounts);
  await db.insert(users).values([
    { email: 'owner@sponsor.test', id: ownerId },
    { email: 'member@sponsor.test', id: memberId },
    { email: 'outsider@sponsor.test', id: outsiderId },
  ]);
  await db.insert(workspaces).values({
    id: workspaceId,
    name: 'Sponsor workspace',
    primaryOwnerId: ownerId,
    slug: workspaceId,
  });
  await db.insert(chatGroups).values({
    clientId: DEFAULT_TRAVEL_GROUP_CLIENT_ID,
    id: groupId,
    title: 'Sponsored travel group',
    userId: ownerId,
    visibility: 'private',
    workspaceId: null,
  });
  await db.insert(chatGroupUserMemberships).values({
    chatGroupId: groupId,
    invitedByUserId: ownerId,
    userId: memberId,
  });
});

afterEach(async () => {
  await db.delete(chatGroupSponsoredCreditAudits);
  await db.delete(users);
  await db.delete(platformCreditAccounts);
});

const enablePolicy = (expectedPolicyVersion = 0) =>
  new ChatGroupSponsoredCreditModel(db, ownerId).enablePolicy({
    chatGroupId: groupId,
    expectedPolicyVersion,
    groupPeriodLimitCredits: 10_000,
    periodDurationSeconds: 86_400,
  });

const grantMember = (limits = { maxCreditsPerPeriod: 3000, maxCreditsPerRequest: 500 }) =>
  new ChatGroupSponsoredCreditModel(db, ownerId).setMemberPaidAiLimits({
    chatGroupId: groupId,
    expectedMembershipVersion: 1,
    ...limits,
    memberUserId: memberId,
  });

const topUpOwner = (credits = 10_000, suffix = 'default') =>
  new PlatformCreditAdminModel(db, outsiderId).topUp({
    credits,
    idempotencyKey: `sponsored-top-up:${suffix}`,
    reason: '群主代付测试',
    targetUserId: ownerId,
  });

const reserveSponsored = (
  overrides: Partial<Parameters<ChatGroupSponsoredCreditModel['reserveSponsoredBudget']>[0]> = {},
) =>
  new ChatGroupSponsoredCreditModel(db, memberId).reserveSponsoredBudget({
    authorizedCredits: 400,
    chatGroupId: groupId,
    expectedMembershipVersion: 2,
    expectedPolicyVersion: 1,
    expiresAt: new Date(Date.now() + 60_000),
    idempotencyKey: 'sponsored-budget:default',
    requestHash: 'sponsored-request:default',
    sourceId: 'group-message:default',
    sourceType: 'group-chat',
    ...overrides,
  });

const reserveSponsoredRemainingCall = async (
  overrides: Partial<
    Parameters<ChatGroupSponsoredCreditModel['reserveSponsoredRemainingCall']>[0]
  > = {},
) => {
  const budget = await reserveSponsored();
  return new ChatGroupSponsoredCreditModel(db, memberId).reserveSponsoredRemainingCall({
    budgetId: budget.id,
    budgetLeaseVersion: budget.leaseVersion,
    callKind: 'call_llm',
    expiresAt: new Date(Date.now() + 30_000),
    generationId: 'group-message:default:step:0',
    generationType: 'group-chat-text-step',
    idempotencyKey: 'sponsored-call:default',
    model: 'model-a',
    provider: 'provider-a',
    requestHash: 'sponsored-call-request:default',
    ...overrides,
  });
};

describe('ChatGroupSponsoredCreditModel policy contract', () => {
  it('is disabled by default and only the owner can enable it', async () => {
    const owner = new ChatGroupSponsoredCreditModel(db, ownerId);
    const outsider = new ChatGroupSponsoredCreditModel(db, outsiderId);

    await expect(owner.getPolicy(groupId)).resolves.toBeUndefined();
    await expect(
      new ChatGroupSponsoredCreditModel(db, memberId).resolveAdmission({
        chatGroupId: groupId,
        maxCredits: 1,
      }),
    ).rejects.toThrow(CHAT_GROUP_SPONSORED_CREDIT_POLICY_DISABLED);
    await expect(
      outsider.enablePolicy({
        chatGroupId: groupId,
        expectedPolicyVersion: 0,
        groupPeriodLimitCredits: 10_000,
        periodDurationSeconds: 86_400,
      }),
    ).rejects.toThrow(CHAT_GROUP_SPONSORED_CREDIT_FORBIDDEN);

    await expect(enablePolicy()).resolves.toMatchObject({
      defaultMemberPeriodLimitCredits: null,
      defaultMemberRequestLimitCredits: null,
      defaultMemberSponsorshipEnabled: false,
      enabled: true,
      groupPeriodLimitCredits: 10_000,
      payerUserIdSnapshot: ownerId,
      policyVersion: 1,
    });
  });

  it('configures the default new-member owner sponsorship template with policyVersion CAS', async () => {
    const owner = new ChatGroupSponsoredCreditModel(db, ownerId);
    await enablePolicy();

    const enabled = await owner.updateDefaultMemberSponsorshipTemplate({
      chatGroupId: groupId,
      enabled: true,
      expectedPolicyVersion: 1,
      maxCreditsPerPeriod: 3000,
      maxCreditsPerRequest: 500,
    });
    expect(enabled).toMatchObject({
      defaultMemberPeriodLimitCredits: 3000,
      defaultMemberRequestLimitCredits: 500,
      defaultMemberSponsorshipEnabled: true,
      policyVersion: 2,
    });

    await expect(
      owner.updateDefaultMemberSponsorshipTemplate({
        chatGroupId: groupId,
        enabled: true,
        expectedPolicyVersion: 1,
        maxCreditsPerPeriod: 3000,
        maxCreditsPerRequest: 500,
      }),
    ).rejects.toThrow(CHAT_GROUP_SPONSORED_CREDIT_POLICY_VERSION_CONFLICT);

    await expect(
      owner.updatePolicyLimit({
        chatGroupId: groupId,
        expectedPolicyVersion: 2,
        groupPeriodLimitCredits: 2999,
      }),
    ).rejects.toThrow(CHAT_GROUP_SPONSORED_CREDIT_INVALID_LIMIT);

    await expect(
      owner.disablePolicy({ chatGroupId: groupId, expectedPolicyVersion: 2 }),
    ).resolves.toMatchObject({
      defaultMemberPeriodLimitCredits: null,
      defaultMemberRequestLimitCredits: null,
      defaultMemberSponsorshipEnabled: false,
      enabled: false,
      policyVersion: 3,
    });
  });

  it.each([
    { maxCreditsPerPeriod: 3000, maxCreditsPerRequest: 0 },
    { maxCreditsPerPeriod: 500, maxCreditsPerRequest: 501 },
    { maxCreditsPerPeriod: 10_001, maxCreditsPerRequest: 500 },
  ])('rejects an unsafe default member template: %o', async (limits) => {
    await enablePolicy();

    await expect(
      new ChatGroupSponsoredCreditModel(db, ownerId).updateDefaultMemberSponsorshipTemplate({
        chatGroupId: groupId,
        enabled: true,
        expectedPolicyVersion: 1,
        ...limits,
      }),
    ).rejects.toThrow(CHAT_GROUP_SPONSORED_CREDIT_INVALID_LIMIT);
  });

  it('updates and disables a policy with policyVersion CAS', async () => {
    const owner = new ChatGroupSponsoredCreditModel(db, ownerId);
    await enablePolicy();

    const updated = await owner.updatePolicyLimit({
      chatGroupId: groupId,
      expectedPolicyVersion: 1,
      groupPeriodLimitCredits: 20_000,
    });
    expect(updated).toMatchObject({ groupPeriodLimitCredits: 20_000, policyVersion: 2 });
    await expect(
      owner.updatePolicyLimit({
        chatGroupId: groupId,
        expectedPolicyVersion: 1,
        groupPeriodLimitCredits: 30_000,
      }),
    ).rejects.toThrow(CHAT_GROUP_SPONSORED_CREDIT_POLICY_VERSION_CONFLICT);
    await expect(
      owner.disablePolicy({ chatGroupId: groupId, expectedPolicyVersion: 2 }),
    ).resolves.toMatchObject({ disabledAt: expect.any(Date), enabled: false, policyVersion: 3 });
  });

  it('does not change the configured period duration inside the current period', async () => {
    const owner = new ChatGroupSponsoredCreditModel(db, ownerId);
    await enablePolicy();
    await owner.disablePolicy({ chatGroupId: groupId, expectedPolicyVersion: 1 });

    await expect(
      owner.enablePolicy({
        chatGroupId: groupId,
        expectedPolicyVersion: 2,
        groupPeriodLimitCredits: 10_000,
        periodDurationSeconds: 3600,
      }),
    ).rejects.toThrow(CHAT_GROUP_SPONSORED_CREDIT_PERIOD_CHANGE_NOT_ALLOWED);
    await expect(owner.getPolicy(groupId)).resolves.toMatchObject({
      enabled: false,
      periodDurationSeconds: 86_400,
      policyVersion: 2,
    });
  });

  it('does not let a new group owner mutate the previous owner payer binding', async () => {
    await enablePolicy();
    await db.update(chatGroups).set({ userId: outsiderId }).where(eq(chatGroups.id, groupId));
    const newOwner = new ChatGroupSponsoredCreditModel(db, outsiderId);

    await expect(
      newOwner.updatePolicyLimit({
        chatGroupId: groupId,
        expectedPolicyVersion: 1,
        groupPeriodLimitCredits: 20_000,
      }),
    ).rejects.toThrow(CHAT_GROUP_SPONSORED_CREDIT_POLICY_DISABLED);

    await expect(
      newOwner.disablePolicy({ chatGroupId: groupId, expectedPolicyVersion: 1 }),
    ).resolves.toMatchObject({ enabled: false, policyVersion: 2 });
    const [audit] = await db
      .select()
      .from(chatGroupSponsoredCreditAudits)
      .where(eq(chatGroupSponsoredCreditAudits.action, 'policy_disabled'));
    expect(audit.payerUserIdSnapshot).toBe(ownerId);
  });

  it.each([0, Number.MAX_SAFE_INTEGER + 1])(
    'rejects unsafe or non-positive group credit limit %s',
    async (groupPeriodLimitCredits) => {
      await expect(
        new ChatGroupSponsoredCreditModel(db, ownerId).enablePolicy({
          chatGroupId: groupId,
          expectedPolicyVersion: 0,
          groupPeriodLimitCredits,
          periodDurationSeconds: 86_400,
        }),
      ).rejects.toThrow(CHAT_GROUP_SPONSORED_CREDIT_INVALID_LIMIT);
    },
  );
});

describe('ChatGroupSponsoredCreditModel member authorization', () => {
  it.each([
    { maxCreditsPerPeriod: 3000, maxCreditsPerRequest: 0 },
    { maxCreditsPerPeriod: Number.MAX_SAFE_INTEGER + 1, maxCreditsPerRequest: 500 },
    { maxCreditsPerPeriod: 500, maxCreditsPerRequest: 501 },
  ])('rejects unsafe member credit limits: %o', async (limits) => {
    await enablePolicy();
    await expect(
      new ChatGroupSponsoredCreditModel(db, ownerId).setMemberPaidAiLimits({
        chatGroupId: groupId,
        expectedMembershipVersion: 1,
        ...limits,
        memberUserId: memberId,
      }),
    ).rejects.toThrow(CHAT_GROUP_SPONSORED_CREDIT_INVALID_LIMIT);
  });
  it('lets only the owner grant, update and revoke paid AI with membershipVersion CAS', async () => {
    const owner = new ChatGroupSponsoredCreditModel(db, ownerId);
    await enablePolicy();

    await expect(
      new ChatGroupSponsoredCreditModel(db, outsiderId).setMemberPaidAiLimits({
        chatGroupId: groupId,
        expectedMembershipVersion: 1,
        maxCreditsPerPeriod: 3000,
        maxCreditsPerRequest: 500,
        memberUserId: memberId,
      }),
    ).rejects.toThrow(CHAT_GROUP_SPONSORED_CREDIT_FORBIDDEN);

    const granted = await owner.setMemberPaidAiLimits({
      chatGroupId: groupId,
      expectedMembershipVersion: 1,
      maxCreditsPerPeriod: 3000,
      maxCreditsPerRequest: 500,
      memberUserId: memberId,
    });
    expect(granted).toMatchObject({
      canUsePaidAi: true,
      maxCreditsPerPeriod: 3000,
      maxCreditsPerRequest: 500,
      membershipVersion: 2,
    });

    const updated = await owner.setMemberPaidAiLimits({
      chatGroupId: groupId,
      expectedMembershipVersion: 2,
      maxCreditsPerPeriod: 4000,
      maxCreditsPerRequest: 600,
      memberUserId: memberId,
    });
    expect(updated).toMatchObject({ membershipVersion: 3 });
    await expect(
      owner.setMemberPaidAiLimits({
        chatGroupId: groupId,
        expectedMembershipVersion: 2,
        maxCreditsPerPeriod: 5000,
        maxCreditsPerRequest: 700,
        memberUserId: memberId,
      }),
    ).rejects.toThrow('CHAT_GROUP_MEMBERSHIP_VERSION_CONFLICT');

    await expect(
      owner.revokeMemberPaidAi({
        chatGroupId: groupId,
        expectedMembershipVersion: 3,
        memberUserId: memberId,
      }),
    ).resolves.toMatchObject({
      canUsePaidAi: false,
      maxCreditsPerPeriod: null,
      maxCreditsPerRequest: null,
      membershipVersion: 4,
    });
  });

  it('resolves only an active authorized member and returns versioned limits', async () => {
    const owner = new ChatGroupSponsoredCreditModel(db, ownerId);
    await enablePolicy();
    await owner.setMemberPaidAiLimits({
      chatGroupId: groupId,
      expectedMembershipVersion: 1,
      maxCreditsPerPeriod: 3000,
      maxCreditsPerRequest: 500,
      memberUserId: memberId,
    });
    const member = new ChatGroupSponsoredCreditModel(db, memberId);

    await expect(
      member.resolveAdmission({ chatGroupId: groupId, maxCredits: 500 }),
    ).resolves.toEqual(
      expect.objectContaining({
        actorUserId: memberId,
        groupPeriodLimitCredits: 10_000,
        maxCreditsPerPeriod: 3000,
        maxCreditsPerRequest: 500,
        membershipVersion: 2,
        payerUserId: ownerId,
        policyVersion: 1,
      }),
    );
    await expect(
      member.resolveAdmission({ chatGroupId: groupId, maxCredits: 501 }),
    ).rejects.toThrow(CHAT_GROUP_SPONSORED_CREDIT_INVALID_LIMIT);

    await owner.revokeMemberPaidAi({
      chatGroupId: groupId,
      expectedMembershipVersion: 2,
      memberUserId: memberId,
    });
    await expect(member.resolveAdmission({ chatGroupId: groupId, maxCredits: 1 })).rejects.toThrow(
      CHAT_GROUP_SPONSORED_CREDIT_MEMBER_NOT_AUTHORIZED,
    );
  });

  it.each([
    [
      'owner banned',
      async () => db.update(users).set({ banned: true }).where(eq(users.id, ownerId)),
      CHAT_GROUP_SPONSORED_CREDIT_PRINCIPAL_BLOCKED,
    ],
    [
      'member banned',
      async () => db.update(users).set({ banned: true }).where(eq(users.id, memberId)),
      CHAT_GROUP_SPONSORED_CREDIT_PRINCIPAL_BLOCKED,
    ],
    [
      'workspace frozen',
      async () => {
        await db.update(chatGroups).set({ workspaceId }).where(eq(chatGroups.id, groupId));
        await db.update(workspaces).set({ frozen: true }).where(eq(workspaces.id, workspaceId));
      },
      CHAT_GROUP_SPONSORED_CREDIT_WORKSPACE_FROZEN,
    ],
  ] as const)('fails closed when %s', async (_case, block, expectedError) => {
    const owner = new ChatGroupSponsoredCreditModel(db, ownerId);
    await enablePolicy();
    await owner.setMemberPaidAiLimits({
      chatGroupId: groupId,
      expectedMembershipVersion: 1,
      maxCreditsPerPeriod: 3000,
      maxCreditsPerRequest: 500,
      memberUserId: memberId,
    });
    await block();

    await expect(
      new ChatGroupSponsoredCreditModel(db, memberId).resolveAdmission({
        chatGroupId: groupId,
        maxCredits: 100,
      }),
    ).rejects.toThrow(expectedError);
  });

  it.each([
    [
      'owner is banned',
      async () => db.update(users).set({ banned: true }).where(eq(users.id, ownerId)),
      CHAT_GROUP_SPONSORED_CREDIT_PRINCIPAL_BLOCKED,
    ],
    [
      'member is banned',
      async () => db.update(users).set({ banned: true }).where(eq(users.id, memberId)),
      CHAT_GROUP_SPONSORED_CREDIT_PRINCIPAL_BLOCKED,
    ],
    [
      'workspace is frozen',
      async () => {
        await db.update(chatGroups).set({ workspaceId }).where(eq(chatGroups.id, groupId));
        await db.update(workspaces).set({ frozen: true }).where(eq(workspaces.id, workspaceId));
      },
      CHAT_GROUP_SPONSORED_CREDIT_WORKSPACE_FROZEN,
    ],
  ] as const)('fails closed when granting and %s', async (_case, block, expectedError) => {
    await enablePolicy();
    await block();

    await expect(
      new ChatGroupSponsoredCreditModel(db, ownerId).setMemberPaidAiLimits({
        chatGroupId: groupId,
        expectedMembershipVersion: 1,
        maxCreditsPerPeriod: 3000,
        maxCreditsPerRequest: 500,
        memberUserId: memberId,
      }),
    ).rejects.toThrow(expectedError);
  });
});

describe('ChatGroupSponsoredCreditModel atomic sponsored budget admission', () => {
  it('holds only the current owner account and writes the complete immutable authorization snapshot', async () => {
    await topUpOwner();
    await enablePolicy();
    await grantMember();

    const budget = await reserveSponsored();

    expect(budget).toMatchObject({
      actorUserId: memberId,
      actorUserIdSnapshot: memberId,
      authorizationKind: 'group_member_sponsored',
      authorizedCredits: 400,
      sponsorChatGroupIdSnapshot: groupId,
      sponsorGroupPeriodLimitCreditsSnapshot: 10_000,
      sponsorMemberPeriodLimitCreditsSnapshot: 3000,
      sponsorMemberRequestLimitCreditsSnapshot: 500,
      sponsorMembershipVersionSnapshot: 2,
      sponsorPolicyVersionSnapshot: 1,
      userId: ownerId,
      userIdSnapshot: ownerId,
      workspaceId: null,
    });
    expect(budget.sponsorPeriodStartedAtSnapshot).toBeInstanceOf(Date);
    expect(budget.sponsorPeriodEndsAtSnapshot).toBeInstanceOf(Date);

    await expect(new PlatformCreditModel(db, ownerId).getAvailableCredits()).resolves.toMatchObject(
      {
        availableCredits: 9600,
        balanceCredits: 10_000,
        heldCredits: 400,
      },
    );
    await expect(
      new PlatformCreditModel(db, memberId).getAvailableCredits(),
    ).resolves.toMatchObject({
      availableCredits: 0,
      balanceCredits: 0,
      heldCredits: 0,
    });
  });

  it('returns an exact idempotent replay but rejects changed request or authorization input', async () => {
    await topUpOwner();
    await enablePolicy();
    await grantMember();

    const first = await reserveSponsored();
    await expect(reserveSponsored()).resolves.toMatchObject({ id: first.id });
    await expect(reserveSponsored({ authorizedCredits: 399 })).rejects.toThrow(
      PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT,
    );
    await expect(reserveSponsored({ expectedMembershipVersion: 1 })).rejects.toThrow(
      PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT,
    );

    await new ChatGroupSponsoredCreditModel(db, ownerId).updatePolicyLimit({
      chatGroupId: groupId,
      expectedPolicyVersion: 1,
      groupPeriodLimitCredits: 9000,
    });
    await expect(reserveSponsored()).rejects.toThrow(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);
  });

  it('fails closed after revocation, owner transfer, or loss of the default private-group identity', async () => {
    await topUpOwner();
    await enablePolicy();
    await grantMember();
    const owner = new ChatGroupSponsoredCreditModel(db, ownerId);

    await owner.revokeMemberPaidAi({
      chatGroupId: groupId,
      expectedMembershipVersion: 2,
      memberUserId: memberId,
    });
    await expect(reserveSponsored()).rejects.toThrow(
      CHAT_GROUP_SPONSORED_CREDIT_MEMBER_NOT_AUTHORIZED,
    );

    await db
      .update(chatGroupUserMemberships)
      .set({
        canUsePaidAi: true,
        maxCreditsPerPeriod: 3000,
        maxCreditsPerRequest: 500,
        membershipVersion: 4,
      })
      .where(eq(chatGroupUserMemberships.userId, memberId));
    await db.update(chatGroups).set({ userId: outsiderId }).where(eq(chatGroups.id, groupId));
    await expect(reserveSponsored({ expectedMembershipVersion: 4 })).rejects.toThrow(
      CHAT_GROUP_SPONSORED_CREDIT_POLICY_DISABLED,
    );

    await db
      .update(chatGroups)
      .set({ userId: ownerId, clientId: 'ordinary-group' })
      .where(eq(chatGroups.id, groupId));
    await expect(reserveSponsored({ expectedMembershipVersion: 4 })).rejects.toThrow(
      CHAT_GROUP_SPONSORED_CREDIT_FORBIDDEN,
    );
  });

  it('counts active authorization and settled consumption against group and member period limits', async () => {
    await topUpOwner();
    await enablePolicy();
    await grantMember({ maxCreditsPerPeriod: 700, maxCreditsPerRequest: 500 });
    const policy = await new ChatGroupSponsoredCreditModel(db, ownerId).getPolicy(groupId);

    await reserveSponsored({ authorizedCredits: 400 });
    await expect(
      reserveSponsored({
        authorizedCredits: 301,
        idempotencyKey: 'sponsored-budget:member-limit',
        requestHash: 'sponsored-request:member-limit',
        sourceId: 'group-message:member-limit',
      }),
    ).rejects.toThrow(CHAT_GROUP_SPONSORED_CREDIT_INVALID_LIMIT);

    await db
      .update(platformCreditBudgets)
      .set({ consumedCredits: 250, status: 'settled' })
      .where(eq(platformCreditBudgets.id, (await reserveSponsored()).id));
    await expect(
      reserveSponsored({
        authorizedCredits: 451,
        idempotencyKey: 'sponsored-budget:settled-limit',
        requestHash: 'sponsored-request:settled-limit',
        sourceId: 'group-message:settled-limit',
      }),
    ).rejects.toThrow(CHAT_GROUP_SPONSORED_CREDIT_INVALID_LIMIT);

    const [usage] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(platformCreditBudgets)
      .where(
        and(
          eq(platformCreditBudgets.sponsorChatGroupIdSnapshot, groupId),
          eq(platformCreditBudgets.sponsorPeriodStartedAtSnapshot, policy!.periodStartedAt),
        ),
      );
    expect(usage.count).toBe(1);
  });

  it('enforces the shared group-period cap independently of the member-period cap', async () => {
    await topUpOwner();
    await enablePolicy();
    await new ChatGroupSponsoredCreditModel(db, ownerId).updatePolicyLimit({
      chatGroupId: groupId,
      expectedPolicyVersion: 1,
      groupPeriodLimitCredits: 700,
    });
    await grantMember({ maxCreditsPerPeriod: 3000, maxCreditsPerRequest: 500 });

    await reserveSponsored({ expectedPolicyVersion: 2 });
    await expect(
      reserveSponsored({
        authorizedCredits: 301,
        expectedPolicyVersion: 2,
        idempotencyKey: 'sponsored-budget:group-limit',
        requestHash: 'sponsored-request:group-limit',
        sourceId: 'group-message:group-limit',
      }),
    ).rejects.toThrow(CHAT_GROUP_SPONSORED_CREDIT_INVALID_LIMIT);
  });

  it('serializes concurrent admissions so the shared group cap cannot be overcommitted', async () => {
    await topUpOwner();
    await enablePolicy();
    await new ChatGroupSponsoredCreditModel(db, ownerId).updatePolicyLimit({
      chatGroupId: groupId,
      expectedPolicyVersion: 1,
      groupPeriodLimitCredits: 700,
    });
    await grantMember({ maxCreditsPerPeriod: 3000, maxCreditsPerRequest: 500 });

    const results = await Promise.allSettled([
      reserveSponsored({
        expectedPolicyVersion: 2,
        idempotencyKey: 'sponsored-budget:concurrent-a',
        requestHash: 'sponsored-request:concurrent-a',
        sourceId: 'group-message:concurrent-a',
      }),
      reserveSponsored({
        expectedPolicyVersion: 2,
        idempotencyKey: 'sponsored-budget:concurrent-b',
        requestHash: 'sponsored-request:concurrent-b',
        sourceId: 'group-message:concurrent-b',
      }),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    await expect(new PlatformCreditModel(db, ownerId).getAvailableCredits()).resolves.toMatchObject(
      {
        availableCredits: 9600,
        heldCredits: 400,
      },
    );
  });

  it.each([
    [
      'owner banned',
      async () => db.update(users).set({ banned: true }).where(eq(users.id, ownerId)),
      CHAT_GROUP_SPONSORED_CREDIT_PRINCIPAL_BLOCKED,
    ],
    [
      'member banned',
      async () => db.update(users).set({ banned: true }).where(eq(users.id, memberId)),
      CHAT_GROUP_SPONSORED_CREDIT_PRINCIPAL_BLOCKED,
    ],
  ] as const)('does not reserve when %s', async (_case, block, expectedError) => {
    await topUpOwner();
    await enablePolicy();
    await grantMember();
    await block();

    await expect(reserveSponsored()).rejects.toThrow(expectedError);
    await expect(new PlatformCreditModel(db, ownerId).getAvailableCredits()).resolves.toMatchObject(
      {
        availableCredits: 10_000,
        heldCredits: 0,
      },
    );
  });

  it('rejects sponsored admission for a workspace-scoped group even when the workspace is active', async () => {
    await topUpOwner();
    await enablePolicy();
    await grantMember();
    await db.update(chatGroups).set({ workspaceId }).where(eq(chatGroups.id, groupId));

    await expect(reserveSponsored()).rejects.toThrow(CHAT_GROUP_SPONSORED_CREDIT_FORBIDDEN);
    await expect(new PlatformCreditModel(db, ownerId).getAvailableCredits()).resolves.toMatchObject(
      {
        availableCredits: 10_000,
        heldCredits: 0,
      },
    );
  });

  it('never falls back to the actor balance when the owner cannot cover the hold', async () => {
    await topUpOwner(100, 'insufficient-owner');
    await new PlatformCreditAdminModel(db, outsiderId).topUp({
      credits: 10_000,
      idempotencyKey: 'sponsored-top-up:member-rich',
      reason: '成员余额不可代替群主',
      targetUserId: memberId,
    });
    await enablePolicy();
    await grantMember();

    await expect(reserveSponsored()).rejects.toThrow(PLATFORM_CREDIT_INSUFFICIENT_BALANCE);
    await expect(
      new PlatformCreditModel(db, memberId).getAvailableCredits(),
    ).resolves.toMatchObject({
      availableCredits: 10_000,
      balanceCredits: 10_000,
      heldCredits: 0,
    });
  });
});

describe('ChatGroupSponsoredCreditModel sponsored provider admission', () => {
  it('reserves only the remaining sponsored budget and atomically claims it once', async () => {
    await topUpOwner();
    await enablePolicy();
    await grantMember();
    const sponsored = new ChatGroupSponsoredCreditModel(db, memberId);

    const reservation = await reserveSponsoredRemainingCall();
    expect(reservation).toMatchObject({ reservedCredits: 400, status: 'reserved' });
    const first = await sponsored.claimSponsoredReservationForProvider({
      leaseVersion: reservation.leaseVersion,
      reservationId: reservation.id,
    });
    const replay = await sponsored.claimSponsoredReservationForProvider({
      leaseVersion: reservation.leaseVersion,
      reservationId: reservation.id,
    });

    expect(first).toMatchObject({
      reservation: { status: 'provider_started' },
      shouldCallProvider: true,
    });
    expect(replay).toMatchObject({
      reservation: { status: 'provider_started' },
      shouldCallProvider: false,
    });
    const [actorAccount] = await db
      .select()
      .from(platformCreditAccounts)
      .where(eq(platformCreditAccounts.userIdSnapshot, memberId));
    expect(actorAccount).toBeUndefined();
  });

  it('allocates only the unreserved remainder and replays the same logical call', async () => {
    await topUpOwner();
    await enablePolicy();
    await grantMember();
    const budget = await reserveSponsored();
    const [account] = await db
      .select()
      .from(platformCreditAccounts)
      .where(eq(platformCreditAccounts.userIdSnapshot, ownerId));
    const expiresAt = new Date(Date.now() + 30_000);
    await db.insert(platformCreditReservations).values({
      accountId: account.id,
      budgetId: budget.id,
      callKind: 'call_llm',
      expiresAt,
      generationId: 'already-allocated',
      idempotencyKey: 'already-allocated',
      model: 'model-a',
      provider: 'provider-a',
      reservedCredits: 100,
      settledCredits: 0,
      status: 'reserved',
    });
    const sponsored = new ChatGroupSponsoredCreditModel(db, memberId);
    const input = {
      budgetId: budget.id,
      budgetLeaseVersion: budget.leaseVersion,
      callKind: 'call_llm' as const,
      expiresAt,
      generationId: 'remaining-allocation',
      idempotencyKey: 'remaining-allocation',
      model: 'model-a',
      provider: 'provider-a',
      requestHash: 'remaining-allocation-request',
    };

    const remaining = await sponsored.reserveSponsoredRemainingCall(input);
    expect(remaining.reservedCredits).toBe(300);
    await expect(sponsored.reserveSponsoredRemainingCall(input)).resolves.toMatchObject({
      id: remaining.id,
      reservedCredits: 300,
    });
  });

  it('does not let another member reserve or release an actor-owned sponsored call', async () => {
    await topUpOwner();
    await enablePolicy();
    await grantMember();
    const reservation = await reserveSponsoredRemainingCall();
    const outsider = new ChatGroupSponsoredCreditModel(db, outsiderId);

    await expect(
      outsider.reserveSponsoredRemainingCall({
        budgetId: reservation.budgetId,
        budgetLeaseVersion: 1,
        callKind: 'call_llm',
        expiresAt: new Date(Date.now() + 20_000),
        generationId: 'idor-generation',
        idempotencyKey: 'idor-call',
        model: 'model-a',
        provider: 'provider-a',
        requestHash: 'idor-request',
      }),
    ).rejects.toThrow(CHAT_GROUP_SPONSORED_CREDIT_FORBIDDEN);
    await expect(
      outsider.claimSponsoredReservationForProvider({
        leaseVersion: reservation.leaseVersion,
        reservationId: reservation.id,
      }),
    ).rejects.toThrow(CHAT_GROUP_SPONSORED_CREDIT_FORBIDDEN);
    const [stored] = await db
      .select()
      .from(platformCreditReservations)
      .where(eq(platformCreditReservations.id, reservation.id));
    expect(stored.status).toBe('reserved');
  });

  it.each([
    [
      'policy disabled',
      async () =>
        new ChatGroupSponsoredCreditModel(db, ownerId).disablePolicy({
          chatGroupId: groupId,
          expectedPolicyVersion: 1,
        }),
    ],
    [
      'member revoked',
      async () =>
        new ChatGroupSponsoredCreditModel(db, ownerId).revokeMemberPaidAi({
          chatGroupId: groupId,
          expectedMembershipVersion: 2,
          memberUserId: memberId,
        }),
    ],
    [
      'member left',
      async () =>
        db
          .update(chatGroupUserMemberships)
          .set({ removedAt: new Date() })
          .where(eq(chatGroupUserMemberships.userId, memberId)),
    ],
    [
      'owner transferred',
      async () =>
        db.update(chatGroups).set({ userId: outsiderId }).where(eq(chatGroups.id, groupId)),
    ],
    [
      'membership version drifted',
      async () =>
        db
          .update(chatGroupUserMemberships)
          .set({ membershipVersion: 3 })
          .where(eq(chatGroupUserMemberships.userId, memberId)),
    ],
    [
      'policy version drifted',
      async () =>
        new ChatGroupSponsoredCreditModel(db, ownerId).updatePolicyLimit({
          chatGroupId: groupId,
          expectedPolicyVersion: 1,
          groupPeriodLimitCredits: 9000,
        }),
    ],
  ] as const)('releases the hold without provider admission when %s', async (_case, invalidate) => {
    await topUpOwner();
    await enablePolicy();
    await grantMember();
    const reservation = await reserveSponsoredRemainingCall();
    await invalidate();

    const claim = await new ChatGroupSponsoredCreditModel(
      db,
      memberId,
    ).claimSponsoredReservationForProvider({
      leaseVersion: reservation.leaseVersion,
      reservationId: reservation.id,
    });

    expect(claim).toMatchObject({
      denial: CHAT_GROUP_SPONSORED_CREDIT_CLAIM_DENIED,
      reservation: { status: 'released' },
      shouldCallProvider: false,
    });
  });

  it('allows exactly one concurrent provider claimant', async () => {
    await topUpOwner();
    await enablePolicy();
    await grantMember();
    const reservation = await reserveSponsoredRemainingCall();
    const sponsored = new ChatGroupSponsoredCreditModel(db, memberId);

    const claims = await Promise.all([
      sponsored.claimSponsoredReservationForProvider({
        leaseVersion: reservation.leaseVersion,
        reservationId: reservation.id,
      }),
      sponsored.claimSponsoredReservationForProvider({
        leaseVersion: reservation.leaseVersion,
        reservationId: reservation.id,
      }),
    ]);

    expect(claims.filter(({ shouldCallProvider }) => shouldCallProvider)).toHaveLength(1);
    expect(claims.every(({ reservation: item }) => item.status === 'provider_started')).toBe(true);
  });
});

describe('ChatGroupSponsoredCreditModel audit contract', () => {
  it('enforces the disabled/null or enabled/positive membership limit invariant', async () => {
    await expect(
      db
        .update(chatGroupUserMemberships)
        .set({ maxCreditsPerPeriod: 3000, maxCreditsPerRequest: 500 })
        .where(eq(chatGroupUserMemberships.userId, memberId)),
    ).rejects.toThrow();
    await expect(
      db
        .update(chatGroupUserMemberships)
        .set({ canUsePaidAi: true })
        .where(eq(chatGroupUserMemberships.userId, memberId)),
    ).rejects.toThrow();

    await expect(
      db
        .update(chatGroupUserMemberships)
        .set({
          canUsePaidAi: true,
          maxCreditsPerPeriod: 3000,
          maxCreditsPerRequest: 500,
        })
        .where(eq(chatGroupUserMemberships.userId, memberId)),
    ).resolves.toBeDefined();
  });

  it('stores only the fixed audit whitelist without prompt, token, hash or key fields', async () => {
    const owner = new ChatGroupSponsoredCreditModel(db, ownerId);
    await enablePolicy();
    await owner.setMemberPaidAiLimits({
      chatGroupId: groupId,
      expectedMembershipVersion: 1,
      maxCreditsPerPeriod: 3000,
      maxCreditsPerRequest: 500,
      memberUserId: memberId,
    });

    const audits = await db.select().from(chatGroupSponsoredCreditAudits);
    const columnKeys = Object.keys(getTableColumns(chatGroupSponsoredCreditAudits)).sort();

    expect(audits).toHaveLength(2);
    expect(columnKeys).toEqual([
      'action',
      'actorUserIdSnapshot',
      'chatGroupIdSnapshot',
      'createdAt',
      'enabled',
      'groupPeriodLimitCredits',
      'id',
      'memberPeriodLimitCredits',
      'memberRequestLimitCredits',
      'membershipVersion',
      'payerUserIdSnapshot',
      'policyVersion',
      'targetUserIdSnapshot',
    ]);
    expect(JSON.stringify(audits)).not.toMatch(/prompt|token|hash|key/i);
    expect(audits.map(({ action }) => action)).toEqual(['policy_enabled', 'member_granted']);
  });

  it('defines policy schema defaults and database checks', () => {
    expect(chatGroupSponsoredCreditPolicies.enabled.default).toBe(false);
    expect(Object.keys(getTableColumns(chatGroupSponsoredCreditPolicies))).toEqual(
      expect.arrayContaining(['groupPeriodLimitCredits', 'policyVersion', 'periodDurationSeconds']),
    );
  });
});
