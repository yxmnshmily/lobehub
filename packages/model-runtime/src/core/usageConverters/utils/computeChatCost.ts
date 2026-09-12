import { CREDITS_PER_DOLLAR, USD_TO_CNY } from '@lobechat/const/currency';
import type { ModelTokensUsage } from '@lobechat/types';
import debug from 'debug';
import type {
  FixedPricingUnit,
  LookupPricingUnit,
  Pricing,
  PricingUnit,
  PricingUnitName,
  TieredPricingUnit,
} from 'model-bank';

const log = debug('lobe-cost:computeChatPricing');

export interface PricingUnitBreakdown {
  cost: number;
  credits: number;
  currency: string | 'USD' | 'CNY';
  /**
   * For lookup strategies we expose the resolved key.
   */
  lookupKey?: string;
  quantity: number;
  /**
   * Extra details for tiered strategies to help consumers render ladders.
   */
  segments?: Array<{ credits: number; quantity: number; rate: number }>;
  unit: PricingUnit;
}

export interface PricingComputationIssue {
  reason: string;
  unit: PricingUnit;
}

export interface ComputeChatCostOptions {
  /**
   * Input parameters used by lookup strategies (e.g. ttl, thinkingMode).
   */
  lookupParams?: Record<string, string | number | boolean>;
  /**
   * Exchange rate for CNY to USD conversion. Defaults to USD_TO_CNY constant.
   * Useful for testing with fixed exchange rates.
   */
  usdToCnyRate?: number;
}

export interface PricingComputationResult {
  breakdown: PricingUnitBreakdown[];
  issues: PricingComputationIssue[];
  totalCost: number;
  totalCredits: number;
}

interface UnitQuantityResolverContext {
  hasDedicatedAudioCacheReadUnit: boolean;
  hasDedicatedAudioInputUnit: boolean;
  hasDedicatedImageCacheReadUnit: boolean;
  hasDedicatedModalityCacheReadUnit: boolean;
}

type UnitQuantityResolver = (
  usage: ModelTokensUsage,
  context: UnitQuantityResolverContext,
) => number | undefined;

const hasCachedModalityBreakdown = (usage: ModelTokensUsage) =>
  typeof usage.inputCachedTextTokens === 'number' ||
  typeof usage.inputCachedImageTokens === 'number' ||
  typeof usage.inputCachedAudioTokens === 'number' ||
  typeof usage.inputCachedVideoTokens === 'number';

const subtractCachedTokens = (
  totalTokens: number | undefined,
  cachedTokens: number | undefined,
): number | undefined => {
  if (typeof totalTokens !== 'number') return undefined;

  return Math.max(0, totalTokens - (cachedTokens ?? 0));
};

const resolveInputTextTokens = (usage: ModelTokensUsage) => {
  if (hasCachedModalityBreakdown(usage)) {
    return subtractCachedTokens(usage.inputTextTokens, usage.inputCachedTextTokens);
  }

  return usage.inputTextTokens;
};

const resolveInputImageTokens = (usage: ModelTokensUsage) => {
  if (hasCachedModalityBreakdown(usage)) {
    return subtractCachedTokens(usage.inputImageTokens, usage.inputCachedImageTokens);
  }

  return usage.inputImageTokens;
};

const resolveInputAudioTokens = (usage: ModelTokensUsage) => {
  if (hasCachedModalityBreakdown(usage)) {
    return subtractCachedTokens(usage.inputAudioTokens, usage.inputCachedAudioTokens);
  }

  return usage.inputAudioTokens;
};

const resolveInputVideoTokens = (usage: ModelTokensUsage) => {
  if (hasCachedModalityBreakdown(usage)) {
    return subtractCachedTokens(usage.inputVideoTokens, usage.inputCachedVideoTokens);
  }

  return usage.inputVideoTokens;
};

const sumDefinedTokens = (...values: Array<number | undefined>) => {
  const definedValues = values.filter((value): value is number => typeof value === 'number');
  if (definedValues.length === 0) return undefined;

  return definedValues.reduce((sum, value) => sum + value, 0);
};

const hasAudioInputBreakdown = (usage: ModelTokensUsage) =>
  typeof usage.inputAudioTokens === 'number';

const resolveTextPricedAudioTokens = (
  usage: ModelTokensUsage,
  context: UnitQuantityResolverContext,
) =>
  sumDefinedTokens(
    resolveInputTextTokens(usage),
    context.hasDedicatedAudioInputUnit ? undefined : resolveInputAudioTokens(usage),
  );

