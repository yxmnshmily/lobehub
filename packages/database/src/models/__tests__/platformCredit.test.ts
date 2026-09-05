// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { CREDITS_PER_DOLLAR } from '@lobechat/const/currency';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  platformCreditBudgets,
  platformCreditEntries,
  platformCreditReservations,
} from '../../schemas/platformCredit';
import type { LobeChatDatabase } from '../../type';
import {
  PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT,
  PLATFORM_CREDIT_INSUFFICIENT_BALANCE,
  PLATFORM_CREDIT_INVALID_AMOUNT,
  PLATFORM_CREDIT_INVALID_USAGE,
  PLATFORM_CREDIT_REVERSAL_ALREADY_EXISTS,
  PLATFORM_CREDIT_SPONSORED_AUTHORIZATION_UNAVAILABLE,
  PlatformCreditAdminModel,
  PlatformCreditModel,
} from '../platformCredit';

const userA = 'credit-user-a';
const userB = 'credit-user-b';
const adminId = 'credit-admin';

let client: PGlite;
let db: LobeChatDatabase;

const migrationPaths = [
  path.join(__dirname, '../../../migrations/0156_platform_credit_ledger.sql'),
  path.join(__dirname, '../../../migrations/0161_platform_credit_reservations.sql'),
];

const applyMigration = async (database: PGlite, migrationPath: string) => {
  const statements = readFileSync(migrationPath, 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) await database.exec(statement);
};

const applyBudgetAuthorizationSnapshotContract = (database: PGlite) =>
  database.exec(`
    ALTER TABLE platform_credit_budgets
      ADD COLUMN actor_user_id text REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN actor_user_id_snapshot text NOT NULL,
      ADD COLUMN authorization_kind text NOT NULL,
      ADD COLUMN sponsor_chat_group_id_snapshot text,
      ADD COLUMN sponsor_policy_version_snapshot integer,
      ADD COLUMN sponsor_membership_version_snapshot integer,
      ADD COLUMN sponsor_period_started_at_snapshot timestamptz,
      ADD COLUMN sponsor_period_ends_at_snapshot timestamptz,
      ADD COLUMN sponsor_group_period_limit_credits_snapshot bigint,
      ADD COLUMN sponsor_member_period_limit_credits_snapshot bigint,
      ADD COLUMN sponsor_member_request_limit_credits_snapshot bigint,
      ADD CONSTRAINT platform_credit_budgets_authorization_kind_valid CHECK (
        authorization_kind IN ('self', 'group_member_sponsored')
      ),
      ADD CONSTRAINT platform_credit_budgets_authorization_snapshot_valid CHECK (
        (
          authorization_kind = 'self'
          AND actor_user_id_snapshot = user_id_snapshot
          AND sponsor_chat_group_id_snapshot IS NULL
          AND sponsor_policy_version_snapshot IS NULL
          AND sponsor_membership_version_snapshot IS NULL
          AND sponsor_period_started_at_snapshot IS NULL
          AND sponsor_period_ends_at_snapshot IS NULL
          AND sponsor_group_period_limit_credits_snapshot IS NULL
          AND sponsor_member_period_limit_credits_snapshot IS NULL
          AND sponsor_member_request_limit_credits_snapshot IS NULL
        ) OR (
          authorization_kind = 'group_member_sponsored'
          AND actor_user_id_snapshot <> user_id_snapshot
          AND sponsor_chat_group_id_snapshot IS NOT NULL
          AND length(trim(sponsor_chat_group_id_snapshot)) > 0
          AND sponsor_policy_version_snapshot IS NOT NULL
          AND sponsor_policy_version_snapshot > 0
          AND sponsor_membership_version_snapshot IS NOT NULL
          AND sponsor_membership_version_snapshot > 0
          AND sponsor_period_started_at_snapshot IS NOT NULL
          AND sponsor_period_ends_at_snapshot IS NOT NULL
          AND sponsor_period_ends_at_snapshot > sponsor_period_started_at_snapshot
          AND sponsor_group_period_limit_credits_snapshot IS NOT NULL
          AND sponsor_group_period_limit_credits_snapshot > 0
          AND sponsor_group_period_limit_credits_snapshot <= 9007199254740991
          AND sponsor_member_period_limit_credits_snapshot IS NOT NULL
          AND sponsor_member_period_limit_credits_snapshot > 0
          AND sponsor_member_period_limit_credits_snapshot <= 9007199254740991
          AND sponsor_member_request_limit_credits_snapshot IS NOT NULL
          AND sponsor_member_request_limit_credits_snapshot > 0
          AND sponsor_member_request_limit_credits_snapshot
            <= sponsor_member_period_limit_credits_snapshot
          AND sponsor_member_request_limit_credits_snapshot
            <= sponsor_group_period_limit_credits_snapshot
        )
      );
    CREATE INDEX platform_credit_budgets_actor_status_idx
      ON platform_credit_budgets(actor_user_id, status);
    CREATE INDEX platform_credit_budgets_sponsor_group_period_status_idx
      ON platform_credit_budgets(
        sponsor_chat_group_id_snapshot,
        sponsor_period_started_at_snapshot,
        status
      );
    CREATE INDEX platform_credit_budgets_sponsor_actor_period_status_idx
      ON platform_credit_budgets(
        sponsor_chat_group_id_snapshot,
        actor_user_id_snapshot,
        sponsor_period_started_at_snapshot,
        status
      );
  `);

const createBudgetFixture = async (suffix: string, expiresAt: Date, authorizedCredits = 100) => {
  await new PlatformCreditAdminModel(db, adminId).topUp({
    credits: 100,
    idempotencyKey: `top-up:a:${suffix}`,
    reason: '预留回收测试',
    targetUserId: userA,
  });
  const ledger = new PlatformCreditModel(db, userA);
  const budget = await ledger.reserveBudget({
    authorizedCredits,
    expiresAt,
    idempotencyKey: `budget:a:${suffix}`,
    requestHash: `request:${suffix}`,
    sourceId: `operation:${suffix}`,
    sourceType: 'agent-operation',
  });
  return { budget, ledger };
};

const reserveFixtureCall = async (
  ledger: PlatformCreditModel,
  budgetId: string,
  suffix: string,
  expiresAt: Date,
  reservedCredits: number,
) =>
  ledger.reserveCall({
    budgetId,
    callKind: 'call_llm',
    expiresAt,
    generationId: `operation:${suffix}:step:0:call_llm`,
    idempotencyKey: `reservation:a:${suffix}`,
    model: 'model',
    provider: 'provider',
    reservedCredits,
  });

const createSponsoredBudgetFixture = async (suffix: string) => {
  await new PlatformCreditAdminModel(db, adminId).topUp({
    credits: 100,
    idempotencyKey: `top-up:a:sponsored:${suffix}`,
    reason: '代付预算通用入口隔离测试',
    targetUserId: userA,
  });
  const ledger = new PlatformCreditModel(db, userA);
  const account = await ledger.getAccount();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60_000);
  const [budget] = await db
    .insert(platformCreditBudgets)
    .values({
      accountId: account.id,
      actorUserId: userB,
      actorUserIdSnapshot: userB,
      authorizationKind: 'group_member_sponsored',
      authorizedCredits: 100,
      consumedCredits: 0,
      expiresAt,
      idempotencyKey: `budget:a:sponsored:${suffix}`,
      requestHash: `request:sponsored:${suffix}`,
      sourceId: `operation:sponsored:${suffix}`,
      sourceType: 'group-chat',
      sponsorChatGroupIdSnapshot: 'sponsored-group',
      sponsorGroupPeriodLimitCreditsSnapshot: 1000,
      sponsorMemberPeriodLimitCreditsSnapshot: 500,
      sponsorMemberRequestLimitCreditsSnapshot: 100,
      sponsorMembershipVersionSnapshot: 1,
      sponsorPeriodEndsAtSnapshot: expiresAt,
      sponsorPeriodStartedAtSnapshot: now,
      sponsorPolicyVersionSnapshot: 1,
      status: 'active',
      userId: userA,
      userIdSnapshot: userA,
      workspaceId: null,
    })
    .returning();
  return { account, budget, expiresAt, ledger };
};

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client) as unknown as LobeChatDatabase;

  await client.exec(`
    CREATE TABLE users (id text PRIMARY KEY);
    INSERT INTO users (id) VALUES ('${userA}'), ('${userB}'), ('${adminId}');
  `);
  for (const migrationPath of migrationPaths) await applyMigration(client, migrationPath);
  await applyBudgetAuthorizationSnapshotContract(client);
});

