import { describe, expect, it } from 'vitest';

import { shouldUseMobileToolLayout } from './mobileLayout';

describe('shouldUseMobileToolLayout', () => {
  it.each([
    [true, false, false],
    [false, true, false],
    [false, false, true],
  ])(
    'uses the single-pane tool layout when any mobile signal is active',
    (responsiveMobile, runtimeMobile, viewportMobile) => {
      expect(shouldUseMobileToolLayout(responsiveMobile, runtimeMobile, viewportMobile)).toBe(true);
    },
  );

  it('keeps the desktop master-detail layout when every mobile signal is inactive', () => {
    expect(shouldUseMobileToolLayout(false, false, false)).toBe(false);
  });
});