const UNIT_QUANTITY_RESOLVERS: Partial<Record<PricingUnitName, UnitQuantityResolver>> = {
  textInput: (usage, context) => {
    const toolTokens = usage.inputToolTokens ?? 0;

    if (hasCachedModalityBreakdown(usage)) {
      const textPricedTokens = resolveTextPricedAudioTokens(usage, context);
      if (textPricedTokens === undefined && toolTokens === 0) return undefined;

      return (textPricedTokens ?? 0) + toolTokens;
    }

    if (usage.inputCacheMissTokens !== undefined) {
      // inputCacheMissTokens only covers non-cached prompt tokens;
      // tool-use tokens (e.g. grounding results) are billed at the same input rate
      // and must be added here because there is no separate toolInput pricing unit.
      // Provider aggregate miss counts include audio. Subtract it only when a dedicated audio
      // unit exists; image/video allocation intentionally keeps its pre-audio behavior.
      const dedicatedAudioTokens = context.hasDedicatedAudioInputUnit
        ? (usage.inputAudioTokens ?? 0)
        : 0;

      return Math.max(0, usage.inputCacheMissTokens - dedicatedAudioTokens) + toolTokens;
    }

    if (typeof usage.inputCachedTokens === 'number' && typeof usage.totalInputTokens === 'number') {
      throw new Error(
        'Missing inputCacheMissTokens! You can set it by inputCacheMissTokens = totalInputTokens - inputCachedTokens',
      );
    }

    if (hasAudioInputBreakdown(usage)) {
      const textPricedTokens = resolveTextPricedAudioTokens(usage, context) ?? 0;
      const knownPromptTokens =
        (usage.inputTextTokens ?? 0) +
        (usage.inputAudioTokens ?? 0) +
        (usage.inputImageTokens ?? 0) +
        (usage.inputVideoTokens ?? 0);
      const promptTokensFromTotal = Math.max(0, (usage.totalInputTokens ?? 0) - toolTokens);
      // Keep unclassified provider tokens (for example citations) in the text bucket.
      const unclassifiedTokens = Math.max(0, promptTokensFromTotal - knownPromptTokens);

      return textPricedTokens + unclassifiedTokens + toolTokens;
    }

    // When tool tokens are present, totalInputTokens already includes them
    // (set by the converter as promptTokenCount + toolUsePromptTokenCount).
    // Prefer totalInputTokens over inputTextTokens to avoid underbilling.
    if (toolTokens > 0) {
      return usage.totalInputTokens;
    }

    return resolveInputTextTokens(usage) ?? usage.totalInputTokens;
  },
  textInput_cacheRead: (usage, context) => {
    if (hasCachedModalityBreakdown(usage) && context.hasDedicatedModalityCacheReadUnit) {
      if (typeof usage.inputCachedTokens === 'number') {
        return Math.max(
          0,
          usage.inputCachedTokens -
            (context.hasDedicatedAudioCacheReadUnit ? (usage.inputCachedAudioTokens ?? 0) : 0) -
            (context.hasDedicatedImageCacheReadUnit ? (usage.inputCachedImageTokens ?? 0) : 0),
        );
      }

      // `textInput_cacheRead` is the fallback bucket for same-price cached modalities.
      // For Gemini 3.1 Flash-Lite, text/image/video cache reads share one rate while
      // audio has a dedicated higher rate.
      return sumDefinedTokens(
        usage.inputCachedTextTokens,
        context.hasDedicatedImageCacheReadUnit ? undefined : usage.inputCachedImageTokens,
        context.hasDedicatedAudioCacheReadUnit ? undefined : usage.inputCachedAudioTokens,
        usage.inputCachedVideoTokens,
      );
    }

    return usage.inputCachedTokens;
  },
  textInput_cacheWrite: (usage) => usage.inputWriteCacheTokens,
  // reasoning tokens cost within output tokens
  textOutput: (usage) => {
    const { outputTextTokens, totalOutputTokens, outputReasoningTokens = 0 } = usage;
    const reasoningTokens = outputReasoningTokens;

    if (typeof outputTextTokens === 'number') {
      return outputTextTokens + reasoningTokens;
    }

    if (typeof totalOutputTokens === 'number') {
      return totalOutputTokens;
    }

    if (typeof usage.outputReasoningTokens === 'number') {
      return usage.outputReasoningTokens;
    }

    return undefined;
  },

  imageInput: resolveInputImageTokens,
  imageInput_cacheRead: (usage) => usage.inputCachedImageTokens,
  imageOutput: (usage) => usage.outputImageTokens,

  videoInput: resolveInputVideoTokens,

  imageGeneration: () => undefined,

  audioInput: resolveInputAudioTokens,
  audioInput_cacheRead: (usage) => usage.inputCachedAudioTokens,
  audioOutput: (usage) => usage.outputAudioTokens,
};

