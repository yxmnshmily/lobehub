import { describe, expect, it } from 'vitest';

import {
  CUSTOMER_CENTER_SECTIONS,
  formatCredits,
  formatCustomerDateTime,
  formatSignedCredits,
  formatTokenCount,
  resolveCustomerCenterSection,
  resolveTotalTokenCount,
} from './model';

describe('CustomerCenter model', () => {
  it('only exposes personal account, balance, billing, and creation sections', () => {
    expect(CUSTOMER_CENTER_SECTIONS).toEqual([
      'account-security',
      'plans',
      'balance-usage',
      'recharge-history',
      'my-creations',
    ]);
  });

  it('accepts only known customer-center section deep links', () => {
    expect(resolveCustomerCenterSection('plans')).toBe('plans');
    expect(resolveCustomerCenterSection('balance-usage')).toBe('balance-usage');
    expect(resolveCustomerCenterSection('my-creations')).toBe('my-creations');
    expect(resolveCustomerCenterSection('private-group')).toBeUndefined();
    expect(resolveCustomerCenterSection('provider')).toBeUndefined();
    expect(resolveCustomerCenterSection('../private-group')).toBeUndefined();
    expect(resolveCustomerCenterSection(null)).toBeUndefined();
  });

  it('keeps customer usage as totals without grouping identifiers', () => {
    expect(resolveTotalTokenCount({ inputTokens: 200, outputTokens: 50, totalTokens: 250 })).toBe(
      250,
    );
    expect(resolveTotalTokenCount({ inputTokens: 200, outputTokens: 50 })).toBe(250);
    expect(resolveTotalTokenCount({ inputTokens: 200 })).toBeUndefined();
  });

  it('formats 积分 as integer units and Token usage as counts', () => {
    expect(formatCredits(12_345, 'en-US')).toBe('12,345');
    expect(formatCredits(12_345.6, 'en-US')).toBe('—');
    expect(formatCredits(Number.MAX_SAFE_INTEGER + 1, 'en-US')).toBe('—');
    expect(formatCredits(Number.NaN, 'en-US')).toBe('—');
    expect(formatCredits(Number.POSITIVE_INFINITY, 'en-US')).toBe('—');
    expect(formatCredits(-1, 'en-US')).toBe('—');
    expect(formatCredits(null, 'en-US')).toBe('—');
    expect(formatTokenCount(12_345, 'en-US')).toBe('12.3K');
    expect(formatTokenCount(5_200_000, 'zh-CN')).toBe('520万');
    expect(formatTokenCount(undefined, 'en-US')).toBe('—');
    expect(formatTokenCount(-1, 'en-US')).toBe('—');
    expect(formatTokenCount(Number.MAX_SAFE_INTEGER + 1, 'en-US')).toBe('—');
    expect(formatSignedCredits(1.5, 'en-US')).toBe('—');
    expect(formatSignedCredits(Number.NEGATIVE_INFINITY, 'en-US')).toBe('—');
    expect(formatCustomerDateTime('not-a-date', 'zh-CN')).toBe('—');
    expect(formatCustomerDateTime('999999999999999999999999', 'zh-CN')).toBe('—');
    expect(
      resolveTotalTokenCount({ inputTokens: 1, outputTokens: 1, totalTokens: -1 }),
    ).toBeUndefined();
    expect(
      resolveTotalTokenCount({
        inputTokens: Number.MAX_SAFE_INTEGER,
        outputTokens: 1,
      }),
    ).toBeUndefined();
  });
});
