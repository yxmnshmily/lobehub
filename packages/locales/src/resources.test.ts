import { describe, expect, it } from 'vitest';

import { localeOptions, locales, matchLocale, normalizeLocale } from './resources';

describe('supported languages', () => {
  it('only offers Simplified Chinese and English', () => {
    expect([...locales]).toEqual(['en-US', 'zh-CN']);
    expect(localeOptions.map((item) => item.value).sort()).toEqual([...locales]);
  });
  it.each(['zh', 'zh-CN', 'zh-TW', 'zh-Hant', 'ZH-hans', 'cn'])(
    'maps %s to Simplified Chinese',
    (locale) => {
      expect(normalizeLocale(locale)).toBe('zh-CN');
    },
  );
  it.each(['en', 'en-US', 'en-GB', 'EN-us'])('maps %s to English', (locale) => {
    expect(normalizeLocale(locale)).toBe('en-US');
  });
  it.each([undefined, 'ar', 'ja-JP', 'de-DE', 'unknown'])(
    'falls back for retired or missing language %s',
    (locale) => {
      expect(matchLocale(locale)).toBeUndefined();
      expect(normalizeLocale(locale)).toBe('en-US');
    },
  );
});
