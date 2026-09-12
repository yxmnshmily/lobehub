import { createHash } from 'node:crypto';

import {
  ChatGroupSponsoredCreditModel,
  type LobeChatDatabase,
  PLATFORM_CREDIT_LEGACY_MANAGED_BUDGET_SOURCE_TYPE,
  PLATFORM_CREDIT_METERED_BUDGET_SOURCE_TYPE,
  PLATFORM_CREDIT_PREPAID_BUDGET_SOURCE_TYPE,
  PLATFORM_CREDIT_RESERVATION_INVALID_STATE,
} from '@lobechat/database';
import { agentOperations, platformCreditBudgets } from '@lobechat/database/schemas';
import { and, eq, isNull, ne, notInArray, sql } from 'drizzle-orm';

import type { ModelUsage } from '@/types/message';

import {
  type PlatformModelPricingSnapshot,
  pricePlatformTextUsage,
  resolvePlatformModelPricing,
} from './modelPricing';
import { PlatformUsageReservationService } from './reservation';
import { PlatformManagedTextUsageSettlement } from './settlement';
import { SponsoredPlatformUsageSettlement } from './sponsoredSettlement';

const PLATFORM_USAGE_SHARED_BUDGET = Symbol('platform-usage-shared-budget');

const PROVIDER_REQUEST_ID_HEADERS = [
  'x-request-id',
  'request-id',
  'x-tt-logid',
  'x-ms-request-id',
  'x-amzn-requestid',
] as const;

const normalizeProviderRequestId = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!/^[A-Z0-9][\w.:/=-]{0,199}$/i.test(normalized)) return undefined;
  return normalized;
};

const getProviderRequestIdFromHeaders = (headers: unknown): string | undefined => {
  if (!headers || typeof headers !== 'object') return undefined;
  const get = (headers as { get?: unknown }).get;
  if (typeof get === 'function') {
    for (const name of PROVIDER_REQUEST_ID_HEADERS) {
      const requestId = normalizeProviderRequestId(
        get.call(headers, name) ?? get.call(headers, name.toUpperCase()),
      );
      if (requestId) return requestId;
    }
    return undefined;
  }
  const values = new Map(
    Object.entries(headers as Record<string, unknown>).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  );
  for (const name of PROVIDER_REQUEST_ID_HEADERS) {
    const requestId = normalizeProviderRequestId(values.get(name));
    if (requestId) return requestId;
  }
  return undefined;
};

const getSafeProviderRequestId = (error: unknown, depth = 0): string | undefined => {
  if (!error || typeof error !== 'object' || depth > 3) return undefined;
  const value = error as Record<string, unknown>;
  const requestId = getProviderRequestIdFromHeaders(value.headers);
  if (requestId) return requestId;
  for (const nested of [value.error, value.cause, value.response]) {
    const nestedRequestId = getSafeProviderRequestId(nested, depth + 1);
    if (nestedRequestId) return nestedRequestId;
  }
  return undefined;
};

// Provider error bodies can contain credentials, prompts and private endpoints.
// Keep only bounded, allowlisted diagnostics; never attach the original cause.
const getSafeProviderTransportDiagnostic = (error: unknown, depth = 0): string | undefined => {
  if (!error || typeof error !== 'object' || depth > 3) return undefined;
  const value = error as Record<string, unknown>;
  for (const status of [value.status, value.statusCode]) {
    if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599) {
      return `HTTP ${status}`;
    }
  }
  if (value.name === 'TimeoutError' || value.code === 'ETIMEDOUT') return 'timeout';
  if (value.code === 'ECONNRESET' || value.code === 'ECONNREFUSED' || value.code === 'ENOTFOUND') {
    return 'connection failure';
  }
  for (const nested of [value.error, value.cause, value.response]) {
    const diagnostic = getSafeProviderTransportDiagnostic(nested, depth + 1);
    if (diagnostic) return diagnostic;
  }
  return undefined;
};

