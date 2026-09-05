import { createHash } from 'node:crypto';

import {
  ChatGroupSponsoredCreditModel,
  type LobeChatDatabase,
  PLATFORM_CREDIT_RESERVATION_INVALID_STATE,
} from '@lobechat/database';

import type { ModelUsage } from '@/types/message';

import {
  type PlatformModelPricingSnapshot,
  pricePlatformTextUsage,
  resolvePlatformModelPricing,
} from './modelPricing';
import { PlatformUsageReservationService } from './reservation';
import { SponsoredPlatformUsageSettlement } from './sponsoredSettlement';

const PLATFORM_USAGE_SHARED_BUDGET = Symbol('platform-usage-shared-budget');

export type PlatformUsageSharedBudgetErrorCode =
  | 'BUDGET_BINDING_CONFLICT'
  | 'INVALID_BUDGET_CONTEXT'
  | 'MODEL_PRICING_UNAVAILABLE'
  | 'PROVIDER_ALREADY_CLAIMED'
  | 'PROVIDER_OUTCOME_UNKNOWN'
  | 'RESERVATION_FAILED'
  | 'SETTLEMENT_FAILED';

export class PlatformUsageSharedBudgetError extends Error {
  readonly code: PlatformUsageSharedBudgetErrorCode;

  constructor(code: PlatformUsageSharedBudgetErrorCode, message: string) {
    super(message);
    this.name = 'PlatformUsageSharedBudgetError';
    this.code = code;
  }
}

export interface PlatformUsageSharedBudgetHandle {
  readonly [PLATFORM_USAGE_SHARED_BUDGET]: true;
}

interface PlatformUsageSharedBudgetState {
  actorUserId: string;
  authorizationKind: 'group_member_sponsored' | 'self';
  budgetId: string;
  budgetLeaseVersion: number;
  db: LobeChatDatabase;
  expiresAt: Date;
  maxCredits: number;
  operationIds: Set<string>;
  requestDigest: string;
  reservationService: PlatformUsageReservationService;
  sponsoredCreditModel?: ChatGroupSponsoredCreditModel;
  sponsoredSettlement?: SponsoredPlatformUsageSettlement;
  workspaceId?: string | null;
}

export interface CreatePlatformUsageSharedBudgetInput {
  expiresAt: Date;
  /** User-supplied request ceiling. A balance or estimated cost is never accepted here. */
  maxCredits: number;
  /** Server-side durable request identity. It is digested before persistence. */
  requestIdentity: string;
  workspaceId?: string | null;
}

export interface CreateSponsoredPlatformUsageSharedBudgetInput {
  chatGroupId: string;
  expectedMembershipVersion: number;
  expectedPolicyVersion: number;
  expiresAt: Date;
  /** User-supplied request ceiling; policy limits are rechecked atomically. */
  maxCredits: number;
  /** Server-side durable request identity. It is digested before persistence. */
  requestIdentity: string;
}

export interface RunPlatformUsageSharedBudgetStepInput<T> {
  actorUserId: string;
  inputHash: string;
  kind: 'call_llm' | 'compress_context';
  model: string;
  operationId: string;
  /**
   * Server-only preparation performed after the durable reservation exposes its authoritative
   * remainder, but before the reservation is claimed for provider execution.
   */
  prepareProviderCall?: (context: {
    pricing: Readonly<PlatformModelPricingSnapshot>;
    remainingCredits: number;
  }) => Promise<
    () => Promise<{
      output: T;
      providerRequestId?: string | null;
      usage?: ModelUsage;
    }>
  >;
  provider: string;
  /** Existing unbounded server call path. New hosted production calls must prepare instead. */
  providerCall?: () => Promise<{
    output: T;
    providerRequestId?: string | null;
    usage?: ModelUsage;
  }>;
  stepIndex: number;
  workspaceId?: string | null;
}

export interface PlatformUsageSharedBudgetBindingContext {
  actorUserId: string;
  workspaceId?: string | null;
}

const states = new WeakMap<PlatformUsageSharedBudgetHandle, PlatformUsageSharedBudgetState>();
const operationBudgets = new Map<string, PlatformUsageSharedBudgetHandle>();

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

