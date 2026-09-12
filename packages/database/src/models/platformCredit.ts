import { createHash } from 'node:crypto';

import { CREDITS_PER_DOLLAR } from '@lobechat/const/currency';
import { CostExchangeRateSchema } from '@lobechat/types';
import { usdToCredits } from '@lobechat/utils/credits';
import { and, desc, eq, inArray, isNull, like, lte, notInArray, or, sql } from 'drizzle-orm';

import {
  type PlatformCreditAccountItem,
  platformCreditAccounts,
  type PlatformCreditBudgetItem,
  platformCreditBudgets,
  type PlatformCreditBudgetStatus,
  type PlatformCreditCompletionUsage,
  platformCreditEntries,
  type PlatformCreditEntryItem,
  type PlatformCreditEntryType,
  type PlatformCreditReservationCallKind,
  type PlatformCreditReservationItem,
  platformCreditReservations,
  type PlatformCreditTokenUsage,
} from '../schemas/platformCredit';
import type { LobeChatDatabase } from '../type';

export const PLATFORM_CREDIT_INVALID_AMOUNT = 'Credits 必须是安全范围内的整数';
export const PLATFORM_CREDIT_INSUFFICIENT_BALANCE = 'Credits 余额不足';
export const PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT = '幂等键已用于其他 Credits 账务操作';
export const PLATFORM_CREDIT_INVALID_USAGE = '模型用量结算信息无效';
export const PLATFORM_CREDIT_ENTRY_NOT_FOUND = 'Credits 账本流水不存在';
export const PLATFORM_CREDIT_REVERSAL_ALREADY_EXISTS = 'Credits 账本流水已冲正';
export const PLATFORM_CREDIT_REVERSAL_NOT_ALLOWED = '冲正流水不能再次冲正';
export const PLATFORM_CREDIT_RESERVATION_INVALID_OWNER = 'Credits 预留归属无效';
export const PLATFORM_CREDIT_RESERVATION_INVALID_STATE = 'Credits 预留状态无效';
export const PLATFORM_CREDIT_RESERVATION_RELEASE_NOT_ALLOWED = 'Credits 预留状态不允许释放';
export const PLATFORM_CREDIT_RESERVATION_STALE_LEASE = 'Credits 预留租约已失效';
export const PLATFORM_CREDIT_USAGE_EXCEEDS_RESERVATION = '实际用量超过 Credits 预留';
export const PLATFORM_CREDIT_SPONSORED_AUTHORIZATION_UNAVAILABLE =
  'PLATFORM_CREDIT_SPONSORED_AUTHORIZATION_UNAVAILABLE';
export const PLATFORM_CREDIT_METERED_BUDGET_SOURCE_TYPE = 'platform-managed-agent-metered-request';
export const PLATFORM_CREDIT_PREPAID_BUDGET_SOURCE_TYPE = 'platform-managed-agent-prepaid-request';
export const PLATFORM_CREDIT_LEGACY_MANAGED_BUDGET_SOURCE_TYPE = 'platform-managed-agent-request';
export const PLATFORM_CREDIT_MINIMUM_BALANCE = 50_000;
/**
 * How long past its lease a `provider_started` reservation may sit without a
 * completion before it counts as abandoned. Generous on purpose: a slow provider
 * legitimately outlives its lease, and only a call that will never report back
 * should lose its hold.
 */
export const PROVIDER_STARTED_ABANDON_AFTER_MS = 60 * 60 * 1000;

const MAX_TEXT_LENGTH = 500;
const MAX_COST_USD = 1_000_000_000_000_000;
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 200;

const sponsoredBudgetInputFields = [
  'sponsorChatGroupIdSnapshot',
  'sponsorGroupPeriodLimitCreditsSnapshot',
  'sponsorMemberPeriodLimitCreditsSnapshot',
  'sponsorMemberRequestLimitCreditsSnapshot',
  'sponsorMembershipVersionSnapshot',
  'sponsorPeriodEndsAtSnapshot',
  'sponsorPeriodStartedAtSnapshot',
  'sponsorPolicyVersionSnapshot',
] as const;

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
] as const satisfies readonly (keyof PlatformCreditTokenUsage)[];

const tokenFieldSet = new Set<string>([...tokenFields, 'costExchangeRate']);

