// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import {
  platformCreditAccounts,
  platformCreditBudgets,
  platformCreditEntries,
  platformCreditReservations,
  users,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SponsoredPlatformUsageSettlement,
  type SponsoredPlatformUsageSettlementError,
} from './sponsoredSettlement';

const payerUserId = 'sponsored-settlement-payer';
const actorUserId = 'sponsored-settlement-actor';
const outsiderUserId = 'sponsored-settlement-outsider';

const db: LobeChatDatabase = await getTestDB();
const fixtureUserIds = [payerUserId, actorUserId, outsiderUserId];

const createClaimedSponsoredReservation = async (input?: {
  actor?: string;
  authorizationKind?: 'group_member_sponsored' | 'self';
  reservationAccountId?: string;
  status?: 'provider_completed' | 'provider_started' | 'reserved';
}) => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60_000);
  const actor = input?.actor ?? actorUserId;
  const authorizationKind = input?.authorizationKind ?? 'group_member_sponsored';
  const [payerAccount] = await db
    .insert(platformCreditAccounts)
    .values({ balanceCredits: 1000, userId: payerUserId, userIdSnapshot: payerUserId })
    .returning();
  const [actorAccount] = await db
    .insert(platformCreditAccounts)
    .values({ balanceCredits: 5000, userId: actor, userIdSnapshot: actor })
    .returning();
  const sponsored = authorizationKind === 'group_member_sponsored';
  const [budget] = await db
    .insert(platformCreditBudgets)
    .values({
      accountId: payerAccount.id,
      actorUserId: sponsored ? actor : payerUserId,
      actorUserIdSnapshot: sponsored ? actor : payerUserId,
      authorizationKind,
      authorizedCredits: 500,
      consumedCredits: 0,
      expiresAt,
      idempotencyKey: `budget:${authorizationKind}:${actor}`,
      requestHash: 'request-hash',
      sourceId: `source:${authorizationKind}:${actor}`,
      sourceType: 'group-chat',
      sponsorChatGroupIdSnapshot: sponsored ? 'original-travel-group' : null,
      sponsorGroupPeriodLimitCreditsSnapshot: sponsored ? 10_000 : null,
      sponsorMemberPeriodLimitCreditsSnapshot: sponsored ? 3000 : null,
      sponsorMemberRequestLimitCreditsSnapshot: sponsored ? 500 : null,
      sponsorMembershipVersionSnapshot: sponsored ? 2 : null,
      sponsorPeriodEndsAtSnapshot: sponsored ? expiresAt : null,
      sponsorPeriodStartedAtSnapshot: sponsored ? now : null,
      sponsorPolicyVersionSnapshot: sponsored ? 1 : null,
      status: 'active',
      userId: payerUserId,
      userIdSnapshot: payerUserId,
      workspaceId: null,
    })
    .returning();
  const [reservation] = await db
    .insert(platformCreditReservations)
    .values({
      accountId: input?.reservationAccountId ?? payerAccount.id,
      budgetId: budget.id,
      callKind: 'call_llm',
      expiresAt,
      generationId: 'group-message:step:0:call_llm',
      generationType: 'agent-runtime-text-step',
      idempotencyKey: `reservation:${authorizationKind}:${actor}`,
      model: 'deepseek-chat',
      provider: 'deepseek',
      actualUsage:
        input?.status === 'provider_completed' ? { cost: 0.0001, totalTokens: 100 } : null,
      reservedCredits: 500,
      settledCredits: 0,
      status: input?.status ?? 'provider_started',
      workspaceId: null,
    })
    .returning();
  return { actorAccount, budget, payerAccount, reservation };
};

beforeEach(async () => {
  await db
    .delete(platformCreditAccounts)
    .where(inArray(platformCreditAccounts.userIdSnapshot, fixtureUserIds));
  await db.delete(users).where(inArray(users.id, fixtureUserIds));
  await db.insert(users).values([
    { email: 'payer@sponsored-settlement.test', id: payerUserId },
    { email: 'actor@sponsored-settlement.test', id: actorUserId },
    { email: 'outsider@sponsored-settlement.test', id: outsiderUserId },
  ]);
});

afterEach(async () => {
  await db
    .delete(platformCreditAccounts)
    .where(inArray(platformCreditAccounts.userIdSnapshot, fixtureUserIds));
  await db.delete(users).where(inArray(users.id, fixtureUserIds));
});