const requireText = (value: string, field: string) => {
  const normalized = value.trim();
  if (!normalized) {
    throw new PlatformUsageSharedBudgetError(
      'INVALID_BUDGET_CONTEXT',
      `${field} is required for a platform usage budget.`,
    );
  }
  return normalized;
};

const getState = (handle: PlatformUsageSharedBudgetHandle) => {
  const state = states.get(handle);
  if (!state) {
    throw new PlatformUsageSharedBudgetError(
      'INVALID_BUDGET_CONTEXT',
      'Platform usage budget context is unavailable.',
    );
  }
  return state;
};

const isSameBindingContext = (
  state: PlatformUsageSharedBudgetState,
  context: PlatformUsageSharedBudgetBindingContext,
) =>
  state.actorUserId === context.actorUserId.trim() &&
  (state.workspaceId ?? null) === (context.workspaceId ?? null);

const assertBindingContext = (
  state: PlatformUsageSharedBudgetState,
  context: PlatformUsageSharedBudgetBindingContext,
) => {
  requireText(context.actorUserId, 'actorUserId');
  if (!isSameBindingContext(state, context)) {
    throw new PlatformUsageSharedBudgetError(
      'INVALID_BUDGET_CONTEXT',
      'Platform usage budget does not belong to this actor and workspace.',
    );
  }
};

export const hashPlatformUsageProviderInput = (input: unknown): string =>
  digest(JSON.stringify(input));

export const createPlatformUsageSharedBudget = async (
  db: LobeChatDatabase,
  actorUserId: string,
  input: CreatePlatformUsageSharedBudgetInput,
): Promise<PlatformUsageSharedBudgetHandle> => {
  const normalizedActorUserId = requireText(actorUserId, 'actorUserId');
  const requestIdentity = requireText(input.requestIdentity, 'requestIdentity');
  const requestDigest = digest(requestIdentity);
  const reservationService = new PlatformUsageReservationService(db, normalizedActorUserId);
  let budget;
  try {
    budget = await reservationService.reserveRequest({
      expiresAt: input.expiresAt,
      idempotencyKey: `shared-request:${requestDigest}`,
      limit: { maxCredits: input.maxCredits, source: 'user-explicit' },
      sourceId: requestDigest,
      sourceType: 'platform-managed-agent-request',
      workspaceId: input.workspaceId,
    });
  } catch {
    throw new PlatformUsageSharedBudgetError(
      'RESERVATION_FAILED',
      'Platform usage request reservation failed.',
    );
  }
  const handle = Object.freeze({
    [PLATFORM_USAGE_SHARED_BUDGET]: true as const,
  });
  states.set(handle, {
    actorUserId: normalizedActorUserId,
    authorizationKind: 'self',
    budgetId: budget.id,
    budgetLeaseVersion: budget.leaseVersion,
    db,
    expiresAt: budget.expiresAt,
    maxCredits: input.maxCredits,
    operationIds: new Set(),
    requestDigest,
    reservationService,
    workspaceId: input.workspaceId,
  });
  return handle;
};

/** Creates an opaque shared-budget handle backed by an atomically admitted group sponsorship. */
export const createSponsoredPlatformUsageSharedBudget = async (
  db: LobeChatDatabase,
  actorUserId: string,
  input: CreateSponsoredPlatformUsageSharedBudgetInput,
): Promise<PlatformUsageSharedBudgetHandle> => {
  const normalizedActorUserId = requireText(actorUserId, 'actorUserId');
  const requestIdentity = requireText(input.requestIdentity, 'requestIdentity');
  const requestDigest = digest(requestIdentity);
  const sponsoredCreditModel = new ChatGroupSponsoredCreditModel(db, normalizedActorUserId);
  let budget;
  try {
    budget = await sponsoredCreditModel.reserveSponsoredBudget({
      authorizedCredits: input.maxCredits,
      chatGroupId: input.chatGroupId,
      expectedMembershipVersion: input.expectedMembershipVersion,
      expectedPolicyVersion: input.expectedPolicyVersion,
      expiresAt: input.expiresAt,
      idempotencyKey: `shared-sponsored-request:${requestDigest}`,
      requestHash: requestDigest,
      sourceId: requestDigest,
      sourceType: 'platform-managed-agent-request',
    });
  } catch {
    throw new PlatformUsageSharedBudgetError(
      'RESERVATION_FAILED',
      'Sponsored platform usage request reservation failed.',
    );
  }

  const handle = Object.freeze({
    [PLATFORM_USAGE_SHARED_BUDGET]: true as const,
  });
  states.set(handle, {
    actorUserId: normalizedActorUserId,
    authorizationKind: 'group_member_sponsored',
    budgetId: budget.id,
    budgetLeaseVersion: budget.leaseVersion,
    db,
    expiresAt: budget.expiresAt,
    maxCredits: input.maxCredits,
    operationIds: new Set(),
    requestDigest,
    reservationService: new PlatformUsageReservationService(db, budget.userIdSnapshot),
    sponsoredCreditModel,
    sponsoredSettlement: new SponsoredPlatformUsageSettlement(db, normalizedActorUserId),
    workspaceId: null,
  });
  return handle;
};

