import type { Pricing } from 'model-bank';
import deepseekModels from 'model-bank/deepseek';

/** Default official prices only. Custom quotes and other providers remain untouched. */
export const resolveDeepseekPricing = (
  model: string | undefined,
  provider: string | undefined,
  pricing: Pricing | undefined,
  at?: Date,
): Pricing | undefined => {
  const base =
    provider === 'deepseek'
      ? deepseekModels.find((entry) => entry.id === model)?.pricing
      : undefined;
  if (
    !base ||
    (pricing &&
      (pricing.currency !== base.currency ||
        pricing.units.length !== base.units.length ||
        !pricing.units.every((unit) =>
          base.units.some(
            (original) =>
              unit.name === original.name &&
              unit.unit === original.unit &&
              unit.strategy === 'fixed' &&
              original.strategy === 'fixed' &&
              unit.rate === original.rate,
          ),
        )))
  )
    return pricing;

  // https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ — checked 2026-09-07.
  // Beijing weekdays 09:00–12:00 and 14:00–18:00. Freeze at admission, not settlement.
  const beijing = at && new Date(at.getTime() + 8 * 60 * 60 * 1000);
  if (beijing && !Number.isFinite(beijing.getTime())) return undefined;
  const hour = beijing?.getUTCHours() ?? 0;
  const day = beijing?.getUTCDay() ?? 0;
  const peak = day >= 1 && day <= 5 && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18));

  return {
    ...base,
    units: base.units.map((unit) => {
      if (unit.strategy !== 'fixed') return unit;
      return at
        ? { ...unit, rate: unit.rate * (peak ? 2 : 1) }
        : {
            name: unit.name,
            unit: unit.unit,
            strategy: 'lookup',
            lookup: {
              pricingParams: ['billingPeriod'],
              prices: { offPeak: unit.rate, peak: unit.rate * 2 },
            },
          };
    }),
  };
};
