import { createHash } from 'node:crypto';

import { type LobeChatDatabase, PlatformCreditModel } from '@lobechat/database';

import { notifyCreditEntry } from '@/server/services/notification/credit';
import type { ModelUsage } from '@/types/message';

import { preparePlatformUsageCharge } from './index';

export type PlatformUsageHardLimitProof = {
  kind: 'protocol-constraint' | 'provider-contract';
  /** Stable reference to the contract or protocol rule establishing the maximum. */
  reference: string;
};

export type PlatformUsageReservationLimit =
  | {
      /** Trusted server admission policy; each provider call must separately prove its ceiling. */
      maxCredits: number;
      source: 'server-policy';
    }
  | {
      /** A maximum the user explicitly supplied for this request or call. */
      maxCredits: number;
      source: 'user-explicit';
    }
  | {
      /** A maximum guaranteed by an external contract, never an estimate. */
      maxCredits: number;
      proof: PlatformUsageHardLimitProof;
      source: 'proven-hard-limit';
    };

export type PreviewedPlatformUsageReservationLimit = PlatformUsageReservationLimit;

export type PlatformUsageReservationErrorCode =
  'INVALID_ACTOR' | 'INVALID_CALL' | 'INVALID_LIMIT' | 'RESERVATION_NOT_FOUND';

export class PlatformUsageReservationError extends Error {
  readonly code: PlatformUsageReservationErrorCode;

  constructor(code: PlatformUsageReservationErrorCode, message: string) {
    super(message);
    this.name = 'PlatformUsageReservationError';
    this.code = code;
  }
}

export interface ReservePlatformUsageRequestInput {
  expiresAt: Date;
  idempotencyKey: string;
  limit: PlatformUsageReservationLimit;
  sourceId: string;
  sourceType: string;
  workspaceId?: string | null;
}

export interface ReservePlatformUsageCallInput {
  budgetId: string;
  callKind: 'call_llm' | 'compress_context' | 'image';
  expiresAt: Date;
  generationId: string;
  generationType?: string | null;
  idempotencyKey: string;
  limit: PlatformUsageReservationLimit;
  model: string;
  provider: string;
  workspaceId?: string | null;
}

export interface ReserveRemainingPlatformUsageCallInput extends Omit<
  ReservePlatformUsageCallInput,
  'limit'
> {
  /** Lease of the request budget that authorizes this provider call. */
  budgetLeaseVersion: number;
  /** Server-derived digest of the exact provider input; raw prompts are never persisted. */
  inputHash: string;
  /** Server policy ceiling for one metered provider call. */
  maxCredits?: number;
}

export interface PlatformUsageReservationLeaseInput {
  leaseVersion: number;
  reservationId: string;
}

export interface ReleaseUnclaimedPlatformUsageInput extends PlatformUsageReservationLeaseInput {
  /** Mark the request terminal after releasing this unclaimed call. */
  completeRequest?: boolean;
}

export interface CompleteAndSettlePlatformUsageInput extends PlatformUsageReservationLeaseInput {
  /** Mark the request terminal after this call, releasing its unused maximum. */
  completeRequest?: boolean;
  providerRequestId?: string | null;
  /** Authoritative usage returned by the model runtime after provider completion. */
  usage?: ModelUsage;
}

export interface RecordPlatformProviderRequestIdInput extends PlatformUsageReservationLeaseInput {
  providerRequestId: string;
}

type PlatformUsageReservationLedger = Pick<
  PlatformCreditModel,
  | 'claimReservationForProvider'
  | 'completeBudget'
  | 'getReservation'
  | 'recordProviderCompletion'
  | 'recordProviderRequestId'
  | 'releaseReservation'
  | 'reserveBudget'
  | 'reserveCall'
  | 'reserveRemainingCall'
  | 'settleReservedUsage'
>;

const proofKinds = new Set<PlatformUsageHardLimitProof['kind']>([
  'protocol-constraint',
  'provider-contract',
]);

const requireActorUserId = (value: string) => {
  const actorUserId = value.trim();
  if (!actorUserId) {
    throw new PlatformUsageReservationError(
      'INVALID_ACTOR',
      'Platform usage reservation requires an actor user id.',
    );
  }
  return actorUserId;
};

const requestHash = (material: Record<string, unknown>) =>
  createHash('sha256').update(JSON.stringify(material)).digest('hex');

/**
 * Admission and reservation orchestration over PlatformCreditModel's atomic primitives.
 *
 * Request admission can use a trusted server policy or explicit user ceiling. Neither is a
 * provider cost forecast: execution must separately prove that its worst case fits the hold.
 */
export class PlatformUsageReservationService {
  private readonly actorUserId: string;
  private readonly ledger: PlatformUsageReservationLedger;

  constructor(db: LobeChatDatabase, actorUserId: string, ledger?: PlatformUsageReservationLedger) {
    this.actorUserId = requireActorUserId(actorUserId);
    this.ledger = ledger ?? new PlatformCreditModel(db, this.actorUserId);
  }

  previewExplicitLimit(
    input: PlatformUsageReservationLimit,
  ): PreviewedPlatformUsageReservationLimit {
    if (!input || !Number.isSafeInteger(input.maxCredits) || input.maxCredits <= 0) {
      throw new PlatformUsageReservationError(
        'INVALID_LIMIT',
        'A reservation maximum must be a positive safe integer number of Credits.',
      );
    }

    if (input.source === 'user-explicit' || input.source === 'server-policy') {
      return { maxCredits: input.maxCredits, source: input.source };
    }

    if (input.source === 'proven-hard-limit') {
      const proof = input.proof;
      const reference = proof?.reference?.trim();
      if (!proof || !proofKinds.has(proof.kind) || !reference) {
        throw new PlatformUsageReservationError(
          'INVALID_LIMIT',
          'A proven hard limit requires a supported proof and stable reference.',
        );
      }
      return {
        maxCredits: input.maxCredits,
        proof: { kind: proof.kind, reference },
        source: input.source,
      };
    }

    throw new PlatformUsageReservationError(
      'INVALID_LIMIT',
      'Estimated costs, account balances, and fixed service prices are not reservation limits.',
    );
  }