// Exact protocol names only: even a syntactically valid arbitrary code/param can
// contain user text or a credential. Never parse free-form provider messages.
const PROVIDER_REJECTION_CODES = new Set([
  'InvalidParameter',
  'InvalidParameterValue',
  'invalid_parameter',
  'invalid_request_error',
  'unsupported_parameter',
]);
const PROVIDER_REJECTION_PARAMS = new Set([
  'frequency_penalty',
  'max_completion_tokens',
  'max_output_tokens',
  'max_tokens',
  'model',
  'n',
  'presence_penalty',
  'reasoning',
  'reasoning_effort',
  'safety_identifier',
  'temperature',
  'thinking',
  'tool_choice',
  'tools',
  'top_p',
]);

const getSafeProviderRejection = (error: unknown, depth = 0): string | undefined => {
  if (!error || typeof error !== 'object' || depth > 3) return undefined;
  const value = error as Record<string, unknown>;
  const code =
    typeof value.code === 'string' && PROVIDER_REJECTION_CODES.has(value.code)
      ? `code=${value.code}`
      : undefined;
  const param =
    typeof value.param === 'string' && PROVIDER_REJECTION_PARAMS.has(value.param)
      ? `param=${value.param}`
      : undefined;
  if (code || param) return [code, param].filter(Boolean).join('; ');
  for (const nested of [value.error, value.cause, value.response]) {
    const rejection = getSafeProviderRejection(nested, depth + 1);
    if (rejection) return rejection;
  }
  return undefined;
};

const getSafeProviderDiagnostic = (error: unknown): string | undefined => {
  const diagnostic = [getSafeProviderTransportDiagnostic(error), getSafeProviderRejection(error)]
    .filter(Boolean)
    .join('; ');
  return diagnostic || undefined;
};

export type PlatformUsageSharedBudgetErrorCode =
  | 'BUDGET_BINDING_CONFLICT'
  | 'INVALID_BUDGET_CONTEXT'
  | 'MODEL_PRICING_UNAVAILABLE'
  | 'PREPAID_LIMIT_REQUIRED'
  | 'PROVIDER_ALREADY_CLAIMED'
  | 'PROVIDER_LIMIT_UNPROVEN'
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
  budgetId?: string;
  budgetLeaseVersion?: number;
  db: LobeChatDatabase;
  durableBinding?: boolean;
  expiresAt: Date;
  maxCredits?: number;
  meteredMaxCreditsPerCall?: number;
  operationIds: Set<string>;
  requestDigest: string;
  reservationService: PlatformUsageReservationService;
  settlementService: PlatformManagedTextUsageSettlement;
  sponsoredCreditModel?: ChatGroupSponsoredCreditModel;
  sponsoredSettlement?: SponsoredPlatformUsageSettlement;
  workspaceId?: string | null;
}

