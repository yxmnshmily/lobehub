import { describe, expect, it } from 'vitest';

import { summarizeGoals } from './goalSummary';

const list = (...statuses: string[]) => statuses.map((status) => ({ goal: { status } as any }));

describe('summarizeGoals', () => {
  it('counts achieved goals as delivered and leaves the rest open', () => {
    const summary = summarizeGoals(list('achieved', 'achieved', 'achieved', 'paused'));

    expect(summary).toEqual({ delivered: 3, pursuing: 1, total: 4 });
  });

  it('does not treat a review gate as a delivery', () => {
    // `review` parks the goal on a person; counting it as delivered hid an open gate,
    // and counting only it (the old behaviour) reported finished goals as open.
    const summary = summarizeGoals(list('review', 'achieved'));

    expect(summary).toEqual({ delivered: 1, pursuing: 1, total: 2 });
  });

  it('keeps failed and canceled goals out of delivered', () => {
    expect(summarizeGoals(list('failed', 'canceled', 'pursuing' as any))).toEqual({
      delivered: 0,
      pursuing: 3,
      total: 3,
    });
  });

  it('summarizes an empty list as zeroes', () => {
    expect(summarizeGoals([])).toEqual({ delivered: 0, pursuing: 0, total: 0 });
  });
});