  reserveRequest(input: ReservePlatformUsageRequestInput) {
    const limit = this.previewExplicitLimit(input.limit);
    const material = {
      actorUserId: this.actorUserId,
      expiresAt: input.expiresAt.toISOString(),
      limit,
      sourceId: input.sourceId,
      sourceType: input.sourceType,
      version: 1,
      workspaceId: input.workspaceId ?? null,
    };

    return this.ledger.reserveBudget({
      authorizedCredits: limit.maxCredits,
      expiresAt: input.expiresAt,
      idempotencyKey: input.idempotencyKey,
      requestHash: requestHash(material),
      sourceId: input.sourceId,
      sourceType: input.sourceType,
      workspaceId: input.workspaceId,
    });
  }

  reserveCall(input: ReservePlatformUsageCallInput) {
    const limit = this.previewExplicitLimit(input.limit);
    return this.ledger.reserveCall({
      budgetId: input.budgetId,
      callKind: input.callKind,
      expiresAt: input.expiresAt,
      generationId: input.generationId,
      generationType: input.generationType,
      idempotencyKey: input.idempotencyKey,
      model: input.model,
      provider: input.provider,
      reservedCredits: limit.maxCredits,
      workspaceId: input.workspaceId,
    });
  }

  reserveRemainingCall(input: ReserveRemainingPlatformUsageCallInput) {
    const inputHash = input.inputHash.trim();
    if (!inputHash) {
      throw new PlatformUsageReservationError(
        'INVALID_CALL',
        'A call input digest is required for exact reservation replay.',
      );
    }
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey) {
      throw new PlatformUsageReservationError(
        'INVALID_CALL',
        'A stable call idempotency key is required for exact reservation replay.',
      );
    }
    const callRequestHash = requestHash({
      actorUserId: this.actorUserId,
      budgetId: input.budgetId,
      callKind: input.callKind,
      generationId: input.generationId,
      generationType: input.generationType ?? null,
      inputHash,
      model: input.model,
      provider: input.provider,
      version: 1,
      workspaceId: input.workspaceId ?? null,
    });
    return this.ledger.reserveRemainingCall({
      budgetId: input.budgetId,
      budgetLeaseVersion: input.budgetLeaseVersion,
      callKind: input.callKind,
      expiresAt: input.expiresAt,
      generationId: input.generationId,
      generationType: input.generationType,
      idempotencyKey,
      model: input.model,
      provider: input.provider,
      reservedCredits: input.maxCredits,
      requestHash: callRequestHash,
      workspaceId: input.workspaceId,
    });
  }

  claim(input: PlatformUsageReservationLeaseInput) {
    return this.ledger.claimReservationForProvider(input);
  }

  getReservation(reservationId: string) {
    return this.ledger.getReservation(reservationId);
  }

  recordProviderRequestId(input: RecordPlatformProviderRequestIdInput) {
    return this.ledger.recordProviderRequestId(input);
  }

  completeRequest(budgetId: string) {
    return this.ledger.completeBudget(budgetId);
  }

  async completeAndSettle(input: CompleteAndSettlePlatformUsageInput) {
    const reservation = await this.ledger.getReservation(input.reservationId);
    if (!reservation) {
      throw new PlatformUsageReservationError(
        'RESERVATION_NOT_FOUND',
        'The platform usage reservation does not exist for this actor.',
      );
    }

    const charge = preparePlatformUsageCharge({
      actorUserId: this.actorUserId,
      generationId: reservation.generationId,
      generationType: reservation.generationType,
      model: reservation.model,
      provider: reservation.provider,
      usage: input.usage,
      workspaceId: reservation.workspaceId,
    });

    await this.ledger.recordProviderCompletion({
      costUsd: charge.costUsd,
      credits: charge.credits,
      leaseVersion: input.leaseVersion,
      providerRequestId: input.providerRequestId,
      reservationId: reservation.id,
      tokenUsage: charge.tokens,
    });

    const entry = await this.ledger.settleReservedUsage({
      actorUserId: this.actorUserId,
      costUsd: charge.costUsd,
      credits: charge.credits,
      generationId: reservation.generationId,
      generationType: reservation.generationType,
      idempotencyKey: charge.idempotency.key,
      leaseVersion: input.leaseVersion,
      model: reservation.model,
      provider: reservation.provider,
      reservationId: reservation.id,
      tokenUsage: charge.tokens,
      workspaceId: reservation.workspaceId,
    });

    const request = input.completeRequest
      ? await this.ledger.completeBudget(reservation.budgetId)
      : undefined;

    await notifyCreditEntry(entry);

    return {
      entry,
      request,
      reservation: await this.ledger.getReservation(reservation.id),
    };
  }

  async releaseUnclaimed(input: ReleaseUnclaimedPlatformUsageInput) {
    const current = await this.ledger.getReservation(input.reservationId);
    if (!current) {
      throw new PlatformUsageReservationError(
        'RESERVATION_NOT_FOUND',
        'The platform usage reservation does not exist for this actor.',
      );
    }
    const reservation = await this.ledger.releaseReservation(input);
    const request = input.completeRequest
      ? await this.ledger.completeBudget(current.budgetId)
      : undefined;
    return { request, reservation };
  }
}
