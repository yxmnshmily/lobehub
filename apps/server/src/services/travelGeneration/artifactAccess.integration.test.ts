// @vitest-environment node
import {
  platformCreditAccounts,
  platformCreditBudgets,
  platformCreditEntries,
  platformCreditReservations,
  users,
} from '@lobechat/database/schemas';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { PlatformUsageReservationService } from '@/server/services/platformUsageBilling/reservation';

import { hasSettledTravelImageUsage } from './artifactAccess';
import { buildPlatformImageSettlementIdentity } from './platformImageSettlementIdentity';

const db = await getTestDB();
const accountId = '10000000-0000-4000-8000-000000000001';
const userA = 'travel-artifact-access-a';
const userB = 'travel-artifact-access-b';

const cleanup = async () => {
  await db
    .delete(platformCreditReservations)
    .where(eq(platformCreditReservations.accountId, accountId));
  await db.delete(platformCreditBudgets).where(eq(platformCreditBudgets.userIdSnapshot, userA));
  await db.delete(platformCreditEntries).where(eq(platformCreditEntries.accountId, accountId));
  await db.delete(platformCreditAccounts).where(eq(platformCreditAccounts.id, accountId));
  await db.delete(users).where(eq(users.id, userA));
  await db.delete(users).where(eq(users.id, userB));
};

beforeEach(async () => {
  await cleanup();
  await db.insert(users).values([{ id: userA }, { id: userB }]);
  await db.insert(platformCreditAccounts).values({
    balanceCredits: 4_998_750,
    id: accountId,
    userId: userA,
    userIdSnapshot: userA,
  });
  await db.insert(platformCreditEntries).values({
    accountId,
    actorUserId: userA,
    actorUserIdSnapshot: userA,
    amountCredits: -1250,
    balanceAfterCredits: 4_998_750,
    costUsd: 0.00125,
    generationId: 'generation-image-access-1',
    generationType: 'platform-image-generation',
    idempotencyKey: 'travel-image-artifact-access-settlement',
    model: 'priced-image-model',
    provider: 'priced-provider',
    reason: '旅游图片真实用量结算',
    tokenUsage: { inputTextTokens: 80, outputImageTokens: 920, totalTokens: 1000 },
    type: 'usage_charge',
    userId: userA,
    userIdSnapshot: userA,
    workspaceId: 'workspace-a',
  });
});

afterEach(cleanup);

describe('travel generation artifact settlement access', () => {
  it('shares one real reservation, worker settlement, and verifier identity', async () => {
    const generationId = 'generation-image-access-real-chain';
    const limit = { maxCredits: 1000, source: 'user-explicit' as const };
    const expiresAt = new Date(Date.now() + 60_000);
    const reservations = new PlatformUsageReservationService(db, userA);
    const request = await reservations.reserveRequest({
      expiresAt,
      idempotencyKey: 'travel-image-real-chain-request',
      limit,
      sourceId: 'travel-image-real-chain-operation',
      sourceType: 'agent-operation',
      workspaceId: 'workspace-a',
    });
    const reservation = await reservations.reserveCall({
      budgetId: request.id,
      callKind: 'image',
      expiresAt,
      ...buildPlatformImageSettlementIdentity(generationId),
      idempotencyKey: 'travel-image-real-chain-call',
      limit,
      model: 'priced-image-model',
      provider: 'priced-provider',
      workspaceId: 'workspace-a',
    });
    const claim = await reservations.claim({
      leaseVersion: reservation.leaseVersion,
      reservationId: reservation.id,
    });
    await reservations.completeAndSettle({
      completeRequest: true,
      leaseVersion: claim.reservation.leaseVersion,
      providerRequestId: 'provider-request-real-chain',
      reservationId: reservation.id,
      usage: { cost: 0.0006, outputImageTokens: 1, totalTokens: 1 },
    });

    await expect(
      hasSettledTravelImageUsage({
        asyncTaskId: 'async-image-access-real-chain',
        db,
        generationId,
        userId: userA,
        workspaceId: 'workspace-a',
      }),
    ).resolves.toBe(true);
  });

  it('matches durable image settlement only for the exact user, workspace and generation identity', async () => {
    await expect(
      hasSettledTravelImageUsage({
        asyncTaskId: 'async-image-access-1',
        db,
        generationId: 'generation-image-access-1',
        userId: userA,
        workspaceId: 'workspace-a',
      }),
    ).resolves.toBe(true);
    await expect(
      hasSettledTravelImageUsage({
        asyncTaskId: 'async-image-access-1',
        db,
        generationId: 'generation-image-access-1',
        userId: userB,
        workspaceId: 'workspace-a',
      }),
    ).resolves.toBe(false);
    await expect(
      hasSettledTravelImageUsage({
        asyncTaskId: 'async-image-access-1',
        db,
        generationId: 'generation-image-access-1',
        userId: userA,
        workspaceId: 'workspace-b',
      }),
    ).resolves.toBe(false);
    await expect(
      hasSettledTravelImageUsage({
        asyncTaskId: 'async-image-access-1',
        db,
        generationId: 'generation-image-access-2',
        userId: userA,
        workspaceId: 'workspace-a',
      }),
    ).resolves.toBe(false);
  });
});