describe('PlatformCreditModel', () => {
  it('rejects sponsored budgets from every generic call and provider-claim entry', async () => {
    const { account, budget, expiresAt, ledger } =
      await createSponsoredBudgetFixture('generic-entry-isolation');
    const call = {
      budgetId: budget.id,
      callKind: 'call_llm' as const,
      expiresAt,
      generationId: 'sponsored-generation',
      idempotencyKey: 'sponsored-reservation',
      model: 'model',
      provider: 'provider',
    };

    await expect(ledger.reserveCall({ ...call, reservedCredits: 10 })).rejects.toThrow(
      PLATFORM_CREDIT_SPONSORED_AUTHORIZATION_UNAVAILABLE,
    );
    await expect(
      ledger.reserveRemainingCall({
        ...call,
        budgetLeaseVersion: budget.leaseVersion,
        requestHash: 'sponsored-call-request',
      }),
    ).rejects.toThrow(PLATFORM_CREDIT_SPONSORED_AUTHORIZATION_UNAVAILABLE);

    const [reservation] = await db
      .insert(platformCreditReservations)
      .values({
        accountId: account.id,
        budgetId: budget.id,
        callKind: 'call_llm',
        expiresAt,
        generationId: 'sponsored-generation',
        idempotencyKey: 'sponsored-direct-reservation',
        model: 'model',
        provider: 'provider',
        reservedCredits: 10,
        settledCredits: 0,
        status: 'reserved',
        workspaceId: null,
      })
      .returning();
    await expect(
      ledger.claimReservationForProvider({
        leaseVersion: reservation.leaseVersion,
        reservationId: reservation.id,
      }),
    ).rejects.toThrow(PLATFORM_CREDIT_SPONSORED_AUTHORIZATION_UNAVAILABLE);
  });

  it('defines database checks for durable budget and call reservation states', () => {
    expect(getTableConfig(platformCreditBudgets).checks.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'platform_credit_budgets_amounts_valid',
        'platform_credit_budgets_authorization_snapshot_valid',
        'platform_credit_budgets_authorization_kind_valid',
        'platform_credit_budgets_status_valid',
      ]),
    );
    expect(getTableConfig(platformCreditReservations).checks.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'platform_credit_reservations_amounts_valid',
        'platform_credit_reservations_call_kind_valid',
        'platform_credit_reservations_completion_valid',
        'platform_credit_reservations_status_valid',
      ]),
    );
  });

  it('defines one durable source identity per Credits account', () => {
    expect(getTableConfig(platformCreditBudgets).indexes.map(({ config }) => config.name)).toEqual(
      expect.arrayContaining([
        'platform_credit_budgets_account_source_unique',
        'platform_credit_budgets_actor_status_idx',
        'platform_credit_budgets_sponsor_actor_period_status_idx',
        'platform_credit_budgets_sponsor_group_period_status_idx',
      ]),
    );
  });

  it('stores an immutable self-authorization snapshot on the legacy budget path', async () => {
    await new PlatformCreditAdminModel(db, adminId).topUp({
      credits: 100,
      idempotencyKey: 'top-up:a:self-snapshot',
      reason: '自费授权快照测试',
      targetUserId: userA,
    });
    const ledger = new PlatformCreditModel(db, userA);

    const budget = await ledger.reserveBudget({
      authorizedCredits: 40,
      expiresAt: new Date(Date.now() + 60_000),
      idempotencyKey: 'budget:a:self-snapshot',
      requestHash: 'request:self-snapshot',
      sourceId: 'operation:self-snapshot',
      sourceType: 'agent-operation',
    });

    expect(budget).toMatchObject({
      actorUserId: userA,
      actorUserIdSnapshot: userA,
      authorizationKind: 'self',
      sponsorChatGroupIdSnapshot: null,
      sponsorGroupPeriodLimitCreditsSnapshot: null,
      sponsorMemberPeriodLimitCreditsSnapshot: null,
      sponsorMemberRequestLimitCreditsSnapshot: null,
      sponsorMembershipVersionSnapshot: null,
      sponsorPeriodEndsAtSnapshot: null,
      sponsorPeriodStartedAtSnapshot: null,
      sponsorPolicyVersionSnapshot: null,
    });
    await expect(ledger.getAvailableCredits()).resolves.toEqual({
      availableCredits: 60,
      balanceCredits: 100,
      heldCredits: 40,
    });
  });

  it('rejects forged sponsored authorization on the self-only budget path', async () => {
    await new PlatformCreditAdminModel(db, adminId).topUp({
      credits: 100,
      idempotencyKey: 'top-up:a:forged-sponsor',
      reason: '伪造代付测试',
      targetUserId: userA,
    });
    const ledger = new PlatformCreditModel(db, userA);
    const forged = {
      actorUserId: userB,
      authorizationKind: 'group_member_sponsored',
      authorizedCredits: 40,
      expiresAt: new Date(Date.now() + 60_000),
      idempotencyKey: 'budget:a:forged-sponsor',
      requestHash: 'request:forged-sponsor',
      sourceId: 'operation:forged-sponsor',
      sourceType: 'agent-operation',
      sponsorChatGroupIdSnapshot: 'forged-group',
      sponsorGroupPeriodLimitCreditsSnapshot: 1000,
      sponsorMemberPeriodLimitCreditsSnapshot: 500,
      sponsorMemberRequestLimitCreditsSnapshot: 100,
      sponsorMembershipVersionSnapshot: 1,
      sponsorPeriodEndsAtSnapshot: new Date(Date.now() + 60_000),
      sponsorPeriodStartedAtSnapshot: new Date(),
      sponsorPolicyVersionSnapshot: 1,
    } as Parameters<typeof ledger.reserveBudget>[0];

    await expect(ledger.reserveBudget(forged)).rejects.toThrow(
      'PLATFORM_CREDIT_SPONSORED_AUTHORIZATION_UNAVAILABLE',
    );
    await expect(ledger.getAvailableCredits()).resolves.toMatchObject({ heldCredits: 0 });
  });

  it('resolves a source budget only within its owner and workspace scope', async () => {
    const admin = new PlatformCreditAdminModel(db, adminId);
    await admin.topUp({
      credits: 100,
      idempotencyKey: 'top-up:a:source-lookup',
      reason: '来源查询测试',
      targetUserId: userA,
    });
    await admin.topUp({
      credits: 100,
      idempotencyKey: 'top-up:b:source-lookup',
      reason: '来源查询测试',
      targetUserId: userB,
    });
    const ledgerA = new PlatformCreditModel(db, userA);
    const ledgerB = new PlatformCreditModel(db, userB);
    const expiresAt = new Date(Date.now() + 60_000);
    const budgetA = await ledgerA.reserveBudget({
      authorizedCredits: 40,
      expiresAt,
      idempotencyKey: 'budget:a:source-lookup',
      requestHash: 'request:a:source-lookup',
      sourceId: 'public-request-1',
      sourceType: 'website-ai',
      workspaceId: 'workspace-a',
    });
    const budgetB = await ledgerB.reserveBudget({
      authorizedCredits: 40,
      expiresAt,
      idempotencyKey: 'budget:b:source-lookup',
      requestHash: 'request:b:source-lookup',
      sourceId: 'public-request-1',
      sourceType: 'website-ai',
      workspaceId: 'workspace-b',
    });

    await expect(
      ledgerA.getBudgetBySource({
        sourceId: 'public-request-1',
        sourceType: 'website-ai',
        workspaceId: 'workspace-a',
      }),
    ).resolves.toMatchObject({ budget: { id: budgetA.id }, lifecycle: 'active' });
    await expect(
      ledgerA.getBudgetBySource({
        sourceId: 'public-request-1',
        sourceType: 'website-ai',
        workspaceId: 'workspace-b',
      }),
    ).resolves.toBeUndefined();
    await expect(
      ledgerB.getBudgetBySource({
        sourceId: 'public-request-1',
        sourceType: 'website-ai',
        workspaceId: 'workspace-a',
      }),
    ).resolves.toBeUndefined();
    await expect(
      ledgerB.getBudgetBySource({
        sourceId: 'public-request-1',
        sourceType: 'website-ai',
        workspaceId: 'workspace-b',
      }),
    ).resolves.toMatchObject({ budget: { id: budgetB.id }, lifecycle: 'active' });
  });

  it('returns an expired active source budget without releasing a provider-started call', async () => {
    const expiresAt = new Date(Date.now() + 1_000);
    const { budget, ledger } = await createBudgetFixture('source-expired-active', expiresAt);
    const reservation = await reserveFixtureCall(
      ledger,
      budget.id,
      'source-expired-active',
      expiresAt,
      100,
    );
    await ledger.claimReservationForProvider({
      leaseVersion: reservation.leaseVersion,
      reservationId: reservation.id,
    });
    const now = vi.spyOn(Date, 'now').mockReturnValue(expiresAt.getTime() + 1);

    try {
      await expect(
        ledger.getBudgetBySource({
          sourceId: 'operation:source-expired-active',
          sourceType: 'agent-operation',
        }),
      ).resolves.toMatchObject({
        budget: { id: budget.id, status: 'active' },
        lifecycle: 'expired_active',
      });
    } finally {
      now.mockRestore();
    }
    await expect(ledger.getReservation(reservation.id)).resolves.toMatchObject({
      status: 'provider_started',
    });
    await expect(ledger.getAvailableCredits()).resolves.toMatchObject({ heldCredits: 100 });
  });

  it('rejects a second budget for the same account source identity', async () => {
    const admin = new PlatformCreditAdminModel(db, adminId);
    await admin.topUp({
      credits: 100,
      idempotencyKey: 'top-up:a:source-unique',
      reason: '来源唯一性测试',
      targetUserId: userA,
    });
    const ledger = new PlatformCreditModel(db, userA);
    const expiresAt = new Date(Date.now() + 60_000);
    const source = { sourceId: 'public-request-unique', sourceType: 'website-ai' };
    await ledger.reserveBudget({
      ...source,
      authorizedCredits: 40,
      expiresAt,
      idempotencyKey: 'budget:a:source-unique:first',
      requestHash: 'request:a:source-unique:first',
    });

    await expect(
      ledger.reserveBudget({
        ...source,
        authorizedCredits: 40,
        expiresAt,
        idempotencyKey: 'budget:a:source-unique:second',
        requestHash: 'request:a:source-unique:second',
      }),
    ).rejects.toThrow(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);
  });

  it('serializes concurrent request budgets so held Credits cannot be overcommitted', async () => {
    const admin = new PlatformCreditAdminModel(db, adminId);
    await admin.topUp({
      credits: 100,
      idempotencyKey: 'top-up:a:budget-concurrency',
      reason: '并发预留测试',
      targetUserId: userA,
    });
    const ledger = new PlatformCreditModel(db, userA);
    const expiresAt = new Date(Date.now() + 60_000);

    const attempts = await Promise.allSettled([
      ledger.reserveBudget({
        authorizedCredits: 80,
        expiresAt,
        idempotencyKey: 'budget:a:concurrent-1',
        requestHash: 'request-1',
        sourceId: 'operation-1',
        sourceType: 'agent-operation',
      }),
      ledger.reserveBudget({
        authorizedCredits: 80,
        expiresAt,
        idempotencyKey: 'budget:a:concurrent-2',
        requestHash: 'request-2',
        sourceId: 'operation-2',
        sourceType: 'agent-operation',
      }),
    ]);

    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    await expect(ledger.getAvailableCredits()).resolves.toEqual({
      availableCredits: 20,
      balanceCredits: 100,
      heldCredits: 80,
    });
  });

  it('serializes concurrent call allocations within one request budget', async () => {
    const admin = new PlatformCreditAdminModel(db, adminId);
    await admin.topUp({
      credits: 100,
      idempotencyKey: 'top-up:a:call-concurrency',
      reason: '调用预留并发测试',
      targetUserId: userA,
    });
    const ledger = new PlatformCreditModel(db, userA);
    const expiresAt = new Date(Date.now() + 60_000);
    const budget = await ledger.reserveBudget({
      authorizedCredits: 100,
      expiresAt,
      idempotencyKey: 'budget:a:call-concurrency',
      requestHash: 'request-call-concurrency',
      sourceId: 'operation-call-concurrency',
      sourceType: 'agent-operation',
    });

    const attempts = await Promise.allSettled(
      ['a', 'b'].map((suffix) =>
        ledger.reserveCall({
          budgetId: budget.id,
          callKind: 'call_llm',
          expiresAt,
          generationId: `operation-call-concurrency:${suffix}`,
          idempotencyKey: `reservation:a:call-concurrency:${suffix}`,
          model: 'model',
          provider: 'provider',
          reservedCredits: 70,
        }),
      ),
    );

    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(1);
  });

  it('atomically grants the entire remaining request budget to only one concurrent call', async () => {
    const admin = new PlatformCreditAdminModel(db, adminId);
    await admin.topUp({
      credits: 100,
      idempotencyKey: 'top-up:a:remaining-call-concurrency',
      reason: '剩余额并发预留测试',
      targetUserId: userA,
    });
    const ledger = new PlatformCreditModel(db, userA);
    const callExpiresAt = new Date(Date.now() + 60_000);
    const budget = await ledger.reserveBudget({
      authorizedCredits: 100,
      expiresAt: callExpiresAt,
      idempotencyKey: 'budget:a:remaining-call-concurrency',
      requestHash: 'request-remaining-call-concurrency',
      sourceId: 'operation-remaining-call-concurrency',
      sourceType: 'agent-operation',
    });

    const attempts = await Promise.allSettled(
      ['a', 'b'].map((suffix) =>
        ledger.reserveRemainingCall({
          budgetId: budget.id,
          budgetLeaseVersion: budget.leaseVersion,
          callKind: 'call_llm',
          expiresAt: callExpiresAt,
          generationId: `operation-remaining-call-concurrency:${suffix}`,
          idempotencyKey: `remaining-call-concurrency:${suffix}`,
          model: 'model-a',
          provider: 'provider-a',
          requestHash: `request-remaining-call-concurrency:${suffix}`,
        }),
      ),
    );

    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const winner = attempts.find(({ status }) => status === 'fulfilled');
    expect(winner).toMatchObject({ value: { reservedCredits: 100, status: 'reserved' } });
    expect(attempts.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({ message: PLATFORM_CREDIT_INSUFFICIENT_BALANCE }),
    });
  });

  it('replays a remaining-call identity across lease metadata changes but conflicts on request drift', async () => {
    const { budget, ledger } = await createBudgetFixture(
      'remaining-call-replay',
      new Date(Date.now() + 120_000),
      100,
    );
    const callExpiresAt = new Date(Date.now() + 60_000);
    const input = {
      budgetId: budget.id,
      budgetLeaseVersion: budget.leaseVersion,
      callKind: 'call_llm' as const,
      expiresAt: callExpiresAt,
      generationId: 'operation:remaining-call-replay:step:0',
      generationType: 'agent-runtime-text-step',
      idempotencyKey: 'remaining-call-replay',
      model: 'model-a',
      provider: 'provider-a',
      requestHash: 'request-remaining-call-replay',
    };

    const first = await ledger.reserveRemainingCall(input);
    await expect(ledger.reserveRemainingCall(input)).resolves.toMatchObject({ id: first.id });
    await expect(
      ledger.reserveRemainingCall({
        ...input,
        budgetLeaseVersion: budget.leaseVersion + 1,
        expiresAt: new Date(callExpiresAt.getTime() + 1),
      }),
    ).resolves.toMatchObject({ expiresAt: first.expiresAt, id: first.id });

    await new PlatformCreditAdminModel(db, adminId).topUp({
      credits: 100,
      idempotencyKey: 'top-up:a:remaining-call-replay:second-budget',
      reason: '跨预算 call identity 测试',
      targetUserId: userA,
    });
    const otherBudget = await ledger.reserveBudget({
      authorizedCredits: 100,
      expiresAt: new Date(Date.now() + 120_000),
      idempotencyKey: 'budget:a:remaining-call-replay:second-budget',
      requestHash: 'request:remaining-call-replay:second-budget',
      sourceId: 'operation:remaining-call-replay:second-budget',
      sourceType: 'agent-operation',
    });
    await expect(
      ledger.reserveRemainingCall({
        ...input,
        budgetId: otherBudget.id,
        budgetLeaseVersion: otherBudget.leaseVersion,
        idempotencyKey: 'changed-budget-derived-input-digest',
      }),
    ).rejects.toThrow(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);

    await expect(ledger.reserveRemainingCall({ ...input, provider: 'provider-b' })).rejects.toThrow(
      PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT,
    );
    await expect(ledger.reserveRemainingCall({ ...input, model: 'model-b' })).rejects.toThrow(
      PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT,
    );
    await expect(
      ledger.reserveRemainingCall({ ...input, idempotencyKey: 'changed-input-digest' }),
    ).rejects.toThrow(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);
    await expect(
      ledger.reserveRemainingCall({
        ...input,
        expiresAt: new Date(callExpiresAt.getTime() + 1),
        requestHash: 'changed-expiry-independent-request',
      }),
    ).rejects.toThrow(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);

    await ledger.releaseReservation({
      leaseVersion: first.leaseVersion,
      reservationId: first.id,
    });
    await expect(
      ledger.reserveRemainingCall({
        ...input,
        generationId: 'operation:remaining-call-replay:step:1',
        requestHash: 'changed-request-under-the-same-logical-key',
      }),
    ).rejects.toThrow(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);
  });

  it('rejects a remaining-call lease that outlives its request budget', async () => {
    const budgetExpiresAt = new Date(Date.now() + 60_000);
    const { budget, ledger } = await createBudgetFixture(
      'remaining-call-child-expiry',
      budgetExpiresAt,
      100,
    );

    await expect(
      ledger.reserveRemainingCall({
        budgetId: budget.id,
        budgetLeaseVersion: budget.leaseVersion,
        callKind: 'call_llm',
        expiresAt: new Date(budgetExpiresAt.getTime() + 1),
        generationId: 'operation:remaining-call-child-expiry:step:0',
        idempotencyKey: 'remaining-call-child-expiry',
        model: 'model-a',
        provider: 'provider-a',
        requestHash: 'request-remaining-call-child-expiry',
      }),
    ).rejects.toThrow('Credits 预留状态无效');
  });

  it('rejects a stale request-budget lease before allocating the remaining Credits', async () => {
    const { budget, ledger } = await createBudgetFixture(
      'remaining-call-stale-budget',
      new Date(Date.now() + 120_000),
      100,
    );

    await expect(
      ledger.reserveRemainingCall({
        budgetId: budget.id,
        budgetLeaseVersion: budget.leaseVersion + 1,
        callKind: 'call_llm',
        expiresAt: new Date(Date.now() + 60_000),
        generationId: 'operation:remaining-call-stale-budget:step:0',
        idempotencyKey: 'remaining-call-stale-budget',
        model: 'model-a',
        provider: 'provider-a',
        requestHash: 'request-remaining-call-stale-budget',
      }),
    ).rejects.toThrow('Credits 预留租约已失效');
  });

  it('settles actual usage below the call reservation and releases the unused request budget', async () => {
    const admin = new PlatformCreditAdminModel(db, adminId);
    await admin.topUp({
      credits: 100,
      idempotencyKey: 'top-up:a:budget-settle',
      reason: '实际用量测试',
      targetUserId: userA,
    });
    const ledger = new PlatformCreditModel(db, userA);
    const expiresAt = new Date(Date.now() + 60_000);
    const budget = await ledger.reserveBudget({
      authorizedCredits: 80,
      expiresAt,
      idempotencyKey: 'budget:a:settle',
      requestHash: 'request-settle',
      sourceId: 'operation-settle',
      sourceType: 'agent-operation',
      workspaceId: 'workspace-a',
    });
    const reservation = await ledger.reserveCall({
      budgetId: budget.id,
      callKind: 'call_llm',
      expiresAt,
      generationId: 'operation-settle:step:0:call_llm',
      generationType: 'agent-runtime-text-step',
      idempotencyKey: 'reservation:a:settle',
      model: 'model-a',
      provider: 'provider-a',
      reservedCredits: 80,
      workspaceId: 'workspace-a',
    });
    const claimed = await ledger.claimReservationForProvider({
      leaseVersion: reservation.leaseVersion,
      reservationId: reservation.id,
    });
    await ledger.recordProviderCompletion({
      costUsd: 0.00003,
      credits: 30,
      leaseVersion: claimed.reservation.leaseVersion,
      providerRequestId: 'provider-request-a',
      reservationId: reservation.id,
      tokenUsage: { totalTokens: 30 },
    });

    const charge = await ledger.settleReservedUsage({
      actorUserId: userA,
      costUsd: 0.00003,
      credits: 30,
      generationId: 'operation-settle:step:0:call_llm',
      generationType: 'agent-runtime-text-step',
      idempotencyKey: 'platform-usage:v1:reserved-settle',
      leaseVersion: reservation.leaseVersion,
      model: 'model-a',
      provider: 'provider-a',
      reservationId: reservation.id,
      tokenUsage: { totalTokens: 30 },
      workspaceId: 'workspace-a',
    });

    expect(charge).toMatchObject({ amountCredits: -30, balanceAfterCredits: 70 });
    await expect(ledger.completeBudget(budget.id)).resolves.toMatchObject({
      consumedCredits: 30,
      status: 'settled',
    });
    await expect(ledger.getAvailableCredits()).resolves.toEqual({
      availableCredits: 70,
      balanceCredits: 70,
      heldCredits: 0,
    });
  });

  it('rolls the entire settlement back when actual usage exceeds the reservation', async () => {
    const admin = new PlatformCreditAdminModel(db, adminId);
    await admin.topUp({
      credits: 100,
      idempotencyKey: 'top-up:a:over-reservation',
      reason: '超预留测试',
      targetUserId: userA,
    });
    const ledger = new PlatformCreditModel(db, userA);
    const expiresAt = new Date(Date.now() + 60_000);
    const budget = await ledger.reserveBudget({
      authorizedCredits: 100,
      expiresAt,
      idempotencyKey: 'budget:a:over-reservation',
      requestHash: 'request-over-reservation',
      sourceId: 'operation-over-reservation',
      sourceType: 'agent-operation',
    });
    const reservation = await ledger.reserveCall({
      budgetId: budget.id,
      callKind: 'image',
      expiresAt,
      generationId: 'image-generation-a',
      generationType: 'platform-managed-image',
      idempotencyKey: 'reservation:a:over-reservation',
      model: 'image-model',
      provider: 'provider',
      reservedCredits: 40,
    });
    const claimed = await ledger.claimReservationForProvider({
      leaseVersion: reservation.leaseVersion,
      reservationId: reservation.id,
    });
    await ledger.recordProviderCompletion({
      costUsd: 0.00005,
      credits: 50,
      leaseVersion: claimed.reservation.leaseVersion,
      reservationId: reservation.id,
      tokenUsage: { totalTokens: 50 },
    });

    await expect(
      ledger.settleReservedUsage({
        actorUserId: userA,
        costUsd: 0.00005,
        credits: 50,
        generationId: 'image-generation-a',
        generationType: 'platform-managed-image',
        idempotencyKey: 'platform-usage:v1:over-reservation',
        leaseVersion: reservation.leaseVersion,
        model: 'image-model',
        provider: 'provider',
        reservationId: reservation.id,
        tokenUsage: { totalTokens: 50 },
      }),
    ).rejects.toThrow('实际用量超过 Credits 预留');

    await expect(ledger.getAccount()).resolves.toMatchObject({ balanceCredits: 100 });
    await expect(ledger.listEntries()).resolves.toHaveLength(1);
    await expect(ledger.getReservation(reservation.id)).resolves.toMatchObject({
      settledCredits: 0,
      status: 'provider_completed',
    });
  });

  it('replays exact budget and settlement requests but rejects changed request material', async () => {
    const admin = new PlatformCreditAdminModel(db, adminId);
    await admin.topUp({
      credits: 100,
      idempotencyKey: 'top-up:a:reservation-retry',
      reason: '幂等预留测试',
      targetUserId: userA,
    });
    const ledger = new PlatformCreditModel(db, userA);
    const expiresAt = new Date(Date.now() + 60_000);
    const budgetInput = {
      authorizedCredits: 50,
      expiresAt,
      idempotencyKey: 'budget:a:retry',
      requestHash: 'request-retry',
      sourceId: 'operation-retry',
      sourceType: 'agent-operation',
    };
    const budget = await ledger.reserveBudget(budgetInput);
    await expect(ledger.reserveBudget(budgetInput)).resolves.toMatchObject({ id: budget.id });
    const now = vi.spyOn(Date, 'now').mockReturnValue(expiresAt.getTime() + 1);
    try {
      await expect(ledger.reserveBudget(budgetInput)).resolves.toMatchObject({ id: budget.id });
    } finally {
      now.mockRestore();
    }
    await expect(
      ledger.reserveBudget({ ...budgetInput, requestHash: 'changed-request' }),
    ).rejects.toThrow(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);

    const reservationInput = {
      budgetId: budget.id,
      callKind: 'compress_context' as const,
      expiresAt,
      generationId: 'operation-retry:step:1:compress_context',
      generationType: 'agent-runtime-text-step',
      idempotencyKey: 'reservation:a:retry',
      model: 'model-a',
      provider: 'provider-a',
      reservedCredits: 50,
    };
    const reservation = await ledger.reserveCall(reservationInput);
    await expect(ledger.reserveCall(reservationInput)).resolves.toMatchObject({
      id: reservation.id,
    });
    const claimed = await ledger.claimReservationForProvider({
      leaseVersion: reservation.leaseVersion,
      reservationId: reservation.id,
    });
    await ledger.recordProviderCompletion({
      costUsd: 0.00002,
      credits: 20,
      leaseVersion: claimed.reservation.leaseVersion,
      reservationId: reservation.id,
      tokenUsage: { totalTokens: 20 },
    });
    const settlementInput = {
      actorUserId: userA,
      costUsd: 0.00002,
      credits: 20,
      generationId: reservationInput.generationId,
      generationType: reservationInput.generationType,
      idempotencyKey: 'platform-usage:v1:reservation-retry',
      leaseVersion: claimed.reservation.leaseVersion,
      model: reservationInput.model,
      provider: reservationInput.provider,
      reservationId: reservation.id,
      tokenUsage: { totalTokens: 20 },
    };
    const first = await ledger.settleReservedUsage(settlementInput);
    const replay = await ledger.settleReservedUsage(settlementInput);
    const completionReplay = await ledger.recordProviderCompletion({
      costUsd: 0.00002,
      credits: 20,
      leaseVersion: claimed.reservation.leaseVersion,
      reservationId: reservation.id,
      tokenUsage: { totalTokens: 20 },
    });

    expect(replay.id).toBe(first.id);
    expect(completionReplay).toMatchObject({ status: 'settled', usageEntryId: first.id });
    await expect(
      ledger.settleReservedUsage({
        ...settlementInput,
        idempotencyKey: 'platform-usage:v1:changed-reservation-retry',
      }),
    ).rejects.toThrow(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);
    await expect(ledger.getAccount()).resolves.toMatchObject({ balanceCredits: 80 });
  });

  it('keeps budgets scoped to their authenticated user and workspace', async () => {
    const admin = new PlatformCreditAdminModel(db, adminId);
    await admin.topUp({
      credits: 100,
      idempotencyKey: 'top-up:a:budget-scope',
      reason: '归属测试',
      targetUserId: userA,
    });
    const ledgerA = new PlatformCreditModel(db, userA);
    const ledgerB = new PlatformCreditModel(db, userB);
    const expiresAt = new Date(Date.now() + 60_000);
    const budget = await ledgerA.reserveBudget({
      authorizedCredits: 40,
      expiresAt,
      idempotencyKey: 'budget:a:scope',
      requestHash: 'request-scope',
      sourceId: 'operation-scope',
      sourceType: 'agent-operation',
      workspaceId: 'workspace-a',
    });

    await expect(
      ledgerA.reserveCall({
        budgetId: budget.id,
        callKind: 'call_llm',
        expiresAt,
        generationId: 'scope-step',
        idempotencyKey: 'reservation:a:wrong-workspace',
        model: 'model',
        provider: 'provider',
        reservedCredits: 20,
        workspaceId: 'workspace-b',
      }),
    ).rejects.toThrow('Credits 预留归属无效');
    await expect(
      ledgerB.reserveCall({
        budgetId: budget.id,
        callKind: 'call_llm',
        expiresAt,
        generationId: 'scope-step',
        idempotencyKey: 'reservation:b:foreign-budget',
        model: 'model',
        provider: 'provider',
        reservedCredits: 20,
        workspaceId: 'workspace-a',
      }),
    ).rejects.toThrow('Credits 预留归属无效');
  });

  it('rejects stale leases and never releases provider-completed reservations', async () => {
    const admin = new PlatformCreditAdminModel(db, adminId);
    await admin.topUp({
      credits: 100,
      idempotencyKey: 'top-up:a:lease',
      reason: '租约测试',
      targetUserId: userA,
    });
    const ledger = new PlatformCreditModel(db, userA);
    const expiresAt = new Date(Date.now() + 60_000);
    const budget = await ledger.reserveBudget({
      authorizedCredits: 50,
      expiresAt,
      idempotencyKey: 'budget:a:lease',
      requestHash: 'request-lease',
      sourceId: 'operation-lease',
      sourceType: 'agent-operation',
    });
    const reservation = await ledger.reserveCall({
      budgetId: budget.id,
      callKind: 'call_llm',
      expiresAt,
      generationId: 'operation-lease:step:0:call_llm',
      idempotencyKey: 'reservation:a:lease',
      model: 'model',
      provider: 'provider',
      reservedCredits: 50,
    });
    const renewed = await ledger.renewReservationLease({
      expiresAt: new Date(Date.now() + 120_000),
      leaseVersion: reservation.leaseVersion,
      reservationId: reservation.id,
    });

    await expect(
      ledger.recordProviderCompletion({
        costUsd: 0.00001,
        credits: 10,
        leaseVersion: reservation.leaseVersion,
        reservationId: reservation.id,
        tokenUsage: { totalTokens: 10 },
      }),
    ).rejects.toThrow('Credits 预留租约已失效');
    const claimed = await ledger.claimReservationForProvider({
      leaseVersion: renewed.leaseVersion,
      reservationId: reservation.id,
    });
    await ledger.recordProviderCompletion({
      costUsd: 0.00001,
      credits: 10,
      leaseVersion: claimed.reservation.leaseVersion,
      reservationId: reservation.id,
      tokenUsage: { totalTokens: 10 },
    });
    await expect(
      ledger.releaseReservation({
        leaseVersion: claimed.reservation.leaseVersion,
        reservationId: reservation.id,
      }),
    ).rejects.toThrow('Credits 预留状态不允许释放');
    await expect(ledger.releaseBudget(budget.id)).rejects.toThrow('Credits 预留状态不允许释放');
    await expect(ledger.getReservation(reservation.id)).resolves.toMatchObject({
      status: 'provider_completed',
    });
    await expect(ledger.getAvailableCredits()).resolves.toMatchObject({ heldCredits: 50 });
  });

  it('reaps an expired empty budget and releases its entire hold', async () => {
    const expiresAt = new Date(Date.now() + 1_000);
    const { budget, ledger } = await createBudgetFixture('expired-empty', expiresAt, 80);
    const now = vi.spyOn(Date, 'now').mockReturnValue(expiresAt.getTime() + 1);

    try {
      await expect(ledger.reapExpiredBudget(budget.id)).resolves.toMatchObject({
        consumedCredits: 0,
        status: 'expired',
      });
    } finally {
      now.mockRestore();
    }
    await expect(ledger.getAvailableCredits()).resolves.toEqual({
      availableCredits: 100,
      balanceCredits: 100,
      heldCredits: 0,
    });
  });

  it('reaps only an expired reserved call before expiring its budget', async () => {
    const expiresAt = new Date(Date.now() + 1_000);
    const { budget, ledger } = await createBudgetFixture('expired-reserved', expiresAt);
    const reservation = await reserveFixtureCall(
      ledger,
      budget.id,
      'expired-reserved',
      expiresAt,
      100,
    );
    const now = vi.spyOn(Date, 'now').mockReturnValue(expiresAt.getTime() + 1);

    try {
      await expect(ledger.reapExpiredBudget(budget.id)).resolves.toMatchObject({
        status: 'expired',
      });
    } finally {
      now.mockRestore();
    }
    await expect(ledger.getReservation(reservation.id)).resolves.toMatchObject({
      status: 'expired',
    });
    await expect(ledger.getAvailableCredits()).resolves.toMatchObject({ heldCredits: 0 });
  });

  it('keeps a provider-started call held when its provider outcome is unknown', async () => {
    const expiresAt = new Date(Date.now() + 1_000);
    const { budget, ledger } = await createBudgetFixture('provider-started', expiresAt);
    const reservation = await reserveFixtureCall(
      ledger,
      budget.id,
      'provider-started',
      expiresAt,
      100,
    );
    const claim = await ledger.claimReservationForProvider({
      leaseVersion: reservation.leaseVersion,
      reservationId: reservation.id,
    });
    const replay = await ledger.claimReservationForProvider({
      leaseVersion: reservation.leaseVersion,
      reservationId: reservation.id,
    });
    expect(claim).toMatchObject({
      reservation: { status: 'provider_started' },
      shouldCallProvider: true,
    });
    expect(replay).toMatchObject({ shouldCallProvider: false });
    const now = vi.spyOn(Date, 'now').mockReturnValue(expiresAt.getTime() + 1);

    try {
      await expect(ledger.reapExpiredBudget(budget.id)).resolves.toMatchObject({
        status: 'active',
      });
    } finally {
      now.mockRestore();
    }
    await expect(ledger.getReservation(reservation.id)).resolves.toMatchObject({
      status: 'provider_started',
    });
    await expect(ledger.getAvailableCredits()).resolves.toMatchObject({ heldCredits: 100 });
  });

  it('keeps provider-completed usage held until it is settled', async () => {
    const expiresAt = new Date(Date.now() + 1_000);
    const { budget, ledger } = await createBudgetFixture('provider-completed', expiresAt);
    const reservation = await reserveFixtureCall(
      ledger,
      budget.id,
      'provider-completed',
      expiresAt,
      100,
    );
    const claimed = await ledger.claimReservationForProvider({
      leaseVersion: reservation.leaseVersion,
      reservationId: reservation.id,
    });
    await ledger.recordProviderCompletion({
      costUsd: 0.00002,
      credits: 20,
      leaseVersion: claimed.reservation.leaseVersion,
      reservationId: reservation.id,
      tokenUsage: { totalTokens: 20 },
    });
    const now = vi.spyOn(Date, 'now').mockReturnValue(expiresAt.getTime() + 1);

    try {
      await expect(ledger.reapExpiredBudget(budget.id)).resolves.toMatchObject({
        status: 'active',
      });
    } finally {
      now.mockRestore();
    }
    await expect(ledger.getReservation(reservation.id)).resolves.toMatchObject({
      status: 'provider_completed',
    });
    await expect(ledger.getAvailableCredits()).resolves.toMatchObject({ heldCredits: 100 });
  });

  it('retains settled consumption while releasing the expired remainder', async () => {
    const expiresAt = new Date(Date.now() + 1_000);
    const { budget, ledger } = await createBudgetFixture('partial-settlement', expiresAt);
    const settledReservation = await reserveFixtureCall(
      ledger,
      budget.id,
      'partial-settlement-a',
      expiresAt,
      40,
    );
    const expiringReservation = await reserveFixtureCall(
      ledger,
      budget.id,
      'partial-settlement-b',
      expiresAt,
      60,
    );
    const claimed = await ledger.claimReservationForProvider({
      leaseVersion: settledReservation.leaseVersion,
      reservationId: settledReservation.id,
    });
    await ledger.recordProviderCompletion({
      costUsd: 0.00003,
      credits: 30,
      leaseVersion: claimed.reservation.leaseVersion,
      reservationId: settledReservation.id,
      tokenUsage: { totalTokens: 30 },
    });
    await ledger.settleReservedUsage({
      actorUserId: userA,
      costUsd: 0.00003,
      credits: 30,
      generationId: 'operation:partial-settlement-a:step:0:call_llm',
      idempotencyKey: 'platform-usage:v1:partial-settlement',
      leaseVersion: claimed.reservation.leaseVersion,
      model: 'model',
      provider: 'provider',
      reservationId: settledReservation.id,
      tokenUsage: { totalTokens: 30 },
    });
    const now = vi.spyOn(Date, 'now').mockReturnValue(expiresAt.getTime() + 1);

    try {
      await expect(ledger.reapExpiredBudget(budget.id)).resolves.toMatchObject({
        consumedCredits: 30,
        status: 'expired',
      });
    } finally {
      now.mockRestore();
    }
    await expect(ledger.getReservation(expiringReservation.id)).resolves.toMatchObject({
      status: 'expired',
    });
    await expect(ledger.getAvailableCredits()).resolves.toEqual({
      availableCredits: 70,
      balanceCredits: 70,
      heldCredits: 0,
    });
  });

  it('serializes concurrent reapers and makes their terminal result idempotent', async () => {
    const expiresAt = new Date(Date.now() + 1_000);
    const { budget, ledger } = await createBudgetFixture('concurrent-reaper', expiresAt);
    const reservation = await reserveFixtureCall(
      ledger,
      budget.id,
      'concurrent-reaper',
      expiresAt,
      100,
    );
    const now = vi.spyOn(Date, 'now').mockReturnValue(expiresAt.getTime() + 1);

    try {
      const results = await Promise.all([
        ledger.reapExpiredBudget(budget.id),
        ledger.reapExpiredBudget(budget.id),
      ]);
      expect(results).toEqual([
        expect.objectContaining({ status: 'expired' }),
        expect.objectContaining({ status: 'expired' }),
      ]);
    } finally {
      now.mockRestore();
    }
    await expect(ledger.getReservation(reservation.id)).resolves.toMatchObject({
      status: 'expired',
    });
    await expect(ledger.getAvailableCredits()).resolves.toMatchObject({ heldCredits: 0 });
  });

  it('does not reap a reservation renewed under a newer lease', async () => {
    const expiresAt = new Date(Date.now() + 1_000);
    const renewedExpiresAt = new Date(expiresAt.getTime() + 60_000);
    const { budget, ledger } = await createBudgetFixture('renewed-before-reaper', expiresAt);
    const reservation = await reserveFixtureCall(
      ledger,
      budget.id,
      'renewed-before-reaper',
      expiresAt,
      100,
    );
    const renewed = await ledger.renewReservationLease({
      expiresAt: renewedExpiresAt,
      leaseVersion: reservation.leaseVersion,
      reservationId: reservation.id,
    });
    const now = vi.spyOn(Date, 'now').mockReturnValue(expiresAt.getTime() + 1);

    try {
      await expect(ledger.reapExpiredBudget(budget.id)).resolves.toMatchObject({
        status: 'active',
      });
    } finally {
      now.mockRestore();
    }
    await expect(ledger.getReservation(reservation.id)).resolves.toMatchObject({
      expiresAt: renewedExpiresAt,
      leaseVersion: renewed.leaseVersion,
      status: 'reserved',
    });
    await expect(
      ledger.releaseReservation({
        leaseVersion: reservation.leaseVersion,
        reservationId: reservation.id,
      }),
    ).rejects.toThrow('Credits 预留租约已失效');
  });

  it('prevents legacy charges and negative adjustments from consuming active budget holds', async () => {
    const admin = new PlatformCreditAdminModel(db, adminId);
    await admin.topUp({
      credits: 100,
      idempotencyKey: 'top-up:a:legacy-hold',
      reason: '兼容门禁测试',
      targetUserId: userA,
    });
    const ledger = new PlatformCreditModel(db, userA);
    await ledger.reserveBudget({
      authorizedCredits: 80,
      expiresAt: new Date(Date.now() + 60_000),
      idempotencyKey: 'budget:a:legacy-hold',
      requestHash: 'request-legacy-hold',
      sourceId: 'operation-legacy-hold',
      sourceType: 'agent-operation',
    });

    await expect(
      ledger.chargeUsage({
        actorUserId: userA,
        costUsd: 0.00003,
        credits: 30,
        generationId: 'legacy-generation',
        idempotencyKey: 'platform-usage:v1:legacy-hold',
        model: 'model',
        provider: 'provider',
        tokenUsage: { totalTokens: 30 },
      }),
    ).rejects.toThrow(PLATFORM_CREDIT_INSUFFICIENT_BALANCE);
    await expect(
      admin.adjust({
        credits: -30,
        idempotencyKey: 'adjust:a:legacy-hold',
        reason: '不得侵占预留',
        targetUserId: userA,
      }),
    ).rejects.toThrow(PLATFORM_CREDIT_INSUFFICIENT_BALANCE);
    await expect(ledger.getAccount()).resolves.toMatchObject({ balanceCredits: 100 });
  });

  it('defines database checks for entry types, signed amounts, and usage metadata', () => {
    const checkNames = getTableConfig(platformCreditEntries).checks.map(({ name }) => name);

    expect(checkNames).toEqual(
      expect.arrayContaining([
        'platform_credit_entries_amount_matches_type',
        'platform_credit_entries_type_valid',
        'platform_credit_entries_usage_metadata_complete',
      ]),
    );
  });

  it('creates one zero-credit account per user and keeps customer data isolated', async () => {
    const modelA = new PlatformCreditModel(db, userA);
    const modelB = new PlatformCreditModel(db, userB);

    await expect(modelA.getAccount()).resolves.toMatchObject({
      balanceCredits: 0,
      userId: userA,
      userIdSnapshot: userA,
    });
    await expect(modelA.getAccount()).resolves.toMatchObject({ balanceCredits: 0 });
    await expect(modelB.getAccount()).resolves.toMatchObject({ balanceCredits: 0 });

    await expect(modelA.listEntries()).resolves.toEqual([]);
    await expect(modelB.listEntries()).resolves.toEqual([]);
  });

  it('atomically charges authoritative usage and stores only billing metadata', async () => {
    const admin = new PlatformCreditAdminModel(db, adminId);
    await admin.topUp({
      credits: 2_000_000,
      idempotencyKey: 'top-up:a:1',
      reason: '充值到账',
      targetUserId: userA,
    });

    const ledger = new PlatformCreditModel(db, userA);
    const charge = await ledger.chargeUsage({
      actorUserId: userA,
      costUsd: 1.25,
      credits: 1_250_000,
      generationId: 'generation-a-1',
      generationType: 'image',
      idempotencyKey: 'platform-usage:v1:generation-a-1',
      model: 'gpt-image-1',
      provider: 'openai',
      tokenUsage: {
        inputImageTokens: 300,
        inputTextTokens: 100,
        outputImageTokens: 850,
        totalInputTokens: 400,
        totalOutputTokens: 850,
        totalTokens: 1250,
      },
      workspaceId: 'workspace-a',
    });

    expect(charge).toMatchObject({
      actorUserId: userA,
      actorUserIdSnapshot: userA,
      amountCredits: -1_250_000,
      balanceAfterCredits: 750_000,
      costUsd: 1.25,
      generationId: 'generation-a-1',
      generationType: 'image',
      model: 'gpt-image-1',
      provider: 'openai',
      type: 'usage_charge',
      userId: userA,
      workspaceId: 'workspace-a',
    });
    expect(charge.tokenUsage).toEqual({
      inputImageTokens: 300,
      inputTextTokens: 100,
      outputImageTokens: 850,
      totalInputTokens: 400,
      totalOutputTokens: 850,
      totalTokens: 1250,
    });
    await expect(ledger.getAccount()).resolves.toMatchObject({ balanceCredits: 750_000 });
    await expect(new PlatformCreditModel(db, userB).listEntries()).resolves.toEqual([]);
  });

  it('rejects a runtime cost and Credits mismatch before touching the balance', async () => {
    const ledger = new PlatformCreditModel(db, userA);

    await expect(
      ledger.chargeUsage({
        actorUserId: userA,
        costUsd: 0.0006,
        credits: 599,
        generationId: 'generation-cost-mismatch',
        idempotencyKey: 'platform-usage:v1:cost-mismatch',
        model: 'deepseek-chat',
        provider: 'deepseek',
        tokenUsage: { totalTokens: 150 },
      }),
    ).rejects.toThrow(PLATFORM_CREDIT_INVALID_USAGE);

    await expect(ledger.getAccount()).resolves.toMatchObject({ balanceCredits: 0 });
    await expect(ledger.listEntries()).resolves.toEqual([]);
  });

  it('normalizes costUsd to numeric(30,15) before validation, storage, and retry comparison', async () => {
    const rawCost = Number('0.12345678901234549');
    const normalizedCost = Number(rawCost.toFixed(15));
    const credits = Math.ceil(normalizedCost * CREDITS_PER_DOLLAR);
    const admin = new PlatformCreditAdminModel(db, adminId);
    await admin.topUp({
      credits: credits + 1,
      idempotencyKey: 'top-up:a:cost-precision',
      reason: '精度测试',
      targetUserId: userA,
    });
    const ledger = new PlatformCreditModel(db, userA);
    const input = {
      actorUserId: userA,
      costUsd: rawCost,
      credits,
      generationId: 'generation-cost-precision',
      idempotencyKey: 'platform-usage:v1:cost-precision',
      model: 'precision-model',
      provider: 'provider',
      tokenUsage: { totalTokens: 1 },
    };

    const first = await ledger.chargeUsage(input);
    const rawReplay = await ledger.chargeUsage(input);
    const replay = await ledger.chargeUsage({ ...input, costUsd: normalizedCost });

    expect(first.costUsd).toBe(normalizedCost);
    expect(rawReplay.id).toBe(first.id);
    expect(replay.id).toBe(first.id);
  });

  it('returns the same usage charge for an exact retry and rejects key reuse', async () => {
    const admin = new PlatformCreditAdminModel(db, adminId);
    await admin.topUp({
      credits: 1_000,
      idempotencyKey: 'top-up:a:retry',
      reason: '测试充值',
      targetUserId: userA,
    });
    const ledger = new PlatformCreditModel(db, userA);
    const input = {
      actorUserId: userA,
      costUsd: 0.0006,
      credits: 600,
      generationId: 'generation-retry',
      idempotencyKey: 'platform-usage:v1:retry',
      model: 'deepseek-chat',
      provider: 'deepseek',
      tokenUsage: { totalInputTokens: 100, totalOutputTokens: 50, totalTokens: 150 },
    };

    const first = await ledger.chargeUsage(input);
    const replay = await ledger.chargeUsage(input);

    expect(replay.id).toBe(first.id);
    await expect(ledger.getAccount()).resolves.toMatchObject({ balanceCredits: 400 });
    await expect(ledger.chargeUsage({ ...input, model: 'another-model' })).rejects.toThrow(
      PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT,
    );
  });

  it('fails closed without writing when the balance is insufficient', async () => {
    const ledger = new PlatformCreditModel(db, userA);

    await expect(
      ledger.chargeUsage({
        actorUserId: userA,
        costUsd: 0.000001,
        credits: 1,
        generationId: 'generation-no-balance',
        idempotencyKey: 'platform-usage:v1:no-balance',
        model: 'deepseek-chat',
        provider: 'deepseek',
        tokenUsage: { totalTokens: 1 },
      }),
    ).rejects.toThrow(PLATFORM_CREDIT_INSUFFICIENT_BALANCE);

    await expect(ledger.getAccount()).resolves.toMatchObject({ balanceCredits: 0 });
    await expect(ledger.listEntries()).resolves.toEqual([]);
  });

  it('serializes concurrent debits so the account can never become negative', async () => {
    const admin = new PlatformCreditAdminModel(db, adminId);
    await admin.topUp({
      credits: 100,
      idempotencyKey: 'top-up:a:concurrent',
      reason: '并发测试',
      targetUserId: userA,
    });
    const ledger = new PlatformCreditModel(db, userA);

    const attempts = await Promise.allSettled([
      ledger.chargeUsage({
        actorUserId: userA,
        costUsd: 0.00008,
        credits: 80,
        generationId: 'generation-concurrent-a',
        idempotencyKey: 'platform-usage:v1:concurrent-a',
        model: 'model-a',
        provider: 'provider-a',
        tokenUsage: { totalTokens: 80 },
      }),
      ledger.chargeUsage({
        actorUserId: userA,
        costUsd: 0.00008,
        credits: 80,
        generationId: 'generation-concurrent-b',
        idempotencyKey: 'platform-usage:v1:concurrent-b',
        model: 'model-a',
        provider: 'provider-a',
        tokenUsage: { totalTokens: 80 },
      }),
    ]);

    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    await expect(ledger.getAccount()).resolves.toMatchObject({ balanceCredits: 20 });
  });

  it('accepts a zero-credit runtime usage record without inventing a minimum price', async () => {
    const ledger = new PlatformCreditModel(db, userA);
    const entry = await ledger.chargeUsage({
      actorUserId: userA,
      costUsd: 0,
      credits: 0,
      generationId: 'generation-free',
      idempotencyKey: 'platform-usage:v1:free',
      model: 'free-model',
      provider: 'provider',
      tokenUsage: { totalTokens: 10 },
    });

    expect(entry).toMatchObject({ amountCredits: 0, balanceAfterCredits: 0 });
  });

  it('rejects malformed credits, costs, actor identity, and token payloads', async () => {
    const ledger = new PlatformCreditModel(db, userA);
    const valid = {
      actorUserId: userA,
      costUsd: 0,
      credits: 0,
      generationId: 'generation-invalid',
      idempotencyKey: 'platform-usage:v1:invalid',
      model: 'model',
      provider: 'provider',
      tokenUsage: { totalTokens: 1 },
    };

    await expect(ledger.chargeUsage({ ...valid, credits: 1.5 })).rejects.toThrow(
      PLATFORM_CREDIT_INVALID_AMOUNT,
    );
    await expect(ledger.chargeUsage({ ...valid, credits: -1 })).rejects.toThrow(
      PLATFORM_CREDIT_INVALID_AMOUNT,
    );
    await expect(ledger.chargeUsage({ ...valid, costUsd: Number.NaN })).rejects.toThrow(
      PLATFORM_CREDIT_INVALID_USAGE,
    );
    await expect(ledger.chargeUsage({ ...valid, actorUserId: userB })).rejects.toThrow(
      PLATFORM_CREDIT_INVALID_USAGE,
    );
    await expect(
      ledger.chargeUsage({
        ...valid,
        tokenUsage: { apiKey: 'must-not-be-stored', totalTokens: 1 } as never,
      }),
    ).rejects.toThrow(PLATFORM_CREDIT_INVALID_USAGE);
  });

  it('normalizes non-finite and out-of-range list limits safely', async () => {
    const admin = new PlatformCreditAdminModel(db, adminId);
    for (const [index, credits] of [10, 20, 30].entries()) {
      await admin.topUp({
        credits,
        idempotencyKey: `top-up:a:limit-${index}`,
        reason: '分页参数测试',
        targetUserId: userA,
      });
    }
    const ledger = new PlatformCreditModel(db, userA);

    await expect(ledger.listEntries(Number.NaN)).resolves.toHaveLength(3);
    await expect(ledger.listEntries(Number.POSITIVE_INFINITY)).resolves.toHaveLength(3);
    await expect(ledger.listEntries(-10)).resolves.toHaveLength(1);
    await expect(admin.listEntriesForUser(userA, Number.NEGATIVE_INFINITY)).resolves.toHaveLength(
      3,
    );
    await expect(admin.listEntriesForUser(userA, 999_999)).resolves.toHaveLength(3);
  });
});

