import { describe, expect, it } from 'vitest';

import deepseekModels from '../../../../packages/model-bank/src/aiModels/deepseek';
import { applyBusinessModelPricing } from './useBusinessModelPricing';

it.each([
  ['deepseek-v4-flash', 1, 2, 4, 8, 0.02, 0.04],
  ['deepseek-v4-pro', 1, 2, 4, 8, 0.02, 0.04],
  ['deepseek-v4-flash-vision-exp', 1, 2, 4, 8, 0.02, 0.04],
])(
  'displays both official periods for %s without mutating runtime pricing',
  (model, input, peakInput, output, peakOutput, cache, peakCache) => {
    const pricing = deepseekModels.find((entry) => entry.id === model)!.pricing!;
    const before = structuredClone(pricing);
    const result = applyBusinessModelPricing({
      model: String(model),
      provider: 'deepseek',
      pricing,
    });
    for (const [name, offPeak, peak] of [
      ['textInput', input, peakInput],
      ['textOutput', output, peakOutput],
      ['textInput_cacheRead', cache, peakCache],
    ]) {
      expect(result?.units.find((unit) => unit.name === name)).toMatchObject({
        strategy: 'lookup',
        lookup: { prices: { offPeak, peak } },
      });
    }
    expect(pricing).toEqual(before);
    expect(applyBusinessModelPricing({ model: String(model), provider: 'qwen', pricing })).toBe(
      pricing,
    );
    const custom = { currency: 'CNY' as const, units: [] };
    expect(
      applyBusinessModelPricing({ model: String(model), provider: 'deepseek', pricing: custom }),
    ).toBe(custom);
  },
);

describe('missing model reference pricing', () => {
  it.each([
    ['qwen3.8-max', 12, 36],
    ['kimi/kimi-k3', 20, 100],
    ['ZHIPU/GLM-5.2', 8, 28],
    ['qwen3.7-text-embedding', 0.5, undefined],
  ])('resolves CNY per-million-token rates for %s', (model, input, output) => {
    const result = applyBusinessModelPricing({ model, provider: 'qwen' });
    expect(result?.currency).toBe('CNY');
    expect(result?.units.find((unit) => unit.name === 'textInput')).toEqual({
      name: 'textInput',
      rate: input,
      strategy: 'fixed',
      unit: 'millionTokens',
    });
    expect(result?.units.find((unit) => unit.name === 'textOutput')).toEqual(
      output === undefined
        ? undefined
        : { name: 'textOutput', rate: output, strategy: 'fixed', unit: 'millionTokens' },
    );
  });

  it('preserves configured prices and does not price another provider or unknown model', () => {
    const pricing = { currency: 'USD' as const, units: [] };
    expect(applyBusinessModelPricing({ model: 'qwen3.8-max', provider: 'qwen', pricing })).toBe(
      pricing,
    );
    expect(applyBusinessModelPricing({ model: 'qwen3.8-max', provider: 'custom' })).toBeUndefined();
    expect(applyBusinessModelPricing({ model: 'unknown', provider: 'qwen' })).toBeUndefined();
  });
});