const normalizeRequiredText = (value: string, field: string, maxLength = MAX_TEXT_LENGTH) => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${field}无效`);
  }
  return normalized;
};

const normalizeOptionalText = (value?: string | null, field = '字段') => {
  if (value === undefined || value === null) return null;
  return normalizeRequiredText(value, field);
};

const normalizeProviderRequestId = (value?: string | null) => {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  if (!/^[A-Z0-9][\w.:/=-]{0,199}$/i.test(normalized)) {
    throw new Error('服务商请求 ID无效');
  }
  return normalized;
};

const assertCredits = (
  credits: number,
  options?: { allowNegative?: boolean; allowZero?: boolean },
) => {
  if (
    !Number.isSafeInteger(credits) ||
    (!options?.allowNegative && credits < 0) ||
    (!options?.allowZero && credits === 0)
  ) {
    throw new Error(PLATFORM_CREDIT_INVALID_AMOUNT);
  }
};

const assertBalance = (balanceCredits: number) => {
  if (!Number.isSafeInteger(balanceCredits)) {
    throw new Error(PLATFORM_CREDIT_INVALID_AMOUNT);
  }
  if (balanceCredits < 0) throw new Error(PLATFORM_CREDIT_INSUFFICIENT_BALANCE);
};

const normalizeCostUsd = (costUsd: number) => {
  if (!Number.isFinite(costUsd) || costUsd < 0 || costUsd >= MAX_COST_USD) {
    throw new Error(PLATFORM_CREDIT_INVALID_USAGE);
  }
  const normalized = Number(costUsd.toFixed(15));
  return Object.is(normalized, -0) ? 0 : normalized;
};

const normalizeListLimit = (limit: number) => {
  if (!Number.isFinite(limit)) return DEFAULT_LIST_LIMIT;
  return Math.max(1, Math.min(MAX_LIST_LIMIT, Math.trunc(limit)));
};

const normalizeExpiry = (value: Date) => {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_STATE);
  }
  return value;
};

const normalizeLeaseVersion = (value: number) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(PLATFORM_CREDIT_RESERVATION_STALE_LEASE);
  }
  return value;
};

const reservationCallKinds = new Set<PlatformCreditReservationCallKind>([
  'call_llm',
  'compress_context',
  'image',
]);

const normalizeCallKind = (value: PlatformCreditReservationCallKind) => {
  if (!reservationCallKinds.has(value)) {
    throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_STATE);
  }
  return value;
};

const normalizeTokenUsage = (usage: PlatformCreditTokenUsage): PlatformCreditTokenUsage => {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    throw new Error(PLATFORM_CREDIT_INVALID_USAGE);
  }
  for (const key of Object.keys(usage)) {
    if (!tokenFieldSet.has(key)) throw new Error(PLATFORM_CREDIT_INVALID_USAGE);
  }

  const normalized: PlatformCreditTokenUsage = {};
  if (usage.costExchangeRate !== undefined) {
    const quote = CostExchangeRateSchema.safeParse(usage.costExchangeRate);
    if (!quote.success) throw new Error(PLATFORM_CREDIT_INVALID_USAGE);
    normalized.costExchangeRate = quote.data;
  }
  for (const field of tokenFields) {
    const value = usage[field];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(PLATFORM_CREDIT_INVALID_USAGE);
    }
    normalized[field] = value;
  }
  return normalized as PlatformCreditTokenUsage;
};

const ensureAccount = async (
  db: LobeChatDatabase,
  userId: string,
  lock = false,
): Promise<PlatformCreditAccountItem> => {
  const normalizedUserId = normalizeRequiredText(userId, '用户 ID', 255);
  await db
    .insert(platformCreditAccounts)
    .values({ userId: normalizedUserId, userIdSnapshot: normalizedUserId })
    .onConflictDoNothing({ target: platformCreditAccounts.userIdSnapshot });

  const query = db
    .select()
    .from(platformCreditAccounts)
    .where(eq(platformCreditAccounts.userIdSnapshot, normalizedUserId))
    .limit(1);
  const [account] = lock ? await query.for('update') : await query;
  if (!account) throw new Error('无法创建 Credits 账户');
  return account;
};

const findEntryByKey = async (db: LobeChatDatabase, accountId: string, idempotencyKey: string) => {
  const [entry] = await db
    .select()
    .from(platformCreditEntries)
    .where(
      and(
        eq(platformCreditEntries.accountId, accountId),
        eq(platformCreditEntries.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return entry;
};

const activeBudgetHeldCredits = async (db: LobeChatDatabase, accountId: string) => {
  const [legacy] = await db
    .select({
      heldCredits:
        sql<number>`coalesce(sum(${platformCreditBudgets.authorizedCredits} - ${platformCreditBudgets.consumedCredits}), 0)`.mapWith(
          Number,
        ),
    })
    .from(platformCreditBudgets)
    .where(
      and(
        eq(platformCreditBudgets.accountId, accountId),
        eq(platformCreditBudgets.status, 'active'),
        notInArray(platformCreditBudgets.sourceType, [
          PLATFORM_CREDIT_LEGACY_MANAGED_BUDGET_SOURCE_TYPE,
          PLATFORM_CREDIT_METERED_BUDGET_SOURCE_TYPE,
        ]),
      ),
    );
  const [metered] = await db
    .select({
      heldCredits:
        sql<number>`coalesce(sum(${platformCreditReservations.reservedCredits}), 0)`.mapWith(
          Number,
        ),
    })
    .from(platformCreditReservations)
    .innerJoin(
      platformCreditBudgets,
      and(
        eq(platformCreditBudgets.id, platformCreditReservations.budgetId),
        eq(platformCreditBudgets.accountId, accountId),
        eq(platformCreditBudgets.status, 'active'),
        eq(platformCreditBudgets.sourceType, PLATFORM_CREDIT_METERED_BUDGET_SOURCE_TYPE),
      ),
    )
    .where(
      inArray(platformCreditReservations.status, [
        'reserved',
        'provider_started',
        'provider_completed',
      ]),
    );
  const heldCredits = (legacy?.heldCredits ?? 0) + (metered?.heldCredits ?? 0);
  assertCredits(heldCredits, { allowZero: true });
  return heldCredits;
};

const assertBalanceCoversHolds = (balanceCredits: number, heldCredits: number) => {
  assertBalance(balanceCredits);
  if (balanceCredits < heldCredits) throw new Error(PLATFORM_CREDIT_INSUFFICIENT_BALANCE);
};

const assertSelfBudgetInput = (input: ReservePlatformCreditBudgetInput, payerUserId: string) => {
  const candidate = input as unknown as Record<string, unknown>;
  if (
    (candidate.actorUserId !== undefined && candidate.actorUserId !== payerUserId) ||
    (candidate.authorizationKind !== undefined && candidate.authorizationKind !== 'self') ||
    sponsoredBudgetInputFields.some((field) => Object.hasOwn(candidate, field))
  ) {
    throw new Error(PLATFORM_CREDIT_SPONSORED_AUTHORIZATION_UNAVAILABLE);
  }
};

const isSelfAuthorizationBudget = (budget: PlatformCreditBudgetItem, payerUserId: string) =>
  budget.authorizationKind === 'self' &&
  budget.actorUserIdSnapshot === payerUserId &&
  budget.userIdSnapshot === payerUserId &&
  sponsoredBudgetInputFields.every((field) => budget[field] === null);

const sameTokenUsage = (left: PlatformCreditTokenUsage | null, right: PlatformCreditTokenUsage) => {
  const leftValue = left ?? {};
  if (Object.keys(leftValue).length !== Object.keys(right).length) return false;
  return (
    tokenFields.every((field) => leftValue[field] === right[field]) &&
    leftValue.costExchangeRate?.rate === right.costExchangeRate?.rate &&
    leftValue.costExchangeRate?.rateDate === right.costExchangeRate?.rateDate &&
    leftValue.costExchangeRate?.updatedAt === right.costExchangeRate?.updatedAt
  );
};

const sameCompletionUsage = (
  left: PlatformCreditCompletionUsage | null,
  costUsd: number,
  tokenUsage: PlatformCreditTokenUsage,
) => {
  if (!left || left.cost !== costUsd) return false;
  const { cost: _cost, ...leftTokenUsage } = left;
  return sameTokenUsage(leftTokenUsage, tokenUsage);
};

const sameUsageEntry = (
  existing: PlatformCreditEntryItem,
  input: ChargePlatformUsageInput,
  normalized: {
    actorUserId: string;
    costUsd: number;
    generationId: string;
    generationType: string | null;
    idempotencyKey: string;
    model: string;
    provider: string;
    tokenUsage: PlatformCreditTokenUsage;
    workspaceId: string | null;
  },
) =>
  existing.type === 'usage_charge' &&
  existing.actorUserIdSnapshot === normalized.actorUserId &&
  existing.costUsd === normalized.costUsd &&
  // Replay the historical amount only; all new writes still require usdToCredits.
  // The legacy binary multiplication could add one credit to an exact decimal cost.
  (existing.amountCredits === -input.credits ||
    existing.amountCredits === -Math.ceil(normalized.costUsd * CREDITS_PER_DOLLAR)) &&
  existing.generationId === normalized.generationId &&
  existing.generationType === normalized.generationType &&
  existing.idempotencyKey === normalized.idempotencyKey &&
  existing.model === normalized.model &&
  existing.provider === normalized.provider &&
  existing.workspaceId === normalized.workspaceId &&
  sameTokenUsage(existing.tokenUsage, normalized.tokenUsage);

const normalizeUsageCharge = (userId: string, input: ChargePlatformUsageInput) => {
  assertCredits(input.credits, { allowZero: true });
  const actorUserId = normalizeRequiredText(input.actorUserId, '执行用户 ID', 255);
  if (actorUserId !== userId) throw new Error(PLATFORM_CREDIT_INVALID_USAGE);
  const costUsd = normalizeCostUsd(input.costUsd);
  if (input.credits !== usdToCredits(costUsd)) {
    throw new Error(PLATFORM_CREDIT_INVALID_USAGE);
  }
  return {
    actorUserId,
    costUsd,
    generationId: normalizeRequiredText(input.generationId, '生成记录 ID'),
    generationType: normalizeOptionalText(input.generationType, '生成类型'),
    idempotencyKey: normalizeRequiredText(input.idempotencyKey, '幂等键', 200),
    model: normalizeRequiredText(input.model, '模型'),
    provider: normalizeRequiredText(input.provider, '模型服务商'),
    tokenUsage: normalizeTokenUsage(input.tokenUsage),
    workspaceId: normalizeOptionalText(input.workspaceId, '工作区 ID'),
  };
};

export interface ChargePlatformUsageInput {
  actorUserId: string;
  costUsd: number;
  credits: number;
  generationId: string;
  generationType?: string | null;
  idempotencyKey: string;
  model: string;
  provider: string;
  tokenUsage: PlatformCreditTokenUsage;
  workspaceId?: string | null;
}

export interface ReservePlatformCreditBudgetInput {
  authorizedCredits: number;
  expiresAt: Date;
  idempotencyKey: string;
  requestHash: string;
  sourceId: string;
  sourceType: string;
  workspaceId?: string | null;
}

export interface GetPlatformCreditBudgetBySourceInput {
  sourceId: string;
  sourceType: string;
  workspaceId?: string | null;
}

export interface PlatformCreditBudgetBySourceResult {
  budget: PlatformCreditBudgetItem;
  lifecycle: PlatformCreditBudgetStatus | 'expired_active';
}

export interface ReservePlatformCreditCallInput {
  budgetId: string;
  callKind: PlatformCreditReservationCallKind;
  expiresAt: Date;
  generationId: string;
  generationType?: string | null;
  idempotencyKey: string;
  model: string;
  provider: string;
  reservedCredits: number;
  workspaceId?: string | null;
}

export interface ReserveRemainingPlatformCreditCallInput extends Omit<
  ReservePlatformCreditCallInput,
  'reservedCredits'
> {
  budgetLeaseVersion: number;
  requestHash: string;
  reservedCredits?: number;
}

export interface RecordPlatformProviderCompletionInput {
  costUsd: number;
  credits: number;
  leaseVersion: number;
  providerRequestId?: string | null;
  reservationId: string;
  tokenUsage: PlatformCreditTokenUsage;
}

export interface RecordPlatformProviderRequestIdInput extends ReleasePlatformCreditReservationInput {
  providerRequestId: string;
}

export interface SettleReservedPlatformUsageInput extends ChargePlatformUsageInput {
  leaseVersion: number;
  reservationId: string;
}

export interface ReleasePlatformCreditReservationInput {
  leaseVersion: number;
  reservationId: string;
}

export interface RenewPlatformCreditReservationLeaseInput extends ReleasePlatformCreditReservationInput {
  expiresAt: Date;
}

export interface ClaimPlatformCreditReservationResult {
  reservation: PlatformCreditReservationItem;
  /** Only the transaction that moved reserved -> provider_started may call the provider. */
  shouldCallProvider: boolean;
}

const lockOwnedReservationContext = async (
  db: LobeChatDatabase,
  userId: string,
  accountId: string,
  reservationId: string,
): Promise<{ budget: PlatformCreditBudgetItem; reservation: PlatformCreditReservationItem }> => {
  const [locator] = await db
    .select({ budgetId: platformCreditReservations.budgetId })
    .from(platformCreditReservations)
    .where(
      and(
        eq(platformCreditReservations.id, reservationId),
        eq(platformCreditReservations.accountId, accountId),
      ),
    )
    .limit(1);
  if (!locator) throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_OWNER);

  const [budget] = await db
    .select()
    .from(platformCreditBudgets)
    .where(
      and(
        eq(platformCreditBudgets.id, locator.budgetId),
        eq(platformCreditBudgets.accountId, accountId),
        eq(platformCreditBudgets.userIdSnapshot, userId),
      ),
    )
    .limit(1)
    .for('update');
  if (!budget) throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_OWNER);

  const [reservation] = await db
    .select()
    .from(platformCreditReservations)
    .where(
      and(
        eq(platformCreditReservations.id, reservationId),
        eq(platformCreditReservations.budgetId, budget.id),
        eq(platformCreditReservations.accountId, accountId),
      ),
    )
    .limit(1)
    .for('update');
  if (!reservation) throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_OWNER);
  return { budget, reservation };
};

export class PlatformCreditModel {
  constructor(
    protected readonly db: LobeChatDatabase,
    protected readonly userId: string,
  ) {}

  getAccount = () => ensureAccount(this.db, this.userId);

  listEntries = (limit = 100) =>
    this.db
      .select()
      .from(platformCreditEntries)
      .where(eq(platformCreditEntries.userIdSnapshot, this.userId))
      .orderBy(desc(platformCreditEntries.createdAt), desc(platformCreditEntries.id))
      .limit(normalizeListLimit(limit));

  getAccountWithAvailability = () =>
    this.db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const account = await ensureAccount(transaction, this.userId, true);
      const now = new Date(Date.now());
      const expiredBudgets = await transaction
        .select({ id: platformCreditBudgets.id })
        .from(platformCreditBudgets)
        .where(
          and(
            eq(platformCreditBudgets.accountId, account.id),
            eq(platformCreditBudgets.status, 'active'),
            lte(platformCreditBudgets.expiresAt, now),
          ),
        );
      if (expiredBudgets.length > 0) {
        const budgetIds = expiredBudgets.map(({ id }) => id);
        await transaction
          .update(platformCreditReservations)
          .set({ status: 'expired', updatedAt: now })
          .where(
            and(
              eq(platformCreditReservations.accountId, account.id),
              inArray(platformCreditReservations.budgetId, budgetIds),
              eq(platformCreditReservations.status, 'reserved'),
              lte(platformCreditReservations.expiresAt, now),
            ),
          );
        const activeCalls = await transaction
          .select({ budgetId: platformCreditReservations.budgetId })
          .from(platformCreditReservations)
          .where(
            and(
              eq(platformCreditReservations.accountId, account.id),
              inArray(platformCreditReservations.budgetId, budgetIds),
              inArray(platformCreditReservations.status, [
                'reserved',
                'provider_started',
                'provider_completed',
              ]),
            ),
          );
        const activeBudgetIds = new Set(activeCalls.map(({ budgetId }) => budgetId));
        const releasableBudgetIds = budgetIds.filter((id) => !activeBudgetIds.has(id));
        if (releasableBudgetIds.length > 0) {
          await transaction
            .update(platformCreditBudgets)
            .set({ status: 'expired', updatedAt: now })
            .where(
              and(
                eq(platformCreditBudgets.accountId, account.id),
                eq(platformCreditBudgets.status, 'active'),
                inArray(platformCreditBudgets.id, releasableBudgetIds),
              ),
            );
        }
      }
      const heldCredits = await activeBudgetHeldCredits(transaction, account.id);
      assertBalanceCoversHolds(account.balanceCredits, heldCredits);
      return {
        availableCredits: account.balanceCredits - heldCredits,
        balanceCredits: account.balanceCredits,
        heldCredits,
        updatedAt: account.updatedAt,
      };
    });

  getAvailableCredits = async () => {
    const { updatedAt: _updatedAt, ...credits } = await this.getAccountWithAvailability();
    return credits;
  };

  async getBudgetBySource(
    input: GetPlatformCreditBudgetBySourceInput,
  ): Promise<PlatformCreditBudgetBySourceResult | undefined> {
    const sourceId = normalizeRequiredText(input.sourceId, '来源 ID');
    const sourceType = normalizeRequiredText(input.sourceType, '来源类型');
    const workspaceId = normalizeOptionalText(input.workspaceId, '工作区 ID');
    const account = await ensureAccount(this.db, this.userId);
    const [budget] = await this.db
      .select()
      .from(platformCreditBudgets)
      .where(
        and(
          eq(platformCreditBudgets.accountId, account.id),
          eq(platformCreditBudgets.userIdSnapshot, this.userId),
          eq(platformCreditBudgets.sourceType, sourceType),
          eq(platformCreditBudgets.sourceId, sourceId),
          workspaceId === null
            ? isNull(platformCreditBudgets.workspaceId)
            : eq(platformCreditBudgets.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!budget) return undefined;

    return {
      budget,
      lifecycle:
        budget.status === 'active' && budget.expiresAt.getTime() <= Date.now()
          ? 'expired_active'
          : budget.status,
    };
  }

  async reserveBudget(input: ReservePlatformCreditBudgetInput): Promise<PlatformCreditBudgetItem> {
    assertSelfBudgetInput(input, this.userId);
    assertCredits(input.authorizedCredits);
    const expiresAt = normalizeExpiry(input.expiresAt);
    const idempotencyKey = normalizeRequiredText(input.idempotencyKey, '幂等键', 200);
    const requestHash = normalizeRequiredText(input.requestHash, '请求哈希');
    const sourceId = normalizeRequiredText(input.sourceId, '来源 ID');
    const sourceType = normalizeRequiredText(input.sourceType, '来源类型');
    const workspaceId = normalizeOptionalText(input.workspaceId, '工作区 ID');

    return this.db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const account = await ensureAccount(transaction, this.userId, true);
      const [existing] = await transaction
        .select()
        .from(platformCreditBudgets)
        .where(
          and(
            eq(platformCreditBudgets.accountId, account.id),
            eq(platformCreditBudgets.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1)
        .for('update');
      if (existing) {
        if (
          !isSelfAuthorizationBudget(existing, this.userId) ||
          existing.workspaceId !== workspaceId ||
          existing.sourceType !== sourceType ||
          existing.sourceId !== sourceId ||
          existing.requestHash !== requestHash ||
          existing.authorizedCredits !== input.authorizedCredits
        ) {
          throw new Error(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);
        }
        return existing;
      }
      const [existingBySource] = await transaction
        .select({ id: platformCreditBudgets.id })
        .from(platformCreditBudgets)
        .where(
          and(
            eq(platformCreditBudgets.accountId, account.id),
            eq(platformCreditBudgets.sourceType, sourceType),
            eq(platformCreditBudgets.sourceId, sourceId),
          ),
        )
        .limit(1)
        .for('update');
      if (existingBySource) throw new Error(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);
      if (expiresAt.getTime() <= Date.now()) {
        throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_STATE);
      }

      const metered = sourceType === PLATFORM_CREDIT_METERED_BUDGET_SOURCE_TYPE;
      const heldCredits = await activeBudgetHeldCredits(transaction, account.id);
      assertBalanceCoversHolds(
        account.balanceCredits,
        heldCredits + (metered ? PLATFORM_CREDIT_MINIMUM_BALANCE : input.authorizedCredits),
      );
      const [budget] = await transaction
        .insert(platformCreditBudgets)
        .values({
          accountId: account.id,
          actorUserId: this.userId,
          actorUserIdSnapshot: this.userId,
          authorizationKind: 'self',
          authorizedCredits: input.authorizedCredits,
          consumedCredits: 0,
          expiresAt,
          idempotencyKey,
          leaseVersion: 1,
          requestHash,
          sourceId,
          sourceType,
          status: 'active',
          userId: this.userId,
          userIdSnapshot: this.userId,
          workspaceId,
        })
        .returning();
      return budget;
    });
  }

  async reserveCall(input: ReservePlatformCreditCallInput): Promise<PlatformCreditReservationItem> {
    assertCredits(input.reservedCredits);
    const budgetId = normalizeRequiredText(input.budgetId, '预算 ID');
    const callKind = normalizeCallKind(input.callKind);
    const expiresAt = normalizeExpiry(input.expiresAt);
    const generationId = normalizeRequiredText(input.generationId, '生成记录 ID');
    const generationType = normalizeOptionalText(input.generationType, '生成类型');
    const idempotencyKey = normalizeRequiredText(input.idempotencyKey, '幂等键', 200);
    const model = normalizeRequiredText(input.model, '模型');
    const provider = normalizeRequiredText(input.provider, '模型服务商');
    const workspaceId = normalizeOptionalText(input.workspaceId, '工作区 ID');

    return this.db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const account = await ensureAccount(transaction, this.userId, true);
      const [budget] = await transaction
        .select()
        .from(platformCreditBudgets)
        .where(
          and(
            eq(platformCreditBudgets.id, budgetId),
            eq(platformCreditBudgets.accountId, account.id),
            eq(platformCreditBudgets.userIdSnapshot, this.userId),
          ),
        )
        .limit(1)
        .for('update');
      if (!budget || budget.workspaceId !== workspaceId) {
        throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_OWNER);
      }
      if (!isSelfAuthorizationBudget(budget, this.userId)) {
        throw new Error(PLATFORM_CREDIT_SPONSORED_AUTHORIZATION_UNAVAILABLE);
      }
      const [existing] = await transaction
        .select()
        .from(platformCreditReservations)
        .where(
          and(
            eq(platformCreditReservations.accountId, account.id),
            eq(platformCreditReservations.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1)
        .for('update');
      if (existing) {
        if (
          existing.budgetId !== budget.id ||
          existing.callKind !== callKind ||
          existing.generationId !== generationId ||
          existing.generationType !== generationType ||
          existing.model !== model ||
          existing.provider !== provider ||
          existing.reservedCredits !== input.reservedCredits ||
          existing.workspaceId !== workspaceId
        ) {
          throw new Error(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);
        }
        return existing;
      }
      if (
        budget.status !== 'active' ||
        budget.expiresAt.getTime() <= Date.now() ||
        expiresAt.getTime() <= Date.now()
      ) {
        throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_STATE);
      }

      const [allocation] = await transaction
        .select({
          allocatedCredits:
            sql<number>`coalesce(sum(${platformCreditReservations.reservedCredits}), 0)`.mapWith(
              Number,
            ),
        })
        .from(platformCreditReservations)
        .where(
          and(
            eq(platformCreditReservations.budgetId, budget.id),
            inArray(platformCreditReservations.status, [
              'reserved',
              'provider_started',
              'provider_completed',
            ]),
          ),
        );
      const allocatedCredits = allocation?.allocatedCredits ?? 0;
      assertCredits(allocatedCredits, { allowZero: true });
      if (
        budget.consumedCredits + allocatedCredits + input.reservedCredits >
        budget.authorizedCredits
      ) {
        throw new Error(PLATFORM_CREDIT_INSUFFICIENT_BALANCE);
      }

      const [reservation] = await transaction
        .insert(platformCreditReservations)
        .values({
          accountId: account.id,
          budgetId: budget.id,
          callKind,
          expiresAt,
          generationId,
          generationType,
          idempotencyKey,
          leaseVersion: 1,
          model,
          provider,
          reservedCredits: input.reservedCredits,
          settledCredits: 0,
          status: 'reserved',
          workspaceId,
        })
        .returning();
      return reservation;
    });
  }

  async reserveRemainingCall(
    input: ReserveRemainingPlatformCreditCallInput,
  ): Promise<PlatformCreditReservationItem> {
    const budgetId = normalizeRequiredText(input.budgetId, '预算 ID');
    const budgetLeaseVersion = normalizeLeaseVersion(input.budgetLeaseVersion);
    const callKind = normalizeCallKind(input.callKind);
    const expiresAt = normalizeExpiry(input.expiresAt);
    const generationId = normalizeRequiredText(input.generationId, '生成记录 ID');
    const generationType = normalizeOptionalText(input.generationType, '生成类型');
    const logicalIdempotencyKey = normalizeRequiredText(input.idempotencyKey, '幂等键', 200);
    const requestHash = normalizeRequiredText(input.requestHash, '请求摘要');
    const idempotencyScope = createHash('sha256').update(logicalIdempotencyKey).digest('hex');
    const requestDigest = createHash('sha256').update(requestHash).digest('hex');
    const idempotencyPrefix = `remaining-call:v1:${idempotencyScope}:`;
    const idempotencyKey = `${idempotencyPrefix}${requestDigest}`;
    const model = normalizeRequiredText(input.model, '模型');
    const provider = normalizeRequiredText(input.provider, '模型服务商');
    const workspaceId = normalizeOptionalText(input.workspaceId, '工作区 ID');

    return this.db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const account = await ensureAccount(transaction, this.userId, true);
      const [budget] = await transaction
        .select()
        .from(platformCreditBudgets)
        .where(
          and(
            eq(platformCreditBudgets.id, budgetId),
            eq(platformCreditBudgets.accountId, account.id),
            eq(platformCreditBudgets.userIdSnapshot, this.userId),
          ),
        )
        .limit(1)
        .for('update');
      if (!budget || budget.workspaceId !== workspaceId) {
        throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_OWNER);
      }
      if (!isSelfAuthorizationBudget(budget, this.userId)) {
        throw new Error(PLATFORM_CREDIT_SPONSORED_AUTHORIZATION_UNAVAILABLE);
      }
      const [existing] = await transaction
        .select()
        .from(platformCreditReservations)
        .where(
          and(
            eq(platformCreditReservations.accountId, account.id),
            or(
              like(platformCreditReservations.idempotencyKey, `${idempotencyPrefix}%`),
              and(
                eq(platformCreditReservations.callKind, callKind),
                eq(platformCreditReservations.generationId, generationId),
              ),
            ),
          ),
        )
        .limit(1)
        .for('update');
      if (existing) {
        if (
          existing.budgetId !== budget.id ||
          existing.callKind !== callKind ||
          existing.generationId !== generationId ||
          existing.generationType !== generationType ||
          existing.idempotencyKey !== idempotencyKey ||
          existing.model !== model ||
          existing.provider !== provider ||
          existing.workspaceId !== workspaceId
        ) {
          throw new Error(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);
        }
        return existing;
      }
      if (budget.leaseVersion !== budgetLeaseVersion) {
        throw new Error(PLATFORM_CREDIT_RESERVATION_STALE_LEASE);
      }
      if (
        budget.status !== 'active' ||
        budget.expiresAt.getTime() <= Date.now() ||
        expiresAt.getTime() <= Date.now() ||
        expiresAt.getTime() > budget.expiresAt.getTime()
      ) {
        throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_STATE);
      }

      const [allocation] = await transaction
        .select({
          allocatedCredits:
            sql<number>`coalesce(sum(${platformCreditReservations.reservedCredits}), 0)`.mapWith(
              Number,
            ),
        })
        .from(platformCreditReservations)
        .where(
          and(
            eq(platformCreditReservations.budgetId, budget.id),
            inArray(platformCreditReservations.status, [
              'reserved',
              'provider_started',
              'provider_completed',
            ]),
          ),
        );
      const allocatedCredits = allocation?.allocatedCredits ?? 0;
      assertCredits(allocatedCredits, { allowZero: true });
      const remainingCredits = budget.authorizedCredits - budget.consumedCredits - allocatedCredits;
      const metered = budget.sourceType === PLATFORM_CREDIT_METERED_BUDGET_SOURCE_TYPE;
      if (metered) assertCredits(input.reservedCredits as number);
      const reservedCredits = metered
        ? Math.min(input.reservedCredits as number, remainingCredits)
        : remainingCredits;
      if (reservedCredits <= 0) throw new Error(PLATFORM_CREDIT_INSUFFICIENT_BALANCE);
      assertCredits(reservedCredits);
      if (metered) {
        const heldCredits = await activeBudgetHeldCredits(transaction, account.id);
        assertBalanceCoversHolds(
          account.balanceCredits,
          heldCredits + reservedCredits + PLATFORM_CREDIT_MINIMUM_BALANCE,
        );
      }

      const [reservation] = await transaction
        .insert(platformCreditReservations)
        .values({
          accountId: account.id,
          budgetId: budget.id,
          callKind,
          expiresAt,
          generationId,
          generationType,
          idempotencyKey,
          leaseVersion: 1,
          model,
          provider,
          reservedCredits,
          settledCredits: 0,
          status: 'reserved',
          workspaceId,
        })
        .returning();
      return reservation;
    });
  }

  async getReservation(id: string): Promise<PlatformCreditReservationItem | undefined> {
    const reservationId = normalizeRequiredText(id, '预留 ID');
    const account = await ensureAccount(this.db, this.userId);
    const [reservation] = await this.db
      .select()
      .from(platformCreditReservations)
      .where(
        and(
          eq(platformCreditReservations.id, reservationId),
          eq(platformCreditReservations.accountId, account.id),
        ),
      )
      .limit(1);
    return reservation;
  }

  async claimReservationForProvider(
    input: ReleasePlatformCreditReservationInput,
  ): Promise<ClaimPlatformCreditReservationResult> {
    const reservationId = normalizeRequiredText(input.reservationId, '预留 ID');
    const leaseVersion = normalizeLeaseVersion(input.leaseVersion);
    return this.db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const account = await ensureAccount(transaction, this.userId, true);
      const { budget, reservation } = await lockOwnedReservationContext(
        transaction,
        this.userId,
        account.id,
        reservationId,
      );
      if (!isSelfAuthorizationBudget(budget, this.userId)) {
        throw new Error(PLATFORM_CREDIT_SPONSORED_AUTHORIZATION_UNAVAILABLE);
      }
      if (reservation.leaseVersion !== leaseVersion) {
        throw new Error(PLATFORM_CREDIT_RESERVATION_STALE_LEASE);
      }
      if (
        reservation.status === 'provider_started' ||
        reservation.status === 'provider_completed' ||
        reservation.status === 'settled'
      ) {
        return { reservation, shouldCallProvider: false };
      }
      if (
        reservation.status !== 'reserved' ||
        budget.status !== 'active' ||
        budget.expiresAt.getTime() <= Date.now() ||
        reservation.expiresAt.getTime() <= Date.now()
      ) {
        throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_STATE);
      }
      const [claimed] = await transaction
        .update(platformCreditReservations)
        .set({ status: 'provider_started', updatedAt: new Date() })
        .where(eq(platformCreditReservations.id, reservation.id))
        .returning();
      return { reservation: claimed, shouldCallProvider: true };
    });
  }

  async recordProviderCompletion(
    input: RecordPlatformProviderCompletionInput,
  ): Promise<PlatformCreditReservationItem> {
    const reservationId = normalizeRequiredText(input.reservationId, '预留 ID');
    const leaseVersion = normalizeLeaseVersion(input.leaseVersion);
    assertCredits(input.credits, { allowZero: true });
    const costUsd = normalizeCostUsd(input.costUsd);
    if (input.credits !== usdToCredits(costUsd)) {
      throw new Error(PLATFORM_CREDIT_INVALID_USAGE);
    }
    const providerRequestId = normalizeProviderRequestId(input.providerRequestId);
    const tokenUsage = normalizeTokenUsage(input.tokenUsage);
    const actualUsage: PlatformCreditCompletionUsage = { cost: costUsd, ...tokenUsage };

    return this.db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const account = await ensureAccount(transaction, this.userId, true);
      const { reservation } = await lockOwnedReservationContext(
        transaction,
        this.userId,
        account.id,
        reservationId,
      );
      if (reservation.leaseVersion !== leaseVersion) {
        throw new Error(PLATFORM_CREDIT_RESERVATION_STALE_LEASE);
      }
      if (
        reservation.providerRequestId &&
        providerRequestId &&
        reservation.providerRequestId !== providerRequestId
      ) {
        throw new Error(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);
      }
      const effectiveProviderRequestId = reservation.providerRequestId ?? providerRequestId;
      if (reservation.status === 'provider_completed' || reservation.status === 'settled') {
        if (
          reservation.providerRequestId !== effectiveProviderRequestId ||
          !sameCompletionUsage(reservation.actualUsage, costUsd, tokenUsage)
        ) {
          throw new Error(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);
        }
        return reservation;
      }
      if (reservation.status !== 'provider_started') {
        throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_STATE);
      }
      const [completed] = await transaction
        .update(platformCreditReservations)
        .set({
          actualUsage,
          providerRequestId: effectiveProviderRequestId,
          status: 'provider_completed',
          updatedAt: new Date(),
        })
        .where(eq(platformCreditReservations.id, reservation.id))
        .returning();
      return completed;
    });
  }

  async recordProviderRequestId(
    input: RecordPlatformProviderRequestIdInput,
  ): Promise<PlatformCreditReservationItem> {
    const reservationId = normalizeRequiredText(input.reservationId, '预留 ID');
    const leaseVersion = normalizeLeaseVersion(input.leaseVersion);
    const providerRequestId = normalizeProviderRequestId(input.providerRequestId)!;

    return this.db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const account = await ensureAccount(transaction, this.userId, true);
      const { reservation } = await lockOwnedReservationContext(
        transaction,
        this.userId,
        account.id,
        reservationId,
      );
      if (reservation.leaseVersion !== leaseVersion) {
        throw new Error(PLATFORM_CREDIT_RESERVATION_STALE_LEASE);
      }
      if (reservation.providerRequestId) {
        if (reservation.providerRequestId !== providerRequestId) {
          throw new Error(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);
        }
        return reservation;
      }
      if (reservation.status !== 'provider_started') {
        throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_STATE);
      }
      const [updated] = await transaction
        .update(platformCreditReservations)
        .set({ providerRequestId, updatedAt: new Date() })
        .where(eq(platformCreditReservations.id, reservation.id))
        .returning();
      return updated;
    });
  }

  async renewReservationLease(
    input: RenewPlatformCreditReservationLeaseInput,
  ): Promise<PlatformCreditReservationItem> {
    const reservationId = normalizeRequiredText(input.reservationId, '预留 ID');
    const leaseVersion = normalizeLeaseVersion(input.leaseVersion);
    const expiresAt = normalizeExpiry(input.expiresAt);
    if (expiresAt.getTime() <= Date.now()) {
      throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_STATE);
    }
    return this.db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const account = await ensureAccount(transaction, this.userId, true);
      const { reservation } = await lockOwnedReservationContext(
        transaction,
        this.userId,
        account.id,
        reservationId,
      );
      if (reservation.leaseVersion !== leaseVersion) {
        throw new Error(PLATFORM_CREDIT_RESERVATION_STALE_LEASE);
      }
      if (reservation.status !== 'reserved') {
        throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_STATE);
      }
      const nextLeaseVersion = reservation.leaseVersion + 1;
      normalizeLeaseVersion(nextLeaseVersion);
      const [renewed] = await transaction
        .update(platformCreditReservations)
        .set({ expiresAt, leaseVersion: nextLeaseVersion, updatedAt: new Date() })
        .where(eq(platformCreditReservations.id, reservation.id))
        .returning();
      return renewed;
    });
  }

  async releaseReservation(
    input: ReleasePlatformCreditReservationInput,
  ): Promise<PlatformCreditReservationItem> {
    const reservationId = normalizeRequiredText(input.reservationId, '预留 ID');
    const leaseVersion = normalizeLeaseVersion(input.leaseVersion);
    return this.db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const account = await ensureAccount(transaction, this.userId, true);
      const { reservation } = await lockOwnedReservationContext(
        transaction,
        this.userId,
        account.id,
        reservationId,
      );
      if (reservation.leaseVersion !== leaseVersion) {
        throw new Error(PLATFORM_CREDIT_RESERVATION_STALE_LEASE);
      }
      if (reservation.status === 'released') return reservation;
      if (reservation.status !== 'reserved') {
        throw new Error(PLATFORM_CREDIT_RESERVATION_RELEASE_NOT_ALLOWED);
      }
      const [released] = await transaction
        .update(platformCreditReservations)
        .set({ status: 'released', updatedAt: new Date() })
        .where(eq(platformCreditReservations.id, reservation.id))
        .returning();
      return released;
    });
  }

  async reapExpiredBudget(id: string): Promise<PlatformCreditBudgetItem> {
    const budgetId = normalizeRequiredText(id, '预算 ID');
    return this.db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const account = await ensureAccount(transaction, this.userId, true);
      const [budget] = await transaction
        .select()
        .from(platformCreditBudgets)
        .where(
          and(
            eq(platformCreditBudgets.id, budgetId),
            eq(platformCreditBudgets.accountId, account.id),
            eq(platformCreditBudgets.userIdSnapshot, this.userId),
          ),
        )
        .limit(1)
        .for('update');
      if (!budget) throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_OWNER);
      if (budget.status !== 'active') return budget;

      const now = new Date(Date.now());
      await transaction
        .update(platformCreditReservations)
        .set({ status: 'expired', updatedAt: now })
        .where(
          and(
            eq(platformCreditReservations.budgetId, budget.id),
            eq(platformCreditReservations.accountId, account.id),
            eq(platformCreditReservations.status, 'reserved'),
            lte(platformCreditReservations.expiresAt, now),
          ),
        );

      const [activeCalls] = await transaction
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(platformCreditReservations)
        .where(
          and(
            eq(platformCreditReservations.budgetId, budget.id),
            eq(platformCreditReservations.accountId, account.id),
            inArray(platformCreditReservations.status, [
              'reserved',
              'provider_started',
              'provider_completed',
            ]),
          ),
        );
      if (budget.expiresAt.getTime() > now.getTime() || (activeCalls?.count ?? 0) > 0) {
        return budget;
      }

      const [expired] = await transaction
        .update(platformCreditBudgets)
        .set({ status: 'expired', updatedAt: now })
        .where(eq(platformCreditBudgets.id, budget.id))
        .returning();
      return expired;
    });
  }

  /**
   * Budgets whose lease expired with a hold still unclaimed.
   *
   * A `reserved` reservation past its lease is *not* the abandoned-call case
   * {@link reapAbandonedProviderReservations} handles — that one reached the
   * provider. This is a hold whose owner never came back, and while it sits there
   * it counts as a live call, so the budget can never expire.
   * {@link reapExpiredBudget} expires exactly those holds and the budget with them,
   * but it is per-budget and nothing in the platform drives it — so a stale hold
   * pinned its budget forever. Return the budgets to drive, owner-scoped because
   * the per-budget API works through the owner's account.
   */
  static async findBudgetsWithStaleReservations(
    db: LobeChatDatabase,
    options?: { limit?: number; now?: Date },
  ): Promise<{ id: string; userId: string }[]> {
    const now = options?.now ?? new Date();
    const limit = options?.limit ?? 50;

    const rows = await db
      .select({ id: platformCreditBudgets.id, userId: platformCreditBudgets.userId })
      .from(platformCreditBudgets)
      .where(
        and(
          eq(platformCreditBudgets.status, 'active'),
          lte(platformCreditBudgets.expiresAt, now),
          inArray(
            platformCreditBudgets.id,
            db
              .select({ id: platformCreditReservations.budgetId })
              .from(platformCreditReservations)
              .where(
                and(
                  eq(platformCreditReservations.status, 'reserved'),
                  lte(platformCreditReservations.expiresAt, now),
                ),
              ),
          ),
        ),
      )
      .limit(limit);

    // The per-budget reaper works through the owner's account, so a budget with no
    // owner is not one it can drive. Narrowed here rather than in SQL: the column
    // is nullable and the caller needs the non-null shape.
    return rows.flatMap((row) => (row.userId ? [{ id: row.id, userId: row.userId }] : []));
  }

  /**
   * Release reservations whose provider call started and then vanished.
   *
   * A call that reached the provider is normally settled by the process that made
   * it, and {@link reapExpiredBudget} deliberately counts `provider_started` as a
   * live call. When that process dies — restart, OOM, deploy — no usage ever
   * arrives, so the hold stays pinned and the budget can never expire. Past the
   * lease plus a grace window the call is abandoned and its hold returns to the
   * account, which is exactly what `expired` already means for reservations that
   * were never claimed.
   */
  static async reapAbandonedProviderReservations(
    db: LobeChatDatabase,
    options?: { abandonAfterMs?: number; now?: Date },
  ): Promise<{ budgetIds: string[]; reaped: number }> {
    const now = options?.now ?? new Date();
    const abandonAfterMs = options?.abandonAfterMs ?? PROVIDER_STARTED_ABANDON_AFTER_MS;
    const abandonedBefore = new Date(now.getTime() - abandonAfterMs);

    return db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const reaped = await transaction
        .update(platformCreditReservations)
        .set({ status: 'expired', updatedAt: now })
        .where(
          and(
            eq(platformCreditReservations.status, 'provider_started'),
            lte(platformCreditReservations.expiresAt, abandonedBefore),
          ),
        )
        .returning({ budgetId: platformCreditReservations.budgetId });

      const budgetIds = [...new Set(reaped.map((row) => row.budgetId))];

      for (const budgetId of budgetIds) {
        const [budget] = await transaction
          .select()
          .from(platformCreditBudgets)
          .where(eq(platformCreditBudgets.id, budgetId))
          .limit(1);
        if (!budget || budget.status !== 'active') continue;

        const [activeCalls] = await transaction
          .select({ count: sql`count(*)`.mapWith(Number) })
          .from(platformCreditReservations)
          .where(
            and(
              eq(platformCreditReservations.budgetId, budgetId),
              inArray(platformCreditReservations.status, [
                'provider_completed',
                'provider_started',
                'reserved',
              ]),
            ),
          );
        if (budget.expiresAt.getTime() > now.getTime() || (activeCalls?.count ?? 0) > 0) continue;

        await transaction
          .update(platformCreditBudgets)
          .set({ status: 'expired', updatedAt: now })
          .where(eq(platformCreditBudgets.id, budgetId));
      }

      return { budgetIds, reaped: reaped.length };
    });
  }

  async completeBudget(id: string): Promise<PlatformCreditBudgetItem> {
    const budgetId = normalizeRequiredText(id, '预算 ID');
    return this.db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const account = await ensureAccount(transaction, this.userId, true);
      const [budget] = await transaction
        .select()
        .from(platformCreditBudgets)
        .where(
          and(
            eq(platformCreditBudgets.id, budgetId),
            eq(platformCreditBudgets.accountId, account.id),
            eq(platformCreditBudgets.userIdSnapshot, this.userId),
          ),
        )
        .limit(1)
        .for('update');
      if (!budget) throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_OWNER);
      if (budget.status === 'settled') return budget;
      if (budget.status !== 'active') throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_STATE);

      const [activeCalls] = await transaction
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(platformCreditReservations)
        .where(
          and(
            eq(platformCreditReservations.budgetId, budget.id),
            inArray(platformCreditReservations.status, [
              'reserved',
              'provider_started',
              'provider_completed',
            ]),
          ),
        );
      if ((activeCalls?.count ?? 0) > 0) {
        throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_STATE);
      }
      const [completed] = await transaction
        .update(platformCreditBudgets)
        .set({ status: 'settled', updatedAt: new Date() })
        .where(eq(platformCreditBudgets.id, budget.id))
        .returning();
      return completed;
    });
  }

  async releaseBudget(id: string): Promise<PlatformCreditBudgetItem> {
    const budgetId = normalizeRequiredText(id, '预算 ID');
    return this.db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const account = await ensureAccount(transaction, this.userId, true);
      const [budget] = await transaction
        .select()
        .from(platformCreditBudgets)
        .where(
          and(
            eq(platformCreditBudgets.id, budgetId),
            eq(platformCreditBudgets.accountId, account.id),
            eq(platformCreditBudgets.userIdSnapshot, this.userId),
          ),
        )
        .limit(1)
        .for('update');
      if (!budget) throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_OWNER);
      if (budget.status === 'released') return budget;
      if (budget.status !== 'active') throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_STATE);

      const [activeCalls] = await transaction
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(platformCreditReservations)
        .where(
          and(
            eq(platformCreditReservations.budgetId, budget.id),
            inArray(platformCreditReservations.status, [
              'reserved',
              'provider_started',
              'provider_completed',
            ]),
          ),
        );
      if ((activeCalls?.count ?? 0) > 0) {
        throw new Error(PLATFORM_CREDIT_RESERVATION_RELEASE_NOT_ALLOWED);
      }
      const [released] = await transaction
        .update(platformCreditBudgets)
        .set({ status: 'released', updatedAt: new Date() })
        .where(eq(platformCreditBudgets.id, budget.id))
        .returning();
      return released;
    });
  }

  async settleReservedUsage(
    input: SettleReservedPlatformUsageInput,
  ): Promise<PlatformCreditEntryItem> {
    const reservationId = normalizeRequiredText(input.reservationId, '预留 ID');
    const leaseVersion = normalizeLeaseVersion(input.leaseVersion);
    const normalized = normalizeUsageCharge(this.userId, input);

    return this.db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const account = await ensureAccount(transaction, this.userId, true);
      const { budget, reservation } = await lockOwnedReservationContext(
        transaction,
        this.userId,
        account.id,
        reservationId,
      );
      if (reservation.leaseVersion !== leaseVersion) {
        throw new Error(PLATFORM_CREDIT_RESERVATION_STALE_LEASE);
      }
      if (
        reservation.generationId !== normalized.generationId ||
        reservation.generationType !== normalized.generationType ||
        reservation.model !== normalized.model ||
        reservation.provider !== normalized.provider ||
        reservation.workspaceId !== normalized.workspaceId ||
        budget.workspaceId !== normalized.workspaceId
      ) {
        throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_OWNER);
      }

      if (reservation.status === 'settled') {
        const existing = reservation.usageEntryId
          ? (
              await transaction
                .select()
                .from(platformCreditEntries)
                .where(eq(platformCreditEntries.id, reservation.usageEntryId))
                .limit(1)
            )[0]
          : undefined;
        if (!existing || !sameUsageEntry(existing, input, normalized)) {
          throw new Error(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);
        }
        return existing;
      }
      if (reservation.status !== 'provider_completed' || budget.status !== 'active') {
        throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_STATE);
      }
      if (
        !sameCompletionUsage(reservation.actualUsage, normalized.costUsd, normalized.tokenUsage)
      ) {
        throw new Error(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);
      }
      if (input.credits > reservation.reservedCredits) {
        throw new Error(PLATFORM_CREDIT_USAGE_EXCEEDS_RESERVATION);
      }
      if (budget.consumedCredits + input.credits > budget.authorizedCredits) {
        throw new Error(PLATFORM_CREDIT_USAGE_EXCEEDS_RESERVATION);
      }

      const existingByKey = await findEntryByKey(
        transaction,
        account.id,
        normalized.idempotencyKey,
      );
      if (existingByKey) throw new Error(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);

      const balanceAfterCredits = account.balanceCredits - input.credits;
      const metered = budget.sourceType === PLATFORM_CREDIT_METERED_BUDGET_SOURCE_TYPE;
      const heldCredits = await activeBudgetHeldCredits(transaction, account.id);
      assertBalanceCoversHolds(
        balanceAfterCredits,
        heldCredits - input.credits + (metered ? PLATFORM_CREDIT_MINIMUM_BALANCE : 0),
      );
      const [entry] = await transaction
        .insert(platformCreditEntries)
        .values({
          accountId: account.id,
          actorUserId: normalized.actorUserId,
          actorUserIdSnapshot: normalized.actorUserId,
          amountCredits: -input.credits,
          balanceAfterCredits,
          costUsd: normalized.costUsd,
          generationId: normalized.generationId,
          generationType: normalized.generationType,
          idempotencyKey: normalized.idempotencyKey,
          model: normalized.model,
          provider: normalized.provider,
          reason: `模型用量扣费：${normalized.provider}/${normalized.model}`,
          tokenUsage: normalized.tokenUsage,
          type: 'usage_charge',
          userId: this.userId,
          userIdSnapshot: this.userId,
          workspaceId: normalized.workspaceId,
        })
        .returning();
      await transaction
        .update(platformCreditAccounts)
        .set({ balanceCredits: balanceAfterCredits, updatedAt: new Date() })
        .where(eq(platformCreditAccounts.id, account.id));
      await transaction
        .update(platformCreditBudgets)
        .set({
          consumedCredits: budget.consumedCredits + input.credits,
          updatedAt: new Date(),
        })
        .where(eq(platformCreditBudgets.id, budget.id));
      await transaction
        .update(platformCreditReservations)
        .set({
          settledCredits: input.credits,
          status: 'settled',
          updatedAt: new Date(),
          usageEntryId: entry.id,
        })
        .where(eq(platformCreditReservations.id, reservation.id));
      return entry;
    });
  }

  async chargeUsage(input: ChargePlatformUsageInput): Promise<PlatformCreditEntryItem> {
    const normalized = normalizeUsageCharge(this.userId, input);

    return this.db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const account = await ensureAccount(transaction, this.userId, true);
      const existing = await findEntryByKey(transaction, account.id, normalized.idempotencyKey);
      if (existing) {
        if (!sameUsageEntry(existing, input, normalized)) {
          throw new Error(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);
        }
        return existing;
      }

      const balanceAfterCredits = account.balanceCredits - input.credits;
      const heldCredits = await activeBudgetHeldCredits(transaction, account.id);
      assertBalanceCoversHolds(balanceAfterCredits, heldCredits);
      const reason = `模型用量扣费：${normalized.provider}/${normalized.model}`;
      const [entry] = await transaction
        .insert(platformCreditEntries)
        .values({
          accountId: account.id,
          actorUserId: normalized.actorUserId,
          actorUserIdSnapshot: normalized.actorUserId,
          amountCredits: -input.credits,
          balanceAfterCredits,
          costUsd: normalized.costUsd,
          generationId: normalized.generationId,
          generationType: normalized.generationType,
          idempotencyKey: normalized.idempotencyKey,
          model: normalized.model,
          provider: normalized.provider,
          reason,
          tokenUsage: normalized.tokenUsage,
          type: 'usage_charge',
          userId: this.userId,
          userIdSnapshot: this.userId,
          workspaceId: normalized.workspaceId,
        })
        .returning();
      await transaction
        .update(platformCreditAccounts)
        .set({ balanceCredits: balanceAfterCredits, updatedAt: new Date() })
        .where(eq(platformCreditAccounts.id, account.id));
      return entry;
    });
  }
}

interface PostAdminCreditInput {
  credits: number;
  idempotencyKey: string;
  reason: string;
  targetUserId: string;
}

export interface ReversePlatformCreditInput {
  entryId: string;
  idempotencyKey: string;
  reason: string;
}

export interface PlatformCreditPendingReservationItem {
  actorUserId: string;
  callKind: PlatformCreditReservationCallKind;
  createdAt: Date;
  expiresAt: Date;
  generationId: string;
  generationType: string | null;
  id: string;
  model: string;
  payerUserId: string;
  provider: string;
  providerRequestId: string | null;
  reservedCredits: number;
  settledCredits: number;
  status: Extract<
    PlatformCreditReservationItem['status'],
    'provider_completed' | 'provider_started'
  >;
  updatedAt: Date;
}

export class PlatformCreditAdminModel {
  constructor(
    protected readonly db: LobeChatDatabase,
    protected readonly operatorUserId: string,
  ) {}

  private async postAdminEntry(
    type: Extract<PlatformCreditEntryType, 'adjustment' | 'top_up'>,
    input: PostAdminCreditInput,
  ): Promise<PlatformCreditEntryItem> {
    assertCredits(input.credits, { allowNegative: type === 'adjustment' });
    const idempotencyKey = normalizeRequiredText(input.idempotencyKey, '幂等键', 200);
    const reason = normalizeRequiredText(input.reason, '账务原因');
    const targetUserId = normalizeRequiredText(input.targetUserId, '目标用户 ID', 255);
    const operatorUserId = normalizeRequiredText(this.operatorUserId, '管理员用户 ID', 255);

    return this.db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const account = await ensureAccount(transaction, targetUserId, true);
      const existing = await findEntryByKey(transaction, account.id, idempotencyKey);
      if (existing) {
        if (
          existing.type !== type ||
          existing.amountCredits !== input.credits ||
          existing.reason !== reason ||
          existing.operatorUserId !== operatorUserId
        ) {
          throw new Error(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);
        }
        return existing;
      }

      const balanceAfterCredits = account.balanceCredits + input.credits;
      const heldCredits = await activeBudgetHeldCredits(transaction, account.id);
      assertBalanceCoversHolds(balanceAfterCredits, heldCredits);
      const [entry] = await transaction
        .insert(platformCreditEntries)
        .values({
          accountId: account.id,
          amountCredits: input.credits,
          balanceAfterCredits,
          idempotencyKey,
          operatorUserId,
          reason,
          type,
          userId: targetUserId,
          userIdSnapshot: targetUserId,
        })
        .returning();
      await transaction
        .update(platformCreditAccounts)
        .set({ balanceCredits: balanceAfterCredits, updatedAt: new Date() })
        .where(eq(platformCreditAccounts.id, account.id));
      return entry;
    });
  }

  topUp = (input: PostAdminCreditInput) => this.postAdminEntry('top_up', input);

  adjust = (input: PostAdminCreditInput) => this.postAdminEntry('adjustment', input);

  getAccountForUser = (userId: string) => ensureAccount(this.db, userId);

  listEntriesForUser = (userId: string, limit = 100, offset = 0) =>
    this.db
      .select()
      .from(platformCreditEntries)
      .where(eq(platformCreditEntries.userIdSnapshot, userId))
      .orderBy(desc(platformCreditEntries.createdAt), desc(platformCreditEntries.id))
      .limit(normalizeListLimit(limit))
      .offset(Number.isSafeInteger(offset) && offset >= 0 ? offset : 0);

  listPendingReservationsForUser = (
    userId: string,
    limit = 100,
    offset = 0,
  ): Promise<PlatformCreditPendingReservationItem[]> => {
    const targetUserId = normalizeRequiredText(userId, '目标用户 ID', 255);

    return this.db
      .select({
        actorUserId: platformCreditBudgets.actorUserIdSnapshot,
        callKind: platformCreditReservations.callKind,
        createdAt: platformCreditReservations.createdAt,
        expiresAt: platformCreditReservations.expiresAt,
        generationId: platformCreditReservations.generationId,
        generationType: platformCreditReservations.generationType,
        id: platformCreditReservations.id,
        model: platformCreditReservations.model,
        payerUserId: platformCreditAccounts.userIdSnapshot,
        provider: platformCreditReservations.provider,
        providerRequestId: platformCreditReservations.providerRequestId,
        reservedCredits: platformCreditReservations.reservedCredits,
        settledCredits: platformCreditReservations.settledCredits,
        status: sql<
          'provider_completed' | 'provider_started'
        >`${platformCreditReservations.status}`,
        updatedAt: platformCreditReservations.updatedAt,
      })
      .from(platformCreditReservations)
      .innerJoin(
        platformCreditBudgets,
        and(
          eq(platformCreditBudgets.id, platformCreditReservations.budgetId),
          eq(platformCreditBudgets.accountId, platformCreditReservations.accountId),
        ),
      )
      .innerJoin(
        platformCreditAccounts,
        eq(platformCreditAccounts.id, platformCreditReservations.accountId),
      )
      .where(
        and(
          inArray(platformCreditReservations.status, ['provider_completed', 'provider_started']),
          or(
            eq(platformCreditAccounts.userIdSnapshot, targetUserId),
            eq(platformCreditBudgets.actorUserIdSnapshot, targetUserId),
          ),
        ),
      )
      .orderBy(desc(platformCreditReservations.updatedAt), desc(platformCreditReservations.id))
      .limit(normalizeListLimit(limit))
      .offset(Number.isSafeInteger(offset) && offset >= 0 ? offset : 0);
  };

  async reverse(input: ReversePlatformCreditInput): Promise<PlatformCreditEntryItem> {
    const entryId = normalizeRequiredText(input.entryId, '流水 ID', 255);
    const idempotencyKey = normalizeRequiredText(input.idempotencyKey, '幂等键', 200);
    const reason = normalizeRequiredText(input.reason, '冲正原因');
    const operatorUserId = normalizeRequiredText(this.operatorUserId, '管理员用户 ID', 255);

    return this.db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const [locator] = await transaction
        .select({ accountId: platformCreditEntries.accountId })
        .from(platformCreditEntries)
        .where(eq(platformCreditEntries.id, entryId))
        .limit(1);
      if (!locator) throw new Error(PLATFORM_CREDIT_ENTRY_NOT_FOUND);

      const [account] = await transaction
        .select()
        .from(platformCreditAccounts)
        .where(eq(platformCreditAccounts.id, locator.accountId))
        .limit(1)
        .for('update');
      if (!account) throw new Error(PLATFORM_CREDIT_ENTRY_NOT_FOUND);

      const [original] = await transaction
        .select()
        .from(platformCreditEntries)
        .where(
          and(
            eq(platformCreditEntries.id, entryId),
            eq(platformCreditEntries.accountId, account.id),
          ),
        )
        .limit(1)
        .for('update');
      if (!original) throw new Error(PLATFORM_CREDIT_ENTRY_NOT_FOUND);
      if (original.type === 'reversal') throw new Error(PLATFORM_CREDIT_REVERSAL_NOT_ALLOWED);

      const existingByKey = await findEntryByKey(transaction, account.id, idempotencyKey);
      if (existingByKey) {
        if (
          existingByKey.type !== 'reversal' ||
          existingByKey.reversalOfEntryId !== original.id ||
          existingByKey.reason !== reason ||
          existingByKey.operatorUserId !== operatorUserId
        ) {
          throw new Error(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);
        }
        return existingByKey;
      }

      const [existingReversal] = await transaction
        .select({ id: platformCreditEntries.id })
        .from(platformCreditEntries)
        .where(eq(platformCreditEntries.reversalOfEntryId, original.id))
        .limit(1);
      if (existingReversal) throw new Error(PLATFORM_CREDIT_REVERSAL_ALREADY_EXISTS);

      const amountCredits = -original.amountCredits;
      const balanceAfterCredits = account.balanceCredits + amountCredits;
      const heldCredits = await activeBudgetHeldCredits(transaction, account.id);
      assertBalanceCoversHolds(balanceAfterCredits, heldCredits);
      const [entry] = await transaction
        .insert(platformCreditEntries)
        .values({
          accountId: account.id,
          amountCredits,
          balanceAfterCredits,
          idempotencyKey,
          operatorUserId,
          reason,
          reversalOfEntryId: original.id,
          type: 'reversal',
          userId: original.userId,
          userIdSnapshot: original.userIdSnapshot,
        })
        .returning();
      await transaction
        .update(platformCreditAccounts)
        .set({ balanceCredits: balanceAfterCredits, updatedAt: new Date() })
        .where(eq(platformCreditAccounts.id, account.id));
      return entry;
    });
  }
}