describe('PlatformCreditAdminModel', () => {
  it('posts idempotent top-ups and signed adjustments in integer credits', async () => {
    const admin = new PlatformCreditAdminModel(db, adminId);
    const topUpInput = {
      credits: 1_000_000,
      idempotencyKey: 'top-up:a:admin',
      reason: '充值到账',
      targetUserId: userA,
    };

    const first = await admin.topUp(topUpInput);
    const replay = await admin.topUp(topUpInput);
    const adjustment = await admin.adjust({
      credits: -250_000,
      idempotencyKey: 'adjust:a:admin',
      reason: '人工校准',
      targetUserId: userA,
    });

    expect(replay.id).toBe(first.id);
    expect(first).toMatchObject({
      amountCredits: 1_000_000,
      operatorUserId: adminId,
      type: 'top_up',
    });
    expect(adjustment).toMatchObject({
      amountCredits: -250_000,
      balanceAfterCredits: 750_000,
      type: 'adjustment',
    });
    await expect(admin.topUp({ ...topUpInput, credits: -1 })).rejects.toThrow(
      PLATFORM_CREDIT_INVALID_AMOUNT,
    );
  });

  it('reverses an entry once and restores its exact credit effect', async () => {
    const admin = new PlatformCreditAdminModel(db, adminId);
    await admin.topUp({
      credits: 1000,
      idempotencyKey: 'top-up:a:reverse',
      reason: '充值',
      targetUserId: userA,
    });
    const charge = await new PlatformCreditModel(db, userA).chargeUsage({
      actorUserId: userA,
      costUsd: 0.0004,
      credits: 400,
      generationId: 'generation-reverse',
      idempotencyKey: 'platform-usage:v1:reverse',
      model: 'model',
      provider: 'provider',
      tokenUsage: { totalTokens: 400 },
    });
    const input = {
      entryId: charge.id,
      idempotencyKey: 'reversal:a:usage',
      reason: '供应商确认失败，退回用量',
    };

    const reversal = await admin.reverse(input);
    const replay = await admin.reverse(input);

    expect(replay.id).toBe(reversal.id);
    expect(reversal).toMatchObject({
      amountCredits: 400,
      balanceAfterCredits: 1000,
      reversalOfEntryId: charge.id,
      type: 'reversal',
    });
    await expect(
      admin.reverse({ ...input, idempotencyKey: 'reversal:a:usage:other' }),
    ).rejects.toThrow(PLATFORM_CREDIT_REVERSAL_ALREADY_EXISTS);
  });

  it('fails closed when reversing a credit would make the balance negative', async () => {
    const admin = new PlatformCreditAdminModel(db, adminId);
    const topUp = await admin.topUp({
      credits: 100,
      idempotencyKey: 'top-up:a:spent',
      reason: '充值',
      targetUserId: userA,
    });
    await new PlatformCreditModel(db, userA).chargeUsage({
      actorUserId: userA,
      costUsd: 0.00008,
      credits: 80,
      generationId: 'generation-spent',
      idempotencyKey: 'platform-usage:v1:spent',
      model: 'model',
      provider: 'provider',
      tokenUsage: { totalTokens: 80 },
    });

    await expect(
      admin.reverse({
        entryId: topUp.id,
        idempotencyKey: 'reversal:a:spent-top-up',
        reason: '撤销充值',
      }),
    ).rejects.toThrow(PLATFORM_CREDIT_INSUFFICIENT_BALANCE);

    await expect(new PlatformCreditModel(db, userA).getAccount()).resolves.toMatchObject({
      balanceCredits: 20,
    });
  });
});
