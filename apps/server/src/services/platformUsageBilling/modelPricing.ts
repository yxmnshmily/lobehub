import type { LobeChatDatabase } from '@lobechat/database';
import { computeChatCost } from '@lobechat/model-runtime';
import type { ModelUsage } from '@lobechat/types';
import { resolveDeepseekPricing } from '@lobechat/utils/deepseekPricing';
import type { Pricing, PricingUnit, PricingUnitName } from 'model-bank';

import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { getBillingExchangeRate } from '@/server/services/monthlyExchangeRate';
import { PlatformCredentialResolver } from '@/server/services/platformAiRuntime';
import type { ProviderConfig } from '@/types/user/settings';

export interface PlatformModelReference {
  model: string;
  provider: string;
}

export interface PlatformModelPricingSnapshot extends PlatformModelReference {
  contextWindowTokens?: number;
  exchangeRate?: ModelUsage['costExchangeRate'];
  maxOutput?: number;
  pricing: Pricing;
}

const normalizeReference = ({ model, provider }: PlatformModelReference) => ({
  model: model.trim(),
  provider: provider.trim(),
});

const REPRESENTATIVE_TEXT_USAGE = {
  audioInput: { inputAudioTokens: 1, totalTokens: 1 },
  audioInput_cacheRead: {
    inputAudioTokens: 1,
    inputCachedAudioTokens: 1,
    inputCachedTokens: 1,
    totalInputTokens: 1,
    totalTokens: 1,
  },
  audioOutput: { outputAudioTokens: 1, totalTokens: 1 },
  imageInput: { inputImageTokens: 1, totalTokens: 1 },
  imageInput_cacheRead: {
    inputCachedImageTokens: 1,
    inputCachedTokens: 1,
    inputImageTokens: 1,
    totalInputTokens: 1,
    totalTokens: 1,
  },
  imageOutput: { outputImageTokens: 1, totalTokens: 1 },
  textInput: { totalInputTokens: 1, totalTokens: 1 },
  textInput_cacheRead: {
    inputCacheMissTokens: 0,
    inputCachedTokens: 1,
    totalInputTokens: 1,
    totalTokens: 1,
  },
  textInput_cacheWrite: { inputWriteCacheTokens: 1, totalTokens: 1 },
  textOutput: { totalOutputTokens: 1, totalTokens: 1 },
  videoInput: { inputVideoTokens: 1, totalTokens: 1 },
} satisfies Partial<Record<PricingUnitName, ModelUsage>>;

const isPositiveFiniteRate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const hasValidTextUnitRates = (unit: PricingUnit) => {
  if (!(unit.name in REPRESENTATIVE_TEXT_USAGE)) return true;
  if (unit.unit !== 'millionTokens') return false;

  if (unit.strategy === 'fixed') return isPositiveFiniteRate(unit.rate);
  if (unit.strategy === 'tiered') {
    return (
      Array.isArray(unit.tiers) &&
      unit.tiers.length > 0 &&
      unit.tiers.every(({ rate }) => isPositiveFiniteRate(rate))
    );
  }
  if (unit.strategy === 'lookup') {
    const prices = Object.values(unit.lookup?.prices ?? {});
    return prices.length > 0 && prices.every(isPositiveFiniteRate);
  }
  return false;
};

const canPriceRepresentativeUsage = (
  pricing: Pricing,
  unitName: keyof typeof REPRESENTATIVE_TEXT_USAGE,
) => {
  const result = computeChatCost(pricing, REPRESENTATIVE_TEXT_USAGE[unitName]);
  return (
    !!result &&
    result.issues.length === 0 &&
    Number.isFinite(result.totalCost) &&
    result.totalCost > 0 &&
    result.breakdown.some(
      (item) =>
        item.unit.name === unitName &&
        item.quantity > 0 &&
        Number.isFinite(item.cost) &&
        item.cost > 0,
    )
  );
};

