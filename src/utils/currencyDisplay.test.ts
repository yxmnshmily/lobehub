import { describe, expect, it } from 'vitest';

import { displayCny, displayMoney, exchangeMonth, nextExchangeMonthAt } from './currencyDisplay';

describe('RMB display conversion', () => {
  it('keeps original-currency prices visible while the exchange quote is unavailable', () => {
    expect(displayMoney(99, 'CNY', 'zh-CN', 0)).toBe('¥99.00');
    expect(displayMoney(1, 'USD', 'en-US', 0)).toBe('$1.00');
    expect(displayMoney(1, 'USD', 'zh-CN', 0)).toBe('—');
  });
  it('follows language and converts in both directions without converting CNY twice', () => {
    expect(displayMoney(1, 'USD', 'zh-CN', 7)).toBe('¥7.00');
    expect(displayMoney(1, 'USD', 'en-US', 7)).toBe('$1.00');
    expect(displayMoney(7, 'CNY', 'en-US', 7)).toBe('$1.00');
    expect(displayMoney(7, 'CNY', 'zh-TW', 7)).toBe('¥7.00');
    expect(displayMoney(0.0001, 'USD', 'zh-CN', 7, 6)).toBe('¥0.0007');
  });
  it('preserves unsupported currencies and rejects invalid values', () => {
    expect(displayMoney(1, 'EUR', 'zh-CN', 7)).toBe('€1.00');
    expect(displayMoney(undefined, 'USD', 'en-US', 7)).toBe('—');
    expect(displayMoney(1, 'CNY', 'en-US', 0)).toBe('—');
  });
  it('converts dollars without rounding the input first', () => {
    expect(displayCny(0.14, 6.711)).toBe('¥0.94');
    expect(displayCny(0.0001, 6.711, 6)).toBe('¥0.000671');
    expect(displayCny(-1, 6.711)).toBe('-¥6.71');
  });
  it('does not present unavailable cost as zero', () => {
    expect(displayCny(undefined, 6.711)).toBe('—');
    expect(displayCny(NaN, 6.711)).toBe('—');
    expect(displayCny(0, 6.711)).toBe('¥0.00');
  });
  it('changes the effective month at Beijing midnight', () => {
    expect(exchangeMonth(new Date('2026-09-30T15:59:59Z'))).toBe('2026-09');
    expect(exchangeMonth(new Date('2026-09-30T16:00:00Z'))).toBe('2026-10');
  });
  it('schedules the next calendar month across leap February and the year boundary', () => {
    expect(new Date(nextExchangeMonthAt(new Date('2028-02-01T00:00:00+08:00'))).toISOString()).toBe(
      '2028-02-29T16:00:00.000Z',
    );
    expect(new Date(nextExchangeMonthAt(new Date('2026-12-01T00:00:00+08:00'))).toISOString()).toBe(
      '2026-12-31T16:00:00.000Z',
    );
  });
});
