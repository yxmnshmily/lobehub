import { describe, expect, it } from 'vitest';

import { genFontFamily, genFontFamilyCode } from './font';

describe('genFontFamily', () => {
  it('puts japanese families ahead of the SC fallback for ja-JP', () => {
    const stack = genFontFamily({ locale: 'ja-JP' });

    expect(stack.indexOf('"Hiragino Sans"')).toBeGreaterThan(-1);
    expect(stack.indexOf('"Hiragino Sans"')).toBeLessThan(stack.indexOf('"HarmonyOS Sans SC"'));
  });

  it('keeps the SC stack first for zh-CN and unknown locales', () => {
    for (const locale of ['zh-CN', 'de-DE', undefined]) {
      const stack = genFontFamily({ locale });

      expect(stack).toContain('"HarmonyOS Sans SC"');
      expect(stack).not.toContain('"PingFang TC"');
      expect(stack).not.toContain('"Hiragino Sans"');
    }
  });

  it('prefers TC families for zh-TW', () => {
    const stack = genFontFamily({ locale: 'zh-TW' });

    expect(stack.indexOf('"PingFang TC"')).toBeLessThan(stack.indexOf('"PingFang SC"'));
  });

  it('keeps an explicit user font first and the env web font behind system fonts', () => {
    const stack = genFontFamily({
      customFontFamily: 'Env Font',
      locale: 'en-US',
      userFontFamily: ' LXGW WenKai ',
    });

    expect(stack.startsWith('"LXGW WenKai",-apple-system,BlinkMacSystemFont')).toBe(true);
    expect(stack.indexOf('"Env Font"')).toBeGreaterThan(stack.indexOf('"Microsoft YaHei"'));
    expect(stack.indexOf('"Env Font"')).toBeLessThan(stack.indexOf('ui-sans-serif'));
  });

  it('leaves an already composed font-family list untouched', () => {
    const stack = genFontFamily({ customFontFamily: 'Foo, "Bar Baz"' });

    expect(stack.startsWith('-apple-system,BlinkMacSystemFont')).toBe(true);
    expect(stack).toContain(',Foo, "Bar Baz",ui-sans-serif');
  });

  it('does not depend on bundled Geist fonts for interface or code text', () => {
    expect(genFontFamily()).not.toContain('Geist');
    expect(genFontFamilyCode()).not.toContain('Geist Mono');
  });
});
