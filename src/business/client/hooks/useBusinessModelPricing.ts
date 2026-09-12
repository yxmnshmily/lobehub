import { resolveDeepseekPricing } from '@lobechat/utils/deepseekPricing';
import type { Pricing } from 'model-bank';

export interface BusinessModelPricingParams {
  model?: string;
  pricing?: Pricing;
  provider?: string;
}

// Public Beijing-region reference prices, checked 2026-09-06. Display only;
// never use these fallbacks to settle credits or replace a configured price.
// https://help.aliyun.com/zh/model-studio/model-pricing
// https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api/
const referenceRates: Record<string, { input: number; output?: number }> = {
  'qwen3.8-max': { input: 12, output: 36 },
  'kimi/kimi-k3': { input: 20, output: 100 },
  'ZHIPU/GLM-5.2': { input: 8, output: 28 },
  'qwen3.7-text-embedding': { input: 0.5 },
};

export const applyBusinessModelPricing = ({
  model,
  pricing,
  provider,
}: BusinessModelPricingParams): Pricing | undefined => {
  const timedPricing = resolveDeepseekPricing(model, provider, pricing);
  if (timedPricing !== pricing) return timedPricing;
  if (pricing != null || provider !== 'qwen' || !model) return pricing;
  const rate = Object.hasOwn(referenceRates, model) ? referenceRates[model] : undefined;
  if (!rate) return undefined;
  return {
    currency: 'CNY',
    units: [
      { name: 'textInput', rate: rate.input, strategy: 'fixed', unit: 'millionTokens' },
      ...(rate.output === undefined
        ? []
        : [
            {
              name: 'textOutput' as const,
              rate: rate.output,
              strategy: 'fixed' as const,
              unit: 'millionTokens' as const,
            },
          ]),
    ],
  };
};

export const useBusinessModelPricing = () => applyBusinessModelPricing;

export const useBusinessModelPricingPrefetch = () => {};
