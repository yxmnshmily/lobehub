import type { Pricing } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { estimateCreditTokens, estimateTokenCredits } from './estimateCreditTokens';

it('converts measured input and output separately, then adds their credit costs', () => {
  const pricing: Pricing = {
    currency: 'USD',
    units: [
      { name: 'textInput', unit: 'millionTokens', strategy: 'fixed', rate: 2 },
      { name: 'textOutput', unit: 'millionTokens', strategy: 'fixed', rate: 8 },
    ],
  };
  expect(estimateTokenCredits(1000, 500, pricing)).toEqual([6000, 6000]);
  expect(estimateTokenCredits(1000, 0, pricing)).toEqual([2000, 2000]);
  expect(estimateTokenCredits(null, 500, pricing)).toBeNull();
  expect(estimateTokenCredits(1000, 500, undefined)).toBeNull();
  expect(estimateTokenCredits(0, 0, pricing)).toEqual([0, 0]);
});

it('converts CNY price bands to credit bands without treating missing prices as free', () => {
  const pricing: Pricing = {
    currency: 'CNY',
    units: [
      {
        name: 'textInput',
        unit: 'millionTokens',
        strategy: 'lookup',
        lookup: { pricingParams: ['period'], prices: { low: 7.12, high: 14.24 } },
      },
    ],
  };
  expect(estimateTokenCredits(1000, 0, pricing, 7.12)).toEqual([1000, 2000]);
  expect(estimateTokenCredits(1000, 0, pricing, 3.56)).toEqual([2000, 4000]);
  expect(estimateTokenCredits(1000, 0, pricing)).toBeNull();
  expect(estimateTokenCredits(1000, 1, pricing)).toBeNull();
});

describe('credit token capacity estimate', () => {
  it('uses model cost, not one credit per token', () => {
    const pricing: Pricing = {
      currency: 'USD',
      units: [
        { name: 'textInput', unit: 'millionTokens', strategy: 'fixed', rate: 2 },
        { name: 'textOutput', unit: 'millionTokens', strategy: 'fixed', rate: 8 },
      ],
    };
    expect(estimateCreditTokens(5_847_518, pricing, 'textInput')).toEqual([2_923_759, 2_923_759]);
    expect(estimateCreditTokens(5_847_518, pricing, 'textOutput')).toEqual([730_939, 730_939]);
  });

  it('uses the runtime CNY conversion and returns expensive-to-cheap capacity bounds', () => {
    const pricing: Pricing = {
      currency: 'CNY',
      units: [
        {
          name: 'textInput',
          unit: 'millionTokens',
          strategy: 'lookup',
          lookup: { pricingParams: ['billingPeriod'], prices: { offPeak: 1.5, peak: 3 } },
        },
      ],
    };
    expect(estimateCreditTokens(3_000_000, pricing, 'textInput', 7)).toEqual([
      7_000_000, 14_000_000,
    ]);
    expect(estimateCreditTokens(3_000_000, pricing, 'textInput', 6)).toEqual([
      6_000_000, 12_000_000,
    ]);
    expect(estimateCreditTokens(0, pricing, 'textInput', 7)).toEqual([0, 0]);
    expect(estimateCreditTokens(3_000_000, pricing, 'textInput')).toBeNull();
  });

  it('does not invent capacity from missing, free, invalid, or non-token pricing', () => {
    expect(estimateCreditTokens(100, undefined, 'textInput')).toBeNull();
    for (const rate of [0, -1, NaN, Infinity]) {
      expect(
        estimateCreditTokens(
          100,
          {
            currency: 'USD',
            units: [{ name: 'textInput', unit: 'millionTokens', strategy: 'fixed', rate }],
          },
          'textInput',
        ),
      ).toBeNull();
    }
    const pricing: Pricing = {
      currency: 'USD',
      units: [{ name: 'textInput', unit: 'millionCharacters', strategy: 'fixed', rate: 2 }],
    };
    expect(estimateCreditTokens(100, pricing, 'textInput')).toBeNull();
    expect(estimateCreditTokens(-1, pricing, 'textInput')).toBeNull();
  });
});