/**
 * Convert currency-specific credits to raw USD credits; aggregate before rounding.
 * @param credits - Credits in the original currency
 * @param currency - The currency of the credits ('USD' or 'CNY')
 * @param usdToCnyRate - Exchange rate for CNY to USD conversion (defaults to USD_TO_CNY constant)
 * @returns USD-equivalent credits (may be fractional)
 */
const toUSDCredits = (
  credits: number,
  currency: string = 'USD',
  usdToCnyRate = USD_TO_CNY,
): number => {
  return currency === 'CNY' ? credits / usdToCnyRate : credits;
};

/**
 * Convert credits to USD dollar amount
 * @param credits - USD credits
 * @returns USD dollar amount
 */
const creditsToUSD = (credits: number) => credits / CREDITS_PER_DOLLAR;

/**
 * Returns raw credits, which will be rounded up uniformly at the final aggregation stage.
 */
const computeFixedCredits = (unit: FixedPricingUnit, quantity: number) => quantity * unit.rate;

/**
 * Google provider uses new pricing for entire input and output when exceeding threshold, not tiered calculation
 * TODO: Some providers do use tiered calculation, such as Zhipu
 */
const computeTieredCredits = (
  unit: TieredPricingUnit,
  quantity: number,
  tierQuantity?: number,
): { credits: number; segments: Array<{ credits: number; quantity: number; rate: number }> } => {
  if (quantity <= 0) return { credits: 0, segments: [] };

  const segments: Array<{ credits: number; quantity: number; rate: number }> = [];
  const tiers = unit.tiers ?? [];
  if (tiers.length === 0) return { credits: 0, segments };

  // Use tierQuantity (from tierBy) to select the tier, but bill based on actual quantity
  const lookupQuantity = tierQuantity ?? quantity;

  // Google and other providers charge the entire quantity at the new rate when exceeding threshold
  const matchedTier =
    tiers.find((tier) => {
      const limit = tier.upTo === 'infinity' ? Number.POSITIVE_INFINITY : tier.upTo;
      return lookupQuantity <= limit;
    }) ?? tiers.at(-1);

  if (!matchedTier) return { credits: 0, segments };

  const credits = quantity * matchedTier.rate;
  segments.push({ credits, quantity, rate: matchedTier.rate });

  return { credits, segments };
};

/** Which usage counter bands each range param, in card-key order. */
const RANGE_VALUE_SOURCES: Record<string, (usage: ModelTokensUsage) => number | undefined> = {
  textInputRange: (usage) => usage.totalInputTokens ?? usage.inputTextTokens,
  textOutputRange: (usage) => usage.totalOutputTokens ?? usage.outputTextTokens,
};

/** `[0, 0.032]` / `(0.032, 0.128]` / `[0.128, infinity]` — millions of tokens. */
const RANGE_KEY_PATTERN = /^(\[|\()\s*([\d.]+)\s*,\s*([\d.]+|infinity)\s*(\]|\))$/i;

const parseRangeKey = (
  key: string,
):
  | { lower: number; lowerInclusive: boolean; upper: number; upperInclusive: boolean }
  | undefined => {
  const match = RANGE_KEY_PATTERN.exec(key.trim());
  if (!match) return undefined;

  const [, open, lower, upper, close] = match;

  return {
    lower: Number(lower),
    lowerInclusive: open === '[',
    upper: upper.toLowerCase() === 'infinity' ? Number.POSITIVE_INFINITY : Number(upper),
    upperInclusive: close === ']',
  };
};

const withinRange = (key: string, tokens: number): boolean => {
  const range = parseRangeKey(key);
  if (!range) return false;

  // Card keys are expressed in millions of tokens.
  const value = tokens / 1_000_000;
  const aboveLower = range.lowerInclusive ? value >= range.lower : value > range.lower;
  const belowUpper = range.upperInclusive ? value <= range.upper : value < range.upper;

  return aboveLower && belowUpper;
};