const canComputeTextCost = (pricing: Pricing) => {
  if (!Array.isArray(pricing.units) || pricing.units.length === 0) return false;
  try {
    const textUnits = pricing.units.filter(
      (unit): unit is PricingUnit & { name: keyof typeof REPRESENTATIVE_TEXT_USAGE } =>
        unit.name in REPRESENTATIVE_TEXT_USAGE,
    );
    const unitNames = new Set(textUnits.map(({ name }) => name));
    if (!unitNames.has('textInput') || !unitNames.has('textOutput')) return false;
    if (!textUnits.every(hasValidTextUnitRates)) return false;

    return [...unitNames].every((unitName) => {
      // A cache-write lookup (for example Ark's TTL price) is conditional. A text
      // request that does not create a cache must not be rejected for lacking its TTL.
      const unit = textUnits.find((item) => item.name === unitName);
      if (unitName === 'textInput_cacheWrite' && unit?.strategy === 'lookup') return true;
      return canPriceRepresentativeUsage(pricing, unitName);
    });
  } catch {
    return false;
  }
};

/**
 * Resolves an immutable price from the same personal, merged model catalog used by the
 * validated platform credential owner. Browser input can select neither the owner nor a price.
 */
export const resolvePlatformModelPricing = async (
  db: LobeChatDatabase,
  reference: PlatformModelReference,
): Promise<PlatformModelPricingSnapshot | undefined> => {
  const { model, provider } = normalizeReference(reference);
  if (!model || !provider) return undefined;

  const ownerId = await new PlatformCredentialResolver(db).resolveOwnerId();
  const { aiProvider } = await getServerGlobalConfig();
  const repos = new AiInfraRepos(
    db,
    ownerId,
    aiProvider as Record<string, ProviderConfig>,
    undefined,
  );
  const models = await repos.getAiProviderModelList(provider, { enabled: true });
  const exact = models.find(
    (item) => item.id === model && (!('providerId' in item) || item.providerId === provider),
  );
  if (!exact?.pricing) return undefined;
  const limits = { contextWindowTokens: exact.contextWindowTokens, maxOutput: exact.maxOutput };
  const pricing = resolveDeepseekPricing(model, provider, exact.pricing, new Date());
  if (!pricing || !canComputeTextCost(pricing)) return undefined;

  if (pricing.currency !== 'CNY') {
    return Object.freeze({ ...limits, model, pricing: structuredClone(pricing), provider });
  }
  const { rate, rateDate, updatedAt } = await getBillingExchangeRate();
  // Normalize once at admission so cost ceilings and final settlement share this quote.
  const normalized = structuredClone(pricing);
  normalized.currency = 'USD';
  normalized.units = normalized.units.map((unit) => {
    if (unit.strategy === 'fixed') return { ...unit, rate: unit.rate / rate };
    if (unit.strategy === 'tiered')
      return {
        ...unit,
        tiers: unit.tiers.map((tier) => ({ ...tier, rate: tier.rate / rate })),
      };
    return {
      ...unit,
      lookup: {
        ...unit.lookup,
        prices: Object.fromEntries(
          Object.entries(unit.lookup.prices).map(([key, value]) => [key, value / rate]),
        ),
      },
    };
  });
  return Object.freeze({
    ...limits,
    model,
    provider,
    pricing: normalized,
    exchangeRate: Object.freeze({ rate, rateDate, updatedAt: updatedAt! }),
  });
};

/** Replaces any runtime-derived cost with the server catalog's exact provider/model price. */
export const pricePlatformTextUsage = (
  snapshot: PlatformModelPricingSnapshot,
  usage: ModelUsage,
): ModelUsage => {
  let computation;
  try {
    if (snapshot.pricing.currency === 'CNY' && !snapshot.exchangeRate) {
      throw new Error('CNY billing requires an admission exchange-rate snapshot');
    }
    computation = computeChatCost(snapshot.pricing, usage, {
      usdToCnyRate: snapshot.exchangeRate?.rate,
    });
  } catch {
    computation = undefined;
  }
  if (
    !computation ||
    computation.issues.length > 0 ||
    !Number.isFinite(computation.totalCost) ||
    computation.totalCost < 0 ||
    !computation.breakdown.some((item) => item.quantity > 0)
  ) {
    throw new Error('Exact platform model usage cost is unavailable');
  }

  return { ...usage, cost: computation.totalCost, costExchangeRate: snapshot.exchangeRate };
};
