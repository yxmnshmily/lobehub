import { describe, expect, it } from 'vitest';

import { MOBILE_MODEL_DETAIL_WIDTH } from './styles';

describe('ModelSwitchPanel mobile presentation', () => {
  it('keeps model details within the safe mobile viewport', () => {
    expect(MOBILE_MODEL_DETAIL_WIDTH).toBe(
      'calc(100vw - max(16px, env(safe-area-inset-left)) - max(16px, env(safe-area-inset-right)))',
    );
  });
});