/**
 * Size-banded lookup params (`textInputRange` / `textOutputRange`) are *derived*:
 * a card declares its tiers as bracket keys over the request's token counts and
 * expects the engine to pick the band the request falls into. No caller supplied
 * them, so every card that declared one — Doubao Seed 2.0/1.8/1.6, Qwen's
 * long-context tiers — resolved no key and priced at zero. Deriving them here
 * keeps the catalog honest without asking providers to pass a value they cannot
 * know while streaming.
 *
 * The whole key is matched, never one column at a time: a card may band only some
 * columns (`[0.128, 0.256]_[0, infinity]`), so stitching per-column winners
 * together would fabricate a key the card never declared.
 */
const deriveRangeParams = (
  unit: LookupPricingUnit,
  options: ComputeChatCostOptions | undefined,
  usage: ModelTokensUsage,
): Record<string, string> | undefined => {
  const params = unit.lookup?.pricingParams;
  const keys = Object.keys(unit.lookup?.prices ?? {});
  if (!params?.length || keys.length === 0) return undefined;

  // A caller-supplied band is authoritative for the whole unit: mixing it with a
  // derived one could form a key the card does not declare.
  if (params.some((param) => options?.lookupParams?.[param] !== undefined)) return undefined;

  const derived = params.filter((param) => param in RANGE_VALUE_SOURCES);
  if (derived.length === 0) return undefined;

  const matched = keys.find((candidate) => {
    const parts = candidate.split('_');

    return derived.every((param) => {
      const tokens = RANGE_VALUE_SOURCES[param](usage);
      const part = parts[params.indexOf(param)];

      return typeof tokens === 'number' && Boolean(part) && withinRange(part, tokens);
    });
  });
  if (!matched) return undefined;

  const parts = matched.split('_');

  return Object.fromEntries(derived.map((param) => [param, parts[params.indexOf(param)]]));
};

const resolveLookupKey = (
  unit: LookupPricingUnit,
  options: ComputeChatCostOptions | undefined,
): { key?: string; missingParams?: string[] } => {
  if (!unit.lookup?.pricingParams?.length) return { key: undefined };

  const missingParams: string[] = [];
  const params = unit.lookup.pricingParams.map((param) => {
    const source = options?.lookupParams?.[param];
    if (source === undefined || source === null) {
      missingParams.push(param);
      return 'undefined';
    }

    if (typeof source === 'boolean') return String(source);
    return String(source);
  });

  if (missingParams.length > 0) return { key: undefined, missingParams };

  return { key: params.join('_') };
};

const computeLookupCredits = (
  unit: LookupPricingUnit,
  quantity: number,
  options: ComputeChatCostOptions | undefined,
): { credits: number; issues?: PricingComputationIssue; key?: string } => {
  const { key, missingParams } = resolveLookupKey(unit, options);

  if (missingParams && missingParams.length > 0) {
    return {
      credits: 0,
      issues: {
        reason: `Missing lookup params: ${missingParams.join(', ')}`,
        unit,
      },
    };
  }

  if (!key) {
    return {
      credits: 0,
      issues: {
        reason: 'Lookup key could not be resolved',
        unit,
      },
    };
  }

  const lookupRate = unit.lookup.prices?.[key];
  if (typeof lookupRate !== 'number') {
    return {
      credits: 0,
      issues: {
        reason: `Lookup price not found for key "${key}"`,
        unit,
      },
      key,
    };
  }

  return {
    credits: quantity * lookupRate,
    key,
  };
};

const resolveQuantity = (
  unit: PricingUnit,
  usage: ModelTokensUsage,
  context: UnitQuantityResolverContext,
) => {
  const resolver = UNIT_QUANTITY_RESOLVERS[unit.name as PricingUnitName];
  const quantity = resolver?.(usage, context);
  return typeof quantity === 'number' ? quantity : undefined;
};

/**
 * 1. Keep raw credits for each item (may be decimal)
 * 2. Round up uniformly at the totals stage to prevent cost undercounting
 */
