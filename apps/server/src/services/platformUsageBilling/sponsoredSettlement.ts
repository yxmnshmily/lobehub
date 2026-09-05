import type { LobeChatDatabase } from '@lobechat/database';
import {
  platformCreditAccounts,
  platformCreditBudgets,
  platformCreditEntries,
  type PlatformCreditEntryItem,
  type PlatformCreditReservationItem,
  platformCreditReservations,
} from '@lobechat/database/schemas';
import { and, eq, sql } from 'drizzle-orm';

import type { ModelUsage } from '@/types/message';

import { type PlatformUsageTokenDetails, preparePlatformUsageCharge } from './index';

export type SponsoredPlatformUsageSettlementErrorCode =
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_ACTOR'
  | 'INVALID_CONTEXT'
  | 'INVALID_STATE'
  | 'SETTLEMENT_FAILED';

export class SponsoredPlatformUsageSettlementError extends Error {
  readonly code: SponsoredPlatformUsageSettlementErrorCode;

  constructor(code: SponsoredPlatformUsageSettlementErrorCode, message: string) {
    super(message);
    this.name = 'SponsoredPlatformUsageSettlementError';
    this.code = code;
  }
}

export interface SettleClaimedSponsoredReservationInput {
  leaseVersion: number;
  providerRequestId?: string | null;
  reservationId: string;
  usage?: ModelUsage;
}

export interface SettleClaimedSponsoredReservationResult {
  entry: PlatformCreditEntryItem;
  reservation: PlatformCreditReservationItem;
}

const tokenFields = [
  'acceptedPredictionTokens',
  'inputAudioTokens',
  'inputCachedAudioTokens',
  'inputCachedImageTokens',
  'inputCachedTextTokens',
  'inputCachedTokens',
  'inputCachedVideoTokens',
  'inputCacheMissTokens',
  'inputCitationTokens',
  'inputImageTokens',
  'inputTextTokens',
  'inputToolTokens',
  'inputVideoTokens',
  'inputWriteCacheTokens',
  'outputAudioTokens',
  'outputImageTokens',
  'outputReasoningTokens',
  'outputTextTokens',
  'rejectedPredictionTokens',
  'totalInputTokens',
  'totalOutputTokens',
  'totalTokens',
] as const satisfies readonly (keyof PlatformUsageTokenDetails)[];

const requireText = (value: string, code: SponsoredPlatformUsageSettlementErrorCode) => {
  const normalized = value.trim();
  if (!normalized) {
    throw new SponsoredPlatformUsageSettlementError(
      code,
      'Sponsored settlement context is invalid.',
    );
  }
  return normalized;
};

const requireLeaseVersion = (value: number) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new SponsoredPlatformUsageSettlementError(
      'INVALID_STATE',
      'Sponsored settlement reservation state is invalid.',
    );
  }
  return value;
};

const normalizeProviderRequestId = (value?: string | null) => {
  if (value === undefined || value === null) return null;
  return requireText(value, 'INVALID_CONTEXT');
};

const sameTokenUsage = (
  stored: Record<string, number> | null,
  expected: PlatformUsageTokenDetails,
) => {
  const current = stored ?? {};
  const currentTokenKeys = Object.keys(current).filter((key) => key !== 'cost');
  return (
    currentTokenKeys.length === Object.keys(expected).length &&
    tokenFields.every((field) => current[field] === expected[field])
  );
};

const validSponsoredSnapshot = (budget: typeof platformCreditBudgets.$inferSelect) =>
  budget.authorizationKind === 'group_member_sponsored' &&
  Boolean(budget.sponsorChatGroupIdSnapshot?.trim()) &&
  budget.actorUserId === budget.actorUserIdSnapshot &&
  budget.actorUserIdSnapshot !== budget.userIdSnapshot &&
  budget.workspaceId === null &&
  Number.isSafeInteger(budget.sponsorPolicyVersionSnapshot) &&
  (budget.sponsorPolicyVersionSnapshot ?? 0) > 0 &&
  Number.isSafeInteger(budget.sponsorMembershipVersionSnapshot) &&
  (budget.sponsorMembershipVersionSnapshot ?? 0) > 0 &&
  budget.sponsorPeriodStartedAtSnapshot instanceof Date &&
  budget.sponsorPeriodEndsAtSnapshot instanceof Date &&
  budget.sponsorPeriodEndsAtSnapshot.getTime() > budget.sponsorPeriodStartedAtSnapshot.getTime() &&
  Number.isSafeInteger(budget.sponsorGroupPeriodLimitCreditsSnapshot) &&
  (budget.sponsorGroupPeriodLimitCreditsSnapshot ?? 0) > 0 &&
  Number.isSafeInteger(budget.sponsorMemberPeriodLimitCreditsSnapshot) &&
  (budget.sponsorMemberPeriodLimitCreditsSnapshot ?? 0) > 0 &&
  Number.isSafeInteger(budget.sponsorMemberRequestLimitCreditsSnapshot) &&
  (budget.sponsorMemberRequestLimitCreditsSnapshot ?? 0) > 0 &&
  budget.authorizedCredits <= (budget.sponsorGroupPeriodLimitCreditsSnapshot ?? 0) &&
  budget.authorizedCredits <= (budget.sponsorMemberPeriodLimitCreditsSnapshot ?? 0) &&
  budget.authorizedCredits <= (budget.sponsorMemberRequestLimitCreditsSnapshot ?? 0);

