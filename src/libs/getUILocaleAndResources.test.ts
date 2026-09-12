import { describe, expect, it, vi } from 'vitest';

import { getUILocaleAndResources } from './getUILocaleAndResources';

const translateFromUILocaleResources = (
  resources: Record<string, Record<string, string>>,
  key: string,
) => Object.assign({}, ...Object.values(resources))[key];

describe('getUILocaleAndResources', () => {
  it('should return zh-CN locale and zhCn resources for zh-CN', async () => {
    const result = await getUILocaleAndResources('zh-CN');
    expect(result.locale).toBe('zh-CN');
    expect(result.resources).toBeDefined();
  });

  it('should normalize business ui.json into a @lobehub/ui consumable resource map', async () => {
    const result = await getUILocaleAndResources('zh-CN');

    expect(translateFromUILocaleResources(result.resources, 'form.submit')).toBe('提交');
  });

  it('should merge built-in resources with partial business ui.json resources', async () => {
    const result = await getUILocaleAndResources('zh-CN');

    expect(translateFromUILocaleResources(result.resources, 'image.copy')).toBe('复制');
    expect(translateFromUILocaleResources(result.resources, 'hotkey.clear')).toBe('清除绑定');
    expect(translateFromUILocaleResources(result.resources, 'form.submit')).toBe('提交');
  });

  it('falls back to English resources for a retired language', async () => {
    const result = await getUILocaleAndResources('de-DE');

    expect(result.locale).toBe('en-US');
    expect(translateFromUILocaleResources(result.resources, 'image.copy')).toBe('Copy');
    expect(translateFromUILocaleResources(result.resources, 'hotkey.clear')).toBe('Clear binding');
    expect(translateFromUILocaleResources(result.resources, 'common.empty')).toBe('(empty)');
    expect(translateFromUILocaleResources(result.resources, 'form.submit')).toBe('Submit');
  });

  it('should return zh-CN locale and zhCn resources for zh-TW', async () => {
    const result = await getUILocaleAndResources('zh-TW');
    expect(result.locale).toBe('zh-CN');
    expect(result.resources).toBeDefined();
  });

  it('should return en-US locale and en resources for en-US', async () => {
    const result = await getUILocaleAndResources('en-US');
    expect(result.locale).toBe('en-US');
    expect(result.resources).toBeDefined();
  });

  it('should return en-US locale and en resources for en', async () => {
    const result = await getUILocaleAndResources('en');
    expect(result.locale).toBe('en-US');
    expect(result.resources).toBeDefined();
  });

  it('should resolve auto from the current document language', async () => {
    const previousLang = document.documentElement.lang;
    document.documentElement.lang = 'zh-CN';

    try {
      const result = await getUILocaleAndResources('auto');

      expect(result.locale).toBe('zh-CN');
      expect(translateFromUILocaleResources(result.resources, 'form.submit')).toBe('提交');
    } finally {
      document.documentElement.lang = previousLang;
    }
  });

  it('falls back to English for ar', async () => {
    const result = await getUILocaleAndResources('ar');
    expect(result.locale).toBe('en-US');
    expect(result.resources).toBeDefined();
  });

  it('falls back to English for de-DE', async () => {
    const result = await getUILocaleAndResources('de-DE');
    expect(result.locale).toBe('en-US');
    expect(result.resources).toBeDefined();
  });

  it('falls back to English for es-ES', async () => {
    const result = await getUILocaleAndResources('es-ES');
    expect(result.locale).toBe('en-US');
    expect(result.resources).toBeDefined();
  });

  it('should fallback to @lobehub/ui builtin resources if business ui.json is missing', async () => {
    vi.resetModules();
    vi.doMock('@/../locales/en-US/ui.json', () => ({ default: null }));

    const { getUILocaleAndResources: getWithFallback } = await import('./getUILocaleAndResources');
    const result = await getWithFallback('unknown-locale');
    expect(result.locale).toBe('en-US');
    expect(result.resources).toBeDefined();
  });
});
