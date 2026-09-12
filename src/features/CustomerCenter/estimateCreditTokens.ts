import { CREDITS_PER_DOLLAR } from '@lobechat/const/currency';
import type { Pricing } from 'model-bank';

// Display-only equivalent at the selected model's prices, not historical settlement.
export const estimateTokenCredits = (
  input: number | null | undefined,
  output: number | null | undefined,
  pricing: Pricing | undefined,
  usdToCnyRate?: number,
): [number, number] | null => {
  if (!pricing || [input, output].some((n) => n == null || !Number.isSafeInteger(n) || n < 0))
    return null;
  const currency = pricing.currency ?? 'USD';
  if (currency !== 'USD' && currency !== 'CNY') return null;
  if (currency === 'CNY' && (!Number.isFinite(usdToCnyRate) || !usdToCnyRate || usdToCnyRate <= 0))
    return null;
  const costs = [0, 0];
  for (const [name, count] of [
    ['textInput', input!],
    ['textOutput', output!],
  ] as const) {
    if (count === 0) continue;
    const unit = pricing.units.find((entry) => entry.name === name);
    if (!unit || unit.unit !== 'millionTokens') return null;
    const rates =
      unit.strategy === 'fixed'
        ? [unit.rate]
        : unit.strategy === 'tiered'
          ? unit.tiers.map((tier) => tier.rate)
          : Object.values(unit.lookup.prices);
    if (!rates.length || rates.some((rate) => !Number.isFinite(rate) || rate < 0)) return null;
    const factor =
      ((count / 1_000_000) * CREDITS_PER_DOLLAR) / (currency === 'CNY' ? usdToCnyRate! : 1);
    costs[0] += factor * Math.min(...rates);
    costs[1] += factor * Math.max(...rates);
  }
  const result: [number, number] = [Math.ceil(costs[0]), Math.ceil(costs[1])];
  return result.every(Number.isSafeInteger) ? result : null;
};

export const estimateCreditTokens = (
  credits: number | null | undefined,
  pricing: Pricing | undefined,
  name: 'textInput' | 'textOutput',
  usdToCnyRate?: number,
): [number, number] | null => {
  if (credits == null || !Number.isSafeInteger(credits) || credits < 0 || !pricing) return null;
  const currency = pricing.currency ?? 'USD';
  if (currency !== 'USD' && currency !== 'CNY') return null;
  if (currency === 'CNY' && (!Number.isFinite(usdToCnyRate) || !usdToCnyRate || usdToCnyRate <= 0))
    return null;
  const unit = pricing.units.find((entry) => entry.name === name);
  if (!unit || unit.unit !== 'millionTokens') return null;
  const rates =
    unit.strategy === 'fixed'
      ? [unit.rate]
      : unit.strategy === 'tiered'
        ? unit.tiers.map((tier) => tier.rate)
        : Object.values(unit.lookup.prices);
  if (!rates.length || rates.some((rate) => !Number.isFinite(rate) || rate <= 0)) return null;
  // Match the current admission quote, without repricing historical charges.
  // These are separate all-input/all-output budgets, never additive or a billing promise.
  const budget = (credits / CREDITS_PER_DOLLAR) * (currency === 'CNY' ? usdToCnyRate! : 1);
  const capacity = (rate: number) => Math.floor((budget / rate) * 1_000_000);
  const low = capacity(Math.max(...rates));
  const high = capacity(Math.min(...rates));
  return Number.isSafeInteger(low) && Number.isSafeInteger(high) ? [low, high] : null;
};
