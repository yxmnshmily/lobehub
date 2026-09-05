import { describe, expect, it } from 'vitest';

import {
  buildPlatformImageSettlementIdentity,
  PLATFORM_IMAGE_SETTLEMENT_GENERATION_TYPE,
} from './platformImageSettlementIdentity';

describe('platform image settlement identity', () => {
  it('uses the same immutable generation identity for reservation, settlement and access', () => {
    expect(buildPlatformImageSettlementIdentity('generation-1')).toEqual({
      generationId: 'generation-1',
      generationType: PLATFORM_IMAGE_SETTLEMENT_GENERATION_TYPE,
    });
    expect(PLATFORM_IMAGE_SETTLEMENT_GENERATION_TYPE).toBe('platform-image-generation');
  });
});