export const computeChatCost = (
  pricing: Pricing | undefined,
  usage: ModelTokensUsage,
  options?: ComputeChatCostOptions,
): PricingComputationResult | undefined => {
  if (!pricing) return undefined;

  const breakdown: PricingUnitBreakdown[] = [];
  const issues: PricingComputationIssue[] = [];
  const currency = pricing.currency || 'USD';
  const usdToCnyRate = options?.usdToCnyRate ?? USD_TO_CNY;
  const pricingUnitNames = new Set(pricing.units.map((unit) => unit.name));
  const hasDedicatedAudioCacheReadUnit = pricingUnitNames.has('audioInput_cacheRead');
  const hasDedicatedAudioInputUnit = pricingUnitNames.has('audioInput');
  const hasDedicatedImageCacheReadUnit = pricingUnitNames.has('imageInput_cacheRead');

  if (
    typeof usage.inputCachedTokens === 'number' &&
    usage.inputCachedTokens > 0 &&
    typeof usage.inputAudioTokens === 'number' &&
    usage.inputAudioTokens > 0 &&
    typeof usage.inputCachedAudioTokens !== 'number' &&
    (hasDedicatedAudioInputUnit || hasDedicatedAudioCacheReadUnit)
  ) {
    // Aggregate cache usage does not reveal how many audio tokens received cache pricing.
    // Dedicated audio units make that split material, so returning a cost would require guessing.
    return undefined;
  }

  const resolverContext: UnitQuantityResolverContext = {
    hasDedicatedAudioCacheReadUnit,
    hasDedicatedAudioInputUnit,
    hasDedicatedImageCacheReadUnit,
    hasDedicatedModalityCacheReadUnit:
      hasDedicatedAudioCacheReadUnit || hasDedicatedImageCacheReadUnit,
  };

  for (const unit of pricing.units) {
    const quantity = resolveQuantity(unit, usage, resolverContext);
    if (quantity === undefined) continue;

    if (unit.strategy === 'fixed') {
      if (unit.unit !== 'millionTokens')
        throw new Error(`Unsupported chat pricing unit: ${unit.unit}`);

      const fixedUnit = unit as FixedPricingUnit;
      const rawCredits = computeFixedCredits(fixedUnit, quantity);
      const usdCredits = toUSDCredits(rawCredits, currency, usdToCnyRate);
      breakdown.push({
        cost: creditsToUSD(usdCredits),
        credits: usdCredits,
        quantity,
        currency,
        unit,
      });
      continue;
    }

    if (unit.strategy === 'tiered') {
      const tieredUnit = unit as TieredPricingUnit;
      // Use totalInputTokens to determine the tier — providers like OpenAI and Google
      // set pricing tiers based on total prompt size, not per-unit quantity.
      const tierQuantity = usage.totalInputTokens ?? usage.inputTextTokens;
      const { credits: rawCredits, segments } = computeTieredCredits(
        tieredUnit,
        quantity,
        tierQuantity,
      );
      const usdCredits = toUSDCredits(rawCredits, currency, usdToCnyRate);
      breakdown.push({
        cost: creditsToUSD(usdCredits),
        credits: usdCredits,
        quantity,
        currency,
        segments,
        unit,
      });
      continue;
    }

    if (unit.strategy === 'lookup') {
      const lookupUnit = unit as LookupPricingUnit;
      const derivedRange = deriveRangeParams(lookupUnit, options, usage);
      const {
        credits: rawCredits,
        key,
        issues: lookupIssue,
      } = computeLookupCredits(
        lookupUnit,
        quantity,
        derivedRange
          ? { ...options, lookupParams: { ...options?.lookupParams, ...derivedRange } }
          : options,
      );

      if (lookupIssue) issues.push(lookupIssue);

      const usdCredits = toUSDCredits(rawCredits, currency, usdToCnyRate);
      breakdown.push({
        cost: creditsToUSD(usdCredits),
        credits: usdCredits,
        lookupKey: key,
        quantity,
        currency,
        unit,
      });
      continue;
    }

    issues.push({ reason: 'Unsupported pricing strategy', unit });
  }

  // Sum up USD credits from all breakdown items
  const rawTotalCredits = breakdown.reduce((sum, item) => sum + item.credits, 0);
  const totalCredits = Math.ceil(rawTotalCredits);
  // !: totalCredits has been uniformly rounded up to integer USD credits, divided by CREDITS_PER_DOLLAR naturally retains only 6 decimal places, no additional processing needed
  const totalCost = creditsToUSD(totalCredits);

  log(`computeChatPricing breakdown: ${JSON.stringify(breakdown, null, 2)}`);

  return {
    breakdown,
    issues,
    totalCost,
    totalCredits,
  };
};