/**
 * Settles only a provider-started sponsored reservation against its immutable payer/actor snapshot.
 * Live membership is deliberately not consulted after provider admission: revocation can stop the
 * next call, but cannot move an already incurred provider cost onto the member or the platform.
 */
export class SponsoredPlatformUsageSettlement {
  private readonly actorUserId: string;

  constructor(
    private readonly db: LobeChatDatabase,
    actorUserId: string,
  ) {
    this.actorUserId = requireText(actorUserId, 'INVALID_ACTOR');
  }

  async settleClaimedReservation(
    input: SettleClaimedSponsoredReservationInput,
  ): Promise<SettleClaimedSponsoredReservationResult> {
    const reservationId = requireText(input.reservationId, 'INVALID_CONTEXT');
    const leaseVersion = requireLeaseVersion(input.leaseVersion);
    const providerRequestId = normalizeProviderRequestId(input.providerRequestId);

    const [locator] = await this.db
      .select({
        accountId: platformCreditReservations.accountId,
        budgetId: platformCreditReservations.budgetId,
      })
      .from(platformCreditReservations)
      .innerJoin(
        platformCreditBudgets,
        and(
          eq(platformCreditBudgets.id, platformCreditReservations.budgetId),
          eq(platformCreditBudgets.accountId, platformCreditReservations.accountId),
          eq(platformCreditBudgets.authorizationKind, 'group_member_sponsored'),
          eq(platformCreditBudgets.actorUserIdSnapshot, this.actorUserId),
        ),
      )
      .where(eq(platformCreditReservations.id, reservationId))
      .limit(1);
    if (!locator) {
      throw new SponsoredPlatformUsageSettlementError(
        'INVALID_CONTEXT',
        'Sponsored settlement context is invalid.',
      );
    }

    return this.db.transaction(async (tx) => {
      const database = tx as LobeChatDatabase;
      const [account] = await database
        .select()
        .from(platformCreditAccounts)
        .where(eq(platformCreditAccounts.id, locator.accountId))
        .for('update');
      const [budget] = await database
        .select()
        .from(platformCreditBudgets)
        .where(
          and(
            eq(platformCreditBudgets.id, locator.budgetId),
            eq(platformCreditBudgets.accountId, locator.accountId),
            eq(platformCreditBudgets.actorUserIdSnapshot, this.actorUserId),
          ),
        )
        .for('update');
      const [reservation] = await database
        .select()
        .from(platformCreditReservations)
        .where(
          and(
            eq(platformCreditReservations.id, reservationId),
            eq(platformCreditReservations.budgetId, locator.budgetId),
            eq(platformCreditReservations.accountId, locator.accountId),
          ),
        )
        .for('update');
      if (
        !account ||
        !budget ||
        !reservation ||
        !validSponsoredSnapshot(budget) ||
        account.userIdSnapshot !== budget.userIdSnapshot ||
        reservation.workspaceId !== null
      ) {
        throw new SponsoredPlatformUsageSettlementError(
          'INVALID_CONTEXT',
          'Sponsored settlement context is invalid.',
        );
      }
      if (reservation.leaseVersion !== leaseVersion) {
        throw new SponsoredPlatformUsageSettlementError(
          'INVALID_STATE',
          'Sponsored settlement reservation state is invalid.',
        );
      }

      let charge;
      try {
        charge = preparePlatformUsageCharge({
          actorUserId: budget.actorUserIdSnapshot,
          generationId: reservation.generationId,
          generationType: reservation.generationType,
          model: reservation.model,
          provider: reservation.provider,
          usage: input.usage,
          workspaceId: reservation.workspaceId,
        });
      } catch {
        throw new SponsoredPlatformUsageSettlementError(
          'SETTLEMENT_FAILED',
          'Authoritative sponsored usage is unavailable.',
        );
      }

      if (reservation.status === 'settled') {
        const [entry] = reservation.usageEntryId
          ? await database
              .select()
              .from(platformCreditEntries)
              .where(eq(platformCreditEntries.id, reservation.usageEntryId))
              .limit(1)
          : [];
        const actualUsage = reservation.actualUsage as
          (Record<string, number> & { cost: number }) | null;
        if (
          !entry ||
          entry.accountId !== account.id ||
          entry.userIdSnapshot !== budget.userIdSnapshot ||
          entry.actorUserIdSnapshot !== budget.actorUserIdSnapshot ||
          entry.amountCredits !== -charge.credits ||
          entry.costUsd !== charge.costUsd ||
          entry.generationId !== reservation.generationId ||
          entry.generationType !== reservation.generationType ||
          entry.idempotencyKey !== charge.idempotency.key ||
          entry.model !== reservation.model ||
          entry.provider !== reservation.provider ||
          entry.workspaceId !== null ||
          reservation.providerRequestId !== providerRequestId ||
          actualUsage?.cost !== charge.costUsd ||
          !sameTokenUsage(entry.tokenUsage, charge.tokens) ||
          !sameTokenUsage(actualUsage, charge.tokens)
        ) {
          throw new SponsoredPlatformUsageSettlementError(
            'IDEMPOTENCY_CONFLICT',
            'Sponsored settlement replay does not match the original result.',
          );
        }
        return { entry, reservation };
      }
      if (reservation.status !== 'provider_started' || budget.status !== 'active') {
        throw new SponsoredPlatformUsageSettlementError(
          'INVALID_STATE',
          'Sponsored settlement reservation state is invalid.',
        );
      }
      if (
        charge.credits > reservation.reservedCredits ||
        budget.consumedCredits + charge.credits > budget.authorizedCredits
      ) {
        throw new SponsoredPlatformUsageSettlementError(
          'SETTLEMENT_FAILED',
          'Sponsored usage exceeds the authorized reservation.',
        );
      }

      const [existingEntry] = await database
        .select()
        .from(platformCreditEntries)
        .where(
          and(
            eq(platformCreditEntries.accountId, account.id),
            eq(platformCreditEntries.idempotencyKey, charge.idempotency.key),
          ),
        )
        .limit(1)
        .for('update');
      if (existingEntry) {
        throw new SponsoredPlatformUsageSettlementError(
          'IDEMPOTENCY_CONFLICT',
          'Sponsored settlement identity is already in use.',
        );
      }

      const [hold] = await database
        .select({
          credits:
            sql<number>`coalesce(sum(${platformCreditBudgets.authorizedCredits} - ${platformCreditBudgets.consumedCredits}), 0)`.mapWith(
              Number,
            ),
        })
        .from(platformCreditBudgets)
        .where(
          and(
            eq(platformCreditBudgets.accountId, account.id),
            eq(platformCreditBudgets.status, 'active'),
          ),
        );
      const heldCredits = hold?.credits ?? 0;
      const balanceAfterCredits = account.balanceCredits - charge.credits;
      if (
        !Number.isSafeInteger(heldCredits) ||
        heldCredits < 0 ||
        !Number.isSafeInteger(balanceAfterCredits) ||
        balanceAfterCredits < heldCredits - charge.credits
      ) {
        throw new SponsoredPlatformUsageSettlementError(
          'SETTLEMENT_FAILED',
          'The original payer cannot settle the sponsored usage.',
        );
      }

      const [entry] = await database
        .insert(platformCreditEntries)
        .values({
          accountId: account.id,
          actorUserId: budget.actorUserId,
          actorUserIdSnapshot: budget.actorUserIdSnapshot,
          amountCredits: -charge.credits,
          balanceAfterCredits,
          costUsd: charge.costUsd,
          generationId: reservation.generationId,
          generationType: reservation.generationType,
          idempotencyKey: charge.idempotency.key,
          model: reservation.model,
          provider: reservation.provider,
          reason: `模型用量扣费：${reservation.provider}/${reservation.model}`,
          tokenUsage: charge.tokens,
          type: 'usage_charge',
          userId: budget.userId,
          userIdSnapshot: budget.userIdSnapshot,
          workspaceId: null,
        })
        .returning();
      await database
        .update(platformCreditAccounts)
        .set({ balanceCredits: balanceAfterCredits, updatedAt: new Date() })
        .where(eq(platformCreditAccounts.id, account.id));
      await database
        .update(platformCreditBudgets)
        .set({
          consumedCredits: budget.consumedCredits + charge.credits,
          updatedAt: new Date(),
        })
        .where(eq(platformCreditBudgets.id, budget.id));
      const [settledReservation] = await database
        .update(platformCreditReservations)
        .set({
          actualUsage: { cost: charge.costUsd, ...charge.tokens },
          providerRequestId,
          settledCredits: charge.credits,
          status: 'settled',
          updatedAt: new Date(),
          usageEntryId: entry.id,
        })
        .where(
          and(
            eq(platformCreditReservations.id, reservation.id),
            eq(platformCreditReservations.status, 'provider_started'),
          ),
        )
        .returning();
      if (!settledReservation) {
        throw new SponsoredPlatformUsageSettlementError(
          'INVALID_STATE',
          'Sponsored settlement reservation state is invalid.',
        );
      }
      return { entry, reservation: settledReservation };
    });
  }
}
