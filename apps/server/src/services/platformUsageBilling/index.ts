import { createHash } from 'node:crypto';

import { CREDITS_PER_DOLLAR } from '@lobechat/const/currency';

import type { ModelUsage } from '@/types/message';

export type PlatformUsageBillingErrorCode =
  | 'COST_MISSING'
  | 'CREDITS_OVERFLOW'
  | 'INVALID_COST'
  | 'INVALID_IDENTITY'
  | 'INVALID_TOKEN_USAGE'
  | 'USAGE_MISSING';

export class PlatformUsageBillingError extends Error {
  readonly code: PlatformUsageBillingErrorCode;

  constructor(code: PlatformUsageBillingErrorCode, message: string) {
    super(message);
    this.name = 'PlatformUsageBillingError';
    this.code = code;
  }
}

export interface PlatformUsageBillingInput {
  /** The customer whose balance must be charged, never the platform credential owner. */
  actorUserId: string;
  /** Durable provider-neutral generation/message/task identifier. */
  generationId: string;
  generationType?: string | null;
  model: string;
  provider: string;
  /** Authoritative usage emitted by LobeHub's model runtime after price resolution. */
  usage?: ModelUsage;
  workspaceId?: string | null;
}

export interface PlatformUsageIdempotencyMaterial {
  actorUserId: string;
  generationId: string;
  generationType: string | null;
  model: string;
  provider: string;
  version: 1;
  workspaceId: string | null;
}

export type PlatformUsageTokenDetails = Omit<ModelUsage, 'cost'>;

export interface PlatformUsageCharge {
  /** The authoritative USD cost supplied by the model runtime. */
  costUsd: number;
  /** Integer LobeHub credits. One USD equals CREDITS_PER_DOLLAR credits. */
  credits: number;
  creditsPerDollar: typeof CREDITS_PER_DOLLAR;
  idempotency: {
    key: string;
    material: PlatformUsageIdempotencyMaterial;
  };
  tokens: PlatformUsageTokenDetails;
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

const requireIdentifier = (field: string, value: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    throw new PlatformUsageBillingError('INVALID_IDENTITY', `${field} is required for billing.`);
  }
  return normalized;
};

const normalizeOptionalIdentifier = (field: string, value?: string | null): string | null => {
  if (value === undefined || value === null) return null;
  return requireIdentifier(field, value);
};

const copyTokenDetails = (usage: ModelUsage): PlatformUsageTokenDetails => {
  const tokens: Record<string, number> = {};

  for (const field of tokenFields) {
    const value = usage[field];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new PlatformUsageBillingError(
        'INVALID_TOKEN_USAGE',
        `${field} must be a non-negative safe integer.`,
      );
    }
    tokens[field] = value;
  }

  return tokens as PlatformUsageTokenDetails;
};

const buildIdempotency = (material: PlatformUsageIdempotencyMaterial) => {
  // The fixed-property object is serialized deterministically. Cost and token counts are
  // deliberately excluded so a provider retry cannot debit the same generation twice.
  const digest = createHash('sha256').update(JSON.stringify(material)).digest('hex');
  return { key: `platform-usage:v1:${digest}`, material };
};

/**
 * Converts LobeHub's already-priced runtime usage into an auditable charge candidate.
 *
 * This function never looks up a second price, invents a fixed image/video fee, converts
 * currencies, or mutates a balance. Callers must persist the returned charge atomically
 * under `idempotency.key`.
 */
export const preparePlatformUsageCharge = (
  input: PlatformUsageBillingInput,
): PlatformUsageCharge => {
  const actorUserId = requireIdentifier('actorUserId', input.actorUserId);
  const generationId = requireIdentifier('generationId', input.generationId);
  const generationType = normalizeOptionalIdentifier('generationType', input.generationType);
  const model = requireIdentifier('model', input.model);
  const provider = requireIdentifier('provider', input.provider);
  const workspaceId = normalizeOptionalIdentifier('workspaceId', input.workspaceId);

  if (!input.usage) {
    throw new PlatformUsageBillingError(
      'USAGE_MISSING',
      'Authoritative model usage is required for billing.',
    );
  }
  if (input.usage.cost === undefined || input.usage.cost === null) {
    throw new PlatformUsageBillingError(
      'COST_MISSING',
      'Authoritative model usage cost is required for billing.',
    );
  }

  const costUsd = input.usage.cost;
  if (!Number.isFinite(costUsd) || costUsd < 0) {
    throw new PlatformUsageBillingError(
      'INVALID_COST',
      'Authoritative model usage cost must be a finite non-negative USD amount.',
    );
  }

  // Keep exactly the rounding rule used by LobeHub's image/video usage converters:
  // any positive sub-credit cost is billed as one integer credit.
  const credits = Math.ceil(costUsd * CREDITS_PER_DOLLAR);
  if (!Number.isSafeInteger(credits)) {
    throw new PlatformUsageBillingError(
      'CREDITS_OVERFLOW',
      'The computed credit amount exceeds the safe integer range.',
    );
  }

  const material: PlatformUsageIdempotencyMaterial = {
    actorUserId,
    generationId,
    generationType,
    model,
    provider,
    version: 1,
    workspaceId,
  };

  return {
    credits,
    creditsPerDollar: CREDITS_PER_DOLLAR,
    costUsd,
    idempotency: buildIdempotency(material),
    tokens: copyTokenDetails(input.usage),
  };
};

export * from './reservation';
