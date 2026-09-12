import { describe, expect, it } from 'vitest';

import { resolveMasonryColumnCount } from './useMasonryColumnCount';

describe('resolveMasonryColumnCount', () => {
  it('keeps mobile resource cards in two columns even when the outer window is wide', () => {
    expect(resolveMasonryColumnCount(1200, true)).toBe(2);
  });

  it('uses one column on very narrow phones so touch actions cannot overlap', () => {
    expect(resolveMasonryColumnCount(320, true)).toBe(1);
  });

  it.each([
    [375, 2],
    [900, 3],
    [1200, 4],
    [1600, 5],
  ])('maps a %ipx desktop viewport to %i columns', (width, expected) => {
    expect(resolveMasonryColumnCount(width, false)).toBe(expected);
  });
});
