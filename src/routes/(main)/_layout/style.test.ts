import { describe, expect, it } from 'vitest';

import { resolveMainContainerHeight } from './style';

describe('resolveMainContainerHeight', () => {
  it.each([
    [{ desktop: false, showCloudPromotion: false }, '100%'],
    [{ desktop: false, showCloudPromotion: true }, 'calc(100% - 40px)'],
    [{ desktop: true, showCloudPromotion: false }, 'calc(100% - 28px)'],
    [{ desktop: true, showCloudPromotion: true }, 'calc(100% - 68px)'],
  ])('reserves every visible shell row for %o', (options, expected) => {
    expect(
      resolveMainContainerHeight({
        ...options,
        bannerHeight: 40,
        titleBarHeight: 28,
      }),
    ).toBe(expected);
  });
});
