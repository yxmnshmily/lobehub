import { USD_TO_CNY } from '@lobechat/const/currency';
import debug from 'debug';
import type { FixedPricingUnit, LookupPricingUnit, Pricing } from 'model-bank';

import { computeUsagePrice } from './computeUsagePrice';

const log = debug('lobe-cost:computeVideoCost');

export interface VideoGenerationParams {
  [key: string]: unknown;
  /** Actual billable output duration in seconds, not request latency. */
  duration?: number;
  generateAudio?: boolean;
  resolution?: string;
}

export interface VideoCostResult {
  breakdown?: {
    completionTokens?: number;
    duration?: number;
    lookupKey?: string;
    pricePerMillionTokens?: number;
    pricePerSecond?: number;
  };
  totalCost: number; // Total cost in USD
  totalCredits: number; // Total credits (USD * CREDITS_PER_DOLLAR)
}

/**
 * Compute the cost for video generation based on pricing configuration.
 * Supports both fixed and lookup pricing strategies.
 * Handles CNY→USD conversion when pricing currency is CNY.
 */
export const computeVideoCost = (
  pricing: Pricing,
  completionTokens: number,
  params: VideoGenerationParams,
): VideoCostResult | undefined => {
  const videoGenUnit = pricing.units.find((unit) => unit.name === 'videoGeneration');
  if (!videoGenUnit) {
    log('No videoGeneration unit found in pricing configuration');
    return undefined;
  }

  const currency = pricing.currency || 'USD';
  if (currency !== 'USD' && currency !== 'CNY') return undefined;
  const perSecond = videoGenUnit.unit === 'second';
  if (!perSecond && videoGenUnit.unit !== 'millionTokens') return undefined;
  const quantity = perSecond ? params.duration : completionTokens;
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0) return undefined;
  let pricePerMillionTokens: number;
  let lookupKey: string | undefined;

  switch (videoGenUnit.strategy) {
    case 'fixed': {
      const fixedUnit = videoGenUnit as FixedPricingUnit;
      pricePerMillionTokens = fixedUnit.rate;
      log(`Fixed pricing: ${pricePerMillionTokens} per ${videoGenUnit.unit} (${currency})`);
      break;
    }
    case 'lookup': {
      const lookupUnit = videoGenUnit as LookupPricingUnit;

      const lookupParams: string[] = [];
      if (lookupUnit.lookup?.pricingParams) {
        for (const paramName of lookupUnit.lookup.pricingParams) {
          const paramValue = params[paramName];
          if (paramValue === undefined || paramValue === null) {
            log(`Missing required lookup param: ${paramName}`);
            return undefined;
          }
          lookupParams.push(String(paramValue));
        }
        lookupKey = lookupParams.join('_');
      } else {
        log('No pricing params defined for lookup strategy');
        return undefined;
      }

      const lookupPrice = lookupUnit.lookup?.prices?.[lookupKey];
      if (typeof lookupPrice !== 'number') {
        log(`No price found for lookup key: ${lookupKey}`);
        return undefined;
      }

      pricePerMillionTokens = lookupPrice;
      log(
        `Lookup pricing for key "${lookupKey}": ${pricePerMillionTokens} per ${videoGenUnit.unit} (${currency})`,
      );
      break;
    }
    default: {
      log(`Unsupported pricing strategy: ${videoGenUnit.strategy}`);
      return undefined;
    }
  }

  // Calculate cost in original currency
  if (!Number.isFinite(pricePerMillionTokens) || pricePerMillionTokens < 0) return undefined;
  const cost = computeUsagePrice(
    pricePerMillionTokens,
    quantity,
    perSecond ? 1 : 1_000_000,
    currency === 'CNY' ? USD_TO_CNY : 1,
  );
  if (!cost) return undefined;
  const { totalCost: costInUSD, totalCredits } = cost;

  log(
    `Video cost: quantity %d × rate %d %s = $%d USD (%d credits)`,
    quantity / (perSecond ? 1 : 1_000_000),
    pricePerMillionTokens,
    currency,
    costInUSD,
    totalCredits,
  );

  return {
    breakdown: {
      lookupKey,
      ...(perSecond
        ? { duration: quantity, pricePerSecond: pricePerMillionTokens }
        : { completionTokens, pricePerMillionTokens }),
    },
    totalCost: costInUSD,
    totalCredits,
  };
};
