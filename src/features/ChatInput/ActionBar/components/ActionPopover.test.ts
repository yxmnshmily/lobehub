import { describe, expect, it } from 'vitest';

import { MOBILE_ACTION_POPOVER_WIDTH } from './ActionPopover';

describe('ActionPopover mobile presentation', () => {
  it('keeps a 16px gutter on both sides and respects notched-screen safe areas', () => {
    expect(MOBILE_ACTION_POPOVER_WIDTH).toBe(
      'calc(100vw - max(16px, env(safe-area-inset-left)) - max(16px, env(safe-area-inset-right)))',
    );
  });
});