export interface CreatePlatformUsageSharedBudgetInput {
  expiresAt: Date;
  /** Only trusted server admission may select the automatic policy. */
  limitSource?: 'server-policy' | 'user-explicit';
  /** Optional explicit prepaid ceiling. Omission uses per-round actual-usage billing. */
  maxCredits?: number;
  /** Legacy compatibility only; automatic execution no longer creates a call hold. */
  meteredMaxCreditsPerCall?: number;
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
    remainingCredits?: number;
  }) => Promise<
    (context: {
      /** Persist response identity immediately, before a streamed body can fail. */
      recordProviderRequestId: (providerRequestId: string) => Promise<void>;
    }) => Promise<{
      output: T;
      providerRequestId?: string | null;
      usage?: ModelUsage;
    }>
  >;
  provider: string;
  /** Direct provider call used by per-round actual-usage billing. */
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
  if (input.maxCredits === undefined) {
    const handle = Object.freeze({ [PLATFORM_USAGE_SHARED_BUDGET]: true as const });
    states.set(handle, {
      actorUserId: normalizedActorUserId,
      authorizationKind: 'self',
      db,
      expiresAt: input.expiresAt,
      operationIds: new Set(),
      requestDigest,
      reservationService,
      settlementService: new PlatformManagedTextUsageSettlement(db, normalizedActorUserId),
      workspaceId: input.workspaceId,
    });
    return handle;
  }
  if (
    input.meteredMaxCreditsPerCall !== undefined &&
    (!Number.isSafeInteger(input.meteredMaxCreditsPerCall) || input.meteredMaxCreditsPerCall <= 0)
  ) {
    throw new PlatformUsageSharedBudgetError(
      'INVALID_BUDGET_CONTEXT',
      'Metered provider-call Credits must be a positive safe integer.',
    );
  }
  let budget;
  try {
    budget = await reservationService.reserveRequest({
      expiresAt: input.expiresAt,
      idempotencyKey: `shared-request:${requestDigest}`,
      limit: { maxCredits: input.maxCredits, source: input.limitSource ?? 'user-explicit' },
      sourceId: requestDigest,
      sourceType:
        input.meteredMaxCreditsPerCall === undefined
          ? PLATFORM_CREDIT_PREPAID_BUDGET_SOURCE_TYPE
          : PLATFORM_CREDIT_METERED_BUDGET_SOURCE_TYPE,
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
    meteredMaxCreditsPerCall: input.meteredMaxCreditsPerCall,
    operationIds: new Set(),
    requestDigest,
    reservationService,
    settlementService: new PlatformManagedTextUsageSettlement(db, normalizedActorUserId),
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
      sourceType: PLATFORM_CREDIT_PREPAID_BUDGET_SOURCE_TYPE,
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
    settlementService: new PlatformManagedTextUsageSettlement(db, budget.userIdSnapshot),
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
): number | undefined => {
  const state = getState(handle);
  assertBindingContext(state, context);
  return state.maxCredits;
};

/** Server-only locator: captured from an admitted handle, never from request/queue metadata. */
export const getPlatformUsageSharedBudgetSnapshot = (
  operationId: string,
  context: PlatformUsageSharedBudgetBindingContext,
) => {
  const handle = getPlatformUsageSharedBudgetForOperation(operationId, context);
  if (!handle) return;
  const state = getState(handle);
  if (!state.budgetId || !state.budgetLeaseVersion) return;
  state.durableBinding = true;
  return {
    actorUserId: state.actorUserId,
    budgetId: state.budgetId,
    leaseVersion: state.budgetLeaseVersion,
    meteredMaxCreditsPerCall: state.meteredMaxCreditsPerCall,
    version: 1,
  };
};

/** Restore only an existing server-persisted operation binding; this never admits new spending. */
export const restorePlatformUsageSharedBudgetForOperation = async (
  db: LobeChatDatabase,
  operationId: string,
  context: PlatformUsageSharedBudgetBindingContext,
): Promise<PlatformUsageSharedBudgetHandle | undefined> => {
  const cached = getPlatformUsageSharedBudgetForOperation(operationId, context);
  if (cached) return cached;
  const [operation] = await db
    .select({
      chatGroupId: agentOperations.chatGroupId,
      metadata: agentOperations.metadata,
      userId: agentOperations.userId,
      workspaceId: agentOperations.workspaceId,
    })
    .from(agentOperations)
    .where(eq(agentOperations.id, operationId))
    .limit(1);
  const locator = operation?.metadata?.platformUsageBudget as Record<string, unknown> | undefined;
  // Legacy / BYOK operations have no durable capability. Do not invent one.
  if (!locator) return;
  const invalid = () =>
    new PlatformUsageSharedBudgetError(
      'INVALID_BUDGET_CONTEXT',
      'Platform usage budget continuation is invalid or expired.',
    );
  if (
    locator.version !== 1 ||
    typeof locator.budgetId !== 'string' ||
    !/^[a-f0-9-]{36}$/i.test(locator.budgetId) ||
    locator.actorUserId !== context.actorUserId ||
    (operation!.workspaceId ?? null) !== (context.workspaceId ?? null)
  )
    throw invalid();
  const [budget] = await db
    .select()
    .from(platformCreditBudgets)
    .where(
      and(
        eq(platformCreditBudgets.id, locator.budgetId),
        eq(platformCreditBudgets.actorUserIdSnapshot, context.actorUserId),
        eq(platformCreditBudgets.userIdSnapshot, operation!.userId),
        context.workspaceId == null
          ? isNull(platformCreditBudgets.workspaceId)
          : eq(platformCreditBudgets.workspaceId, context.workspaceId),
      ),
    )
    .limit(1);
  if (
    !budget ||
    budget.status !== 'active' ||
    budget.expiresAt.getTime() <= Date.now() ||
    budget.leaseVersion !== locator.leaseVersion ||
    ![
      PLATFORM_CREDIT_LEGACY_MANAGED_BUDGET_SOURCE_TYPE,
      PLATFORM_CREDIT_METERED_BUDGET_SOURCE_TYPE,
      PLATFORM_CREDIT_PREPAID_BUDGET_SOURCE_TYPE,
    ].includes(budget.sourceType) ||
    (budget.sourceType === PLATFORM_CREDIT_METERED_BUDGET_SOURCE_TYPE &&
      (!Number.isSafeInteger(locator.meteredMaxCreditsPerCall) ||
        (locator.meteredMaxCreditsPerCall as number) <= 0)) ||
    (budget.authorizationKind === 'group_member_sponsored' &&
      budget.sponsorChatGroupIdSnapshot !== operation!.chatGroupId)
  )
    throw invalid();
  // A concurrent restore may have completed while the database was being read.
  const existing = getPlatformUsageSharedBudgetForOperation(operationId, context);
  if (existing) return existing;
  const handle = Object.freeze({ [PLATFORM_USAGE_SHARED_BUDGET]: true as const });
  states.set(handle, {
    actorUserId: context.actorUserId,
    authorizationKind: budget.authorizationKind,
    budgetId: budget.id,
    budgetLeaseVersion: budget.leaseVersion,
    db,
    durableBinding: true,
    expiresAt: budget.expiresAt,
    maxCredits: budget.authorizedCredits,
    meteredMaxCreditsPerCall:
      budget.sourceType === PLATFORM_CREDIT_METERED_BUDGET_SOURCE_TYPE
        ? (locator.meteredMaxCreditsPerCall as number)
        : undefined,
    operationIds: new Set(),
    requestDigest: budget.sourceId,
    reservationService: new PlatformUsageReservationService(db, budget.userIdSnapshot),
    settlementService: new PlatformManagedTextUsageSettlement(db, budget.userIdSnapshot),
    ...(budget.authorizationKind === 'group_member_sponsored'
      ? {
          sponsoredCreditModel: new ChatGroupSponsoredCreditModel(db, context.actorUserId),
          sponsoredSettlement: new SponsoredPlatformUsageSettlement(db, context.actorUserId),
        }
      : {}),
    workspaceId: budget.workspaceId,
  });
  bindPlatformUsageSharedBudget(operationId, handle, context);
  return handle;
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
  if (state.maxCredits === undefined) {
    if (!input.providerCall) {
      throw new PlatformUsageSharedBudgetError(
        'INVALID_BUDGET_CONTEXT',
        'Per-round billing requires a direct provider call.',
      );
    }
    await state.settlementService.assertCanCallProvider();
    const completion = await input.providerCall();
    await state.settlementService.settleStep({
      kind: input.kind,
      model,
      operationId,
      provider,
      stepIndex: input.stepIndex,
      usage: completion.usage,
      workspaceId: state.workspaceId,
    });
    return completion.output;
  }
  if (!input.prepareProviderCall) {
    throw new PlatformUsageSharedBudgetError(
      'PROVIDER_LIMIT_UNPROVEN',
      '该模型调用尚未验证费用上限，平台付费调用暂不可用。',
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
    const reserveRemainingCall = (service: PlatformUsageReservationService) =>
      service.reserveRemainingCall({
        budgetId: state.budgetId!,
        budgetLeaseVersion: state.budgetLeaseVersion!,
        callKind: input.kind,
        expiresAt: state.expiresAt,
        generationId: callDigest,
        generationType: 'agent-runtime-text-step',
        idempotencyKey: `shared-call:${callDigest}`,
        inputHash,
        model,
        maxCredits: state.meteredMaxCreditsPerCall,
        provider,
        workspaceId: state.workspaceId,
      });
    reservation =
      state.authorizationKind === 'group_member_sponsored'
        ? await state.sponsoredCreditModel!.reserveSponsoredRemainingCall({
            budgetId: state.budgetId!,
            budgetLeaseVersion: state.budgetLeaseVersion!,
            callKind: input.kind,
            expiresAt: state.expiresAt,
            generationId: callDigest,
            generationType: 'agent-runtime-text-step',
            idempotencyKey: `shared-call:${callDigest}`,
            model,
            provider,
            requestHash: inputHash,
          })
        : await reserveRemainingCall(state.reservationService);
  } catch {
    throw new PlatformUsageSharedBudgetError(
      'RESERVATION_FAILED',
      'Platform usage reservation failed.',
    );
  }

  let providerCall: Awaited<ReturnType<NonNullable<typeof input.prepareProviderCall>>>;
  try {
    providerCall = await input.prepareProviderCall({
      pricing,
      remainingCredits: reservation.reservedCredits,
    });
    if (typeof providerCall !== 'function') {
      throw new PlatformUsageSharedBudgetError(
        'INVALID_BUDGET_CONTEXT',
        'Platform provider call preparation is incomplete.',
      );
    }
  } catch (error) {
    if (reservation.status === 'reserved') {
      try {
        // All handles retain the admitted payer's service. The ledger checks
        // ownership, lease and reserved state atomically, including a racing claim.
        // Keep the root budget open for other bound operations.
        await state.reservationService.releaseUnclaimed({
          leaseVersion: reservation.leaseVersion,
          reservationId: reservation.id,
        });
      } catch {
        throw new PlatformUsageSharedBudgetError(
          'RESERVATION_FAILED',
          'Platform usage preparation failed and reservation cleanup could not be confirmed.',
        );
      }
    }
    throw error;
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
    completion = await providerCall({
      recordProviderRequestId: async (providerRequestId) => {
        await state.reservationService.recordProviderRequestId({
          leaseVersion: claim.reservation.leaseVersion,
          providerRequestId,
          reservationId: reservation.id,
        });
      },
    });
  } catch (error) {
    // Once provider_started is durable, releasing or retrying can double-spend.
    const providerRequestId = getSafeProviderRequestId(error);
    if (providerRequestId) {
      try {
        await state.reservationService.recordProviderRequestId({
          leaseVersion: claim.reservation.leaseVersion,
          providerRequestId,
          reservationId: reservation.id,
        });
      } catch {
        throw new PlatformUsageSharedBudgetError(
          'PROVIDER_OUTCOME_UNKNOWN',
          'Platform usage provider outcome is unknown. Diagnostic: provider request identity persistence failed.',
        );
      }
    }
    const diagnostic = getSafeProviderDiagnostic(error);
    throw new PlatformUsageSharedBudgetError(
      'PROVIDER_OUTCOME_UNKNOWN',
      `Platform usage provider outcome is unknown.${diagnostic ? ` Diagnostic: ${diagnostic}.` : ''}`,
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
  if (!state.durableBinding && state.operationIds.size > 0) return false;
  if (state.maxCredits === undefined) return true;

  try {
    if (state.durableBinding) {
      // Another worker may still own the waiting supervisor / a sibling member.
      // Its absence from this process's Map is not permission to release the shared hold.
      const [activeSibling] = await state.db
        .select({ id: agentOperations.id })
        .from(agentOperations)
        .where(
          and(
            ne(agentOperations.id, operationId),
            sql`${agentOperations.metadata}->'platformUsageBudget'->>'budgetId' = ${state.budgetId}`,
            notInArray(agentOperations.status, ['done', 'error', 'interrupted']),
          ),
        )
        .limit(1);
      if (activeSibling) {
        // CompletionLifecycle retries after the terminal row is durable. Keep
        // the handle until then: concurrent workers may both still see running rows.
        operationBudgets.set(operationId, handle);
        state.operationIds.add(operationId);
        return false;
      }
    }
    await state.reservationService.completeRequest(state.budgetId!);
    // Durable rows have confirmed these local entries are only stale siblings.
    for (const boundId of state.operationIds) {
      if (operationBudgets.get(boundId) === handle) operationBudgets.delete(boundId);
    }
    state.operationIds.clear();
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