export const bindPlatformUsageSharedBudget = (
  operationId: string,
  handle: PlatformUsageSharedBudgetHandle,
  context: PlatformUsageSharedBudgetBindingContext,
) => {
  const normalizedOperationId = requireText(operationId, 'operationId');
  const state = getState(handle);
  assertBindingContext(state, context);
  const current = operationBudgets.get(normalizedOperationId);
  if (current && current !== handle) {
    throw new PlatformUsageSharedBudgetError(
      'BUDGET_BINDING_CONFLICT',
      'The operation is already bound to another platform usage budget.',
    );
  }
  operationBudgets.set(normalizedOperationId, handle);
  state.operationIds.add(normalizedOperationId);
};

export const inheritPlatformUsageSharedBudget = (
  parentOperationId: string,
  childOperationId: string,
  context: PlatformUsageSharedBudgetBindingContext,
) => {
  const handle = getPlatformUsageSharedBudgetForOperation(parentOperationId, context);
  if (!handle) return;
  bindPlatformUsageSharedBudget(childOperationId, handle, context);
};

export const getPlatformUsageSharedBudgetForOperation = (
  operationId: string,
  context: PlatformUsageSharedBudgetBindingContext,
) => {
  const handle = operationBudgets.get(operationId);
  if (!handle) return;
  const state = getState(handle);
  if (!isSameBindingContext(state, context)) return;
  return handle;
};

export const getPlatformUsageSharedBudgetLimit = (
  handle: PlatformUsageSharedBudgetHandle,
  context: PlatformUsageSharedBudgetBindingContext,
): number => {
  const state = getState(handle);
  assertBindingContext(state, context);
  return state.maxCredits;
};

