import { describe, expect, it } from 'vitest';

import { resolveImageSinglePrice } from './resolveImageSinglePrice';

describe('image selector USD prices', () => {
  it('converts a CNY per-image price before handing it to USD consumers', () => {
    expect(
      resolveImageSinglePrice({
        currency: 'CNY',
        units: [{ name: 'imageGeneration', strategy: 'fixed', unit: 'image', rate: 0.06 }],
      }).price,
    ).toBeCloseTo(0.008426966292134831, 14);
  });

  it('keeps explicitly USD approximate prices unchanged even with a CNY catalog', () => {
    expect(
      resolveImageSinglePrice({
        currency: 'CNY',
        approximatePricePerImage: 0.1,
        units: [],
      }),
    ).toEqual({ approximatePrice: 0.1 });
  });

  it('converts CNY megapixel prices and does not guess an unresolved lookup', () => {
    expect(
      resolveImageSinglePrice({
        currency: 'CNY',
        units: [{ name: 'imageGeneration', strategy: 'fixed', unit: 'megapixel', rate: 7.12 }],
      }).approximatePrice,
    ).toBeCloseTo(1.048576);
    expect(
      resolveImageSinglePrice({
        units: [{ name: 'imageGeneration', strategy: 'fixed', unit: 'megapixel', rate: 1 }],
      }).price,
    ).toBeUndefined();
    expect(
      resolveImageSinglePrice({
        units: [
          {
            name: 'imageGeneration',
            strategy: 'lookup',
            unit: 'image',
            lookup: { pricingParams: ['size'], prices: { large: 1 } },
          },
        ],
      }),
    ).toEqual({});
  });
});