describe('SponsoredPlatformUsageSettlement', () => {
  it('charges the original payer for the claimed actor snapshot without touching actor balance', async () => {
    const fixture = await createClaimedSponsoredReservation();
    const settlement = new SponsoredPlatformUsageSettlement(db, actorUserId);

    const result = await settlement.settleClaimedReservation({
      leaseVersion: fixture.reservation.leaseVersion,
      providerRequestId: 'provider-request-1',
      reservationId: fixture.reservation.id,
      usage: { cost: 0.0001, totalInputTokens: 60, totalOutputTokens: 40, totalTokens: 100 },
    });

    expect(result.entry).toMatchObject({
      actorUserIdSnapshot: actorUserId,
      amountCredits: -100,
      userIdSnapshot: payerUserId,
    });
    const [payerAccount] = await db
      .select()
      .from(platformCreditAccounts)
      .where(eq(platformCreditAccounts.id, fixture.payerAccount.id));
    const [actorAccount] = await db
      .select()
      .from(platformCreditAccounts)
      .where(eq(platformCreditAccounts.id, fixture.actorAccount.id));
    expect(payerAccount.balanceCredits).toBe(900);
    expect(actorAccount.balanceCredits).toBe(5000);
    expect(result.reservation).toMatchObject({
      providerRequestId: 'provider-request-1',
      settledCredits: 100,
      status: 'settled',
    });
  });

  it('settles from immutable snapshots even when no live membership or group remains', async () => {
    const fixture = await createClaimedSponsoredReservation();

    await expect(
      new SponsoredPlatformUsageSettlement(db, actorUserId).settleClaimedReservation({
        leaseVersion: fixture.reservation.leaseVersion,
        reservationId: fixture.reservation.id,
        usage: { cost: 0.00005, totalTokens: 50 },
      }),
    ).resolves.toMatchObject({
      entry: { actorUserIdSnapshot: actorUserId, userIdSnapshot: payerUserId },
    });
  });

  it.each(['reserved', 'provider_completed'] as const)(
    'fails closed when the reservation is %s instead of provider_started',
    async (status) => {
      const fixture = await createClaimedSponsoredReservation({ status });

      await expect(
        new SponsoredPlatformUsageSettlement(db, actorUserId).settleClaimedReservation({
          leaseVersion: fixture.reservation.leaseVersion,
          reservationId: fixture.reservation.id,
          usage: { cost: 0.0001, totalTokens: 100 },
        }),
      ).rejects.toMatchObject<SponsoredPlatformUsageSettlementError>({
        code: 'INVALID_STATE',
      });
      await expect(db.select().from(platformCreditEntries)).resolves.toHaveLength(0);
    },
  );

  it('rejects another actor and leaves the payer hold untouched', async () => {
    const fixture = await createClaimedSponsoredReservation();

    await expect(
      new SponsoredPlatformUsageSettlement(db, outsiderUserId).settleClaimedReservation({
        leaseVersion: fixture.reservation.leaseVersion,
        reservationId: fixture.reservation.id,
        usage: { cost: 0.0001, totalTokens: 100 },
      }),
    ).rejects.toMatchObject<SponsoredPlatformUsageSettlementError>({ code: 'INVALID_CONTEXT' });
    const [payerAccount] = await db
      .select()
      .from(platformCreditAccounts)
      .where(eq(platformCreditAccounts.id, fixture.payerAccount.id));
    expect(payerAccount.balanceCredits).toBe(1000);
  });

  it('rejects a forged reservation whose account does not match its sponsored budget', async () => {
    const outsiderAccount = await db
      .insert(platformCreditAccounts)
      .values({ balanceCredits: 9999, userId: outsiderUserId, userIdSnapshot: outsiderUserId })
      .returning();
    const fixture = await createClaimedSponsoredReservation({
      reservationAccountId: outsiderAccount[0].id,
    });

    await expect(
      new SponsoredPlatformUsageSettlement(db, actorUserId).settleClaimedReservation({
        leaseVersion: fixture.reservation.leaseVersion,
        reservationId: fixture.reservation.id,
        usage: { cost: 0.0001, totalTokens: 100 },
      }),
    ).rejects.toMatchObject<SponsoredPlatformUsageSettlementError>({ code: 'INVALID_CONTEXT' });
  });

  it('rejects self-funded budgets from the sponsored settlement path', async () => {
    const fixture = await createClaimedSponsoredReservation({ authorizationKind: 'self' });

    await expect(
      new SponsoredPlatformUsageSettlement(db, payerUserId).settleClaimedReservation({
        leaseVersion: fixture.reservation.leaseVersion,
        reservationId: fixture.reservation.id,
        usage: { cost: 0.0001, totalTokens: 100 },
      }),
    ).rejects.toMatchObject<SponsoredPlatformUsageSettlementError>({ code: 'INVALID_CONTEXT' });
  });

  it('replays an exact settlement but rejects changed authoritative usage', async () => {
    const fixture = await createClaimedSponsoredReservation();
    const settlement = new SponsoredPlatformUsageSettlement(db, actorUserId);
    const input = {
      leaseVersion: fixture.reservation.leaseVersion,
      providerRequestId: 'provider-request-1',
      reservationId: fixture.reservation.id,
      usage: { cost: 0.0001, totalTokens: 100 },
    };

    const first = await settlement.settleClaimedReservation(input);
    await expect(settlement.settleClaimedReservation(input)).resolves.toMatchObject({
      entry: { id: first.entry.id },
    });
    await expect(
      settlement.settleClaimedReservation({
        ...input,
        usage: { cost: 0.0002, totalTokens: 200 },
      }),
    ).rejects.toMatchObject<SponsoredPlatformUsageSettlementError>({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await expect(db.select().from(platformCreditEntries)).resolves.toHaveLength(1);
  });
});