export const runPlatformUsageSharedBudgetStep = async <T>(
  handle: PlatformUsageSharedBudgetHandle,
  input: RunPlatformUsageSharedBudgetStepInput<T>,
): Promise<T> => {
  const state = getState(handle);
  const operationId = requireText(input.operationId, 'operationId');
  assertBindingContext(state, input);
  if (operationBudgets.get(operationId) !== handle || !state.operationIds.has(operationId)) {
    throw new PlatformUsageSharedBudgetError(
      'INVALID_BUDGET_CONTEXT',
      'Platform usage budget is not bound to this operation.',
    );
  }
  const inputHash = requireText(input.inputHash, 'inputHash');
  const model = requireText(input.model, 'model');
  const provider = requireText(input.provider, 'provider');
  if (Boolean(input.providerCall) === Boolean(input.prepareProviderCall)) {
    throw new PlatformUsageSharedBudgetError(
      'INVALID_BUDGET_CONTEXT',
      'Exactly one platform provider call path is required.',
    );
  }
  let pricing: PlatformModelPricingSnapshot;
  try {
    const resolvedPricing = await resolvePlatformModelPricing(state.db, { model, provider });
    if (!resolvedPricing) throw new Error('Exact model pricing is unavailable');
    pricing = resolvedPricing;
  } catch {
    throw new PlatformUsageSharedBudgetError(
      'MODEL_PRICING_UNAVAILABLE',
      'Exact platform model pricing is unavailable.',
    );
  }
  const callDigest = digest(
    JSON.stringify({
      inputHash,
      kind: input.kind,
      model,
      operationId,
      provider,
      requestDigest: state.requestDigest,
      stepIndex: input.stepIndex,
      version: 1,
    }),
  );

  let reservation;
  try {
    reservation =
      state.authorizationKind === 'group_member_sponsored'
        ? await state.sponsoredCreditModel!.reserveSponsoredRemainingCall({
            budgetId: state.budgetId,
            budgetLeaseVersion: state.budgetLeaseVersion,
            callKind: input.kind,
            expiresAt: state.expiresAt,
            generationId: callDigest,
            generationType: 'agent-runtime-text-step',
            idempotencyKey: `shared-call:${callDigest}`,
            model,
            provider,
            requestHash: inputHash,
          })
        : await state.reservationService.reserveRemainingCall({
            budgetId: state.budgetId,
            budgetLeaseVersion: state.budgetLeaseVersion,
            callKind: input.kind,
            expiresAt: state.expiresAt,
            generationId: callDigest,
            generationType: 'agent-runtime-text-step',
            idempotencyKey: `shared-call:${callDigest}`,
            inputHash,
            model,
            provider,
            workspaceId: state.workspaceId,
          });
  } catch {
    throw new PlatformUsageSharedBudgetError(
      'RESERVATION_FAILED',
      'Platform usage reservation failed.',
    );
  }

  let providerCall = input.providerCall;
  if (input.prepareProviderCall) {
    providerCall = await input.prepareProviderCall({
      pricing,
      remainingCredits: reservation.reservedCredits,
    });
  }
  if (typeof providerCall !== 'function') {
    throw new PlatformUsageSharedBudgetError(
      'INVALID_BUDGET_CONTEXT',
      'Platform provider call preparation is incomplete.',
    );
  }

  let claim;
  try {
    claim =
      state.authorizationKind === 'group_member_sponsored'
        ? await state.sponsoredCreditModel!.claimSponsoredReservationForProvider({
            leaseVersion: reservation.leaseVersion,
            reservationId: reservation.id,
          })
        : await state.reservationService.claim({
            leaseVersion: reservation.leaseVersion,
            reservationId: reservation.id,
          });
  } catch {
    throw new PlatformUsageSharedBudgetError(
      'RESERVATION_FAILED',
      'Platform usage reservation claim failed.',
    );
  }
  if (!claim.shouldCallProvider) {
    throw new PlatformUsageSharedBudgetError(
      'PROVIDER_ALREADY_CLAIMED',
      'Platform usage provider call was already claimed.',
    );
  }

  let completion;
  try {
    completion = await providerCall();
  } catch {
    // Once provider_started is durable, releasing or retrying can double-spend.
    throw new PlatformUsageSharedBudgetError(
      'PROVIDER_OUTCOME_UNKNOWN',
      'Platform usage provider outcome is unknown.',
    );
  }

  try {
    const usage = completion.usage ? pricePlatformTextUsage(pricing, completion.usage) : undefined;
    if (state.authorizationKind === 'group_member_sponsored') {
      await state.sponsoredSettlement!.settleClaimedReservation({
        leaseVersion: claim.reservation.leaseVersion,
        providerRequestId: completion.providerRequestId,
        reservationId: reservation.id,
        usage,
      });
    } else {
      await state.reservationService.completeAndSettle({
        completeRequest: false,
        leaseVersion: claim.reservation.leaseVersion,
        providerRequestId: completion.providerRequestId,
        reservationId: reservation.id,
        usage,
      });
    }
  } catch {
    throw new PlatformUsageSharedBudgetError(
      'SETTLEMENT_FAILED',
      'Platform usage settlement failed.',
    );
  }

  return completion.output;
};

export const completePlatformUsageSharedBudgetForOperation = async (
  operationId: string,
): Promise<boolean> => {
  const handle = operationBudgets.get(operationId);
  if (!handle) return false;
  const state = getState(handle);
  operationBudgets.delete(operationId);
  state.operationIds.delete(operationId);
  if (state.operationIds.size > 0) return false;

  try {
    await state.reservationService.completeRequest(state.budgetId);
    return true;
  } catch (error) {
    // An active reservation is deliberately retained for provider reconciliation.
    operationBudgets.set(operationId, handle);
    state.operationIds.add(operationId);
    if (error instanceof Error && error.message === PLATFORM_CREDIT_RESERVATION_INVALID_STATE) {
      return false;
    }
    throw new PlatformUsageSharedBudgetError(
      'SETTLEMENT_FAILED',
      'Platform usage budget completion failed.',
    );
  }
};
