import { describe, expect, it } from 'vitest';

import { isUserProfileCacheKey } from './MarketAuthProvider';

describe('isUserProfileCacheKey', () => {
  it('matches the discover user profile array key (regression: string-only predicate used to miss it)', () => {
    expect(isUserProfileCacheKey(['discover:userProfile', 'zh-CN', 'yxmnshmily_gHYh2gpb'])).toBe(
      true,
    );
    expect(
      isUserProfileCacheKey(
        ['discover:userProfile', 'zh-CN', 'yxmnshmily_gHYh2gpb'],
        'yxmnshmily_gHYh2gpb',
      ),
    ).toBe(true);
  });

  it('matches the market user profile array key and legacy string keys', () => {
    expect(isUserProfileCacheKey(['market-user-profile', 'yxmnshmily_gHYh2gpb'])).toBe(true);
    expect(isUserProfileCacheKey('user-profile-zh-CN-yxmnshmily_gHYh2gpb')).toBe(true);
  });

  it('rejects unrelated keys and mismatched user names', () => {
    expect(isUserProfileCacheKey(['discover:assistant', 'zh-CN', 'x'])).toBe(false);
    expect(isUserProfileCacheKey(['discover:userProfile', 'zh-CN', 'x'], 'someone-else')).toBe(
      false,
    );
    expect(isUserProfileCacheKey({ not: 'an swr key' })).toBe(false);
  });
});
