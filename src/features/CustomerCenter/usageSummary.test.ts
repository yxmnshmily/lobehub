import { describe, expect, it } from 'vitest';

import { summarizeRecordedUsage } from './usageSummary';

describe('summarizeRecordedUsage', () => {
  it('sums measured values without treating missing fields as zero', () => {
    expect(
      summarizeRecordedUsage([
        { inputTokens: 100, outputTokens: 25, totalTokens: 125 },
        { inputTokens: 200, outputTokens: null, totalTokens: null },
      ]),
    ).toEqual({ inputTokens: 300, outputTokens: 25, totalTokens: 125 });
  });
  it('distinguishes a recorded zero from no measurements', () => {
    expect(summarizeRecordedUsage([])).toEqual({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });
    expect(
      summarizeRecordedUsage([{ inputTokens: 0, outputTokens: null, totalTokens: null }]),
    ).toEqual({ inputTokens: 0, outputTokens: null, totalTokens: null });
  });
  it('ignores invalid measurements', () => {
    expect(
      summarizeRecordedUsage([{ inputTokens: -1, outputTokens: NaN, totalTokens: Infinity }]),
    ).toEqual({ inputTokens: null, outputTokens: null, totalTokens: null });
  });
});
