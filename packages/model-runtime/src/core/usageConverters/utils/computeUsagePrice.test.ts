import { describe, expect, it } from 'vitest';

import { computeUsagePrice } from './computeUsagePrice';

describe('decimal usage cost', () => {
  it.each([
    [0.4, 6, 1, 1, 2400000],
    [0.1, 6, 1, 1, 600000],
    [0.07, 3, 1, 1, 210000],
    [7.12, 3, 1, 7.12, 3000000],
    [0.000123, 1, 1, 1, 123],
    [0.0001234, 1, 1, 1, 124],
    [1e-8, 10, 1, 1, 1],
    [2, 300000, 1000000, 7.12, 84270],
  ])('rounds price %s × usage %s only once', (rate, quantity, scale, fx, credits) => {
    expect(computeUsagePrice(rate, quantity, scale, fx)?.totalCredits).toBe(credits);
  });
  it('preserves zero usage and the unrounded USD cost for a fractional credit', () => {
    expect(computeUsagePrice(1, 0)).toEqual({ totalCost: 0, totalCredits: 0 });
    expect(computeUsagePrice(0.0001234, 1)).toEqual({ totalCost: 0.0001234, totalCredits: 124 });
  });
  it('rejects invalid rates, divisors and unsafe credit totals', () => {
    expect(computeUsagePrice(NaN, 1)).toBeUndefined();
    expect(computeUsagePrice(-1, 1)).toBeUndefined();
    expect(computeUsagePrice(1, 1, 0)).toBeUndefined();
    expect(computeUsagePrice(1, 1, 1, 0)).toBeUndefined();
    expect(computeUsagePrice(Number.MAX_SAFE_INTEGER, 1)).toBeUndefined();
  });
});
