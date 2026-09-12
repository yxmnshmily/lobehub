import i18next from 'i18next';
import { describe, expect, it } from 'vitest';

import { displayBranding, displayBrandingPostProcessor } from './displayBranding';

describe('display branding', () => {
  it('brands prose in existing generated content, including Chinese boundaries', () => {
    expect(displayBranding('在LobeHub中搭建；LobeHub Cloud；lobehub 设置')).toBe(
      '在旅游群中搭建；旅游群 Cloud；旅游群 设置',
    );
  });

  it('keeps links, commands, code and external handles usable', () => {
    const technical =
      'https://LobeHub.com/a /lobehub/settings @LobeHub @lobehub/ui `new LobeHub()`\n```ts\nLobeHub.run()\n```';
    expect(displayBranding(technical)).toBe(technical);
    expect(displayBranding('[LobeHub](https://lobehub.com)')).toBe('[旅游群](https://lobehub.com)');
  });

  it('covers bundled, lazy and fallback translations after interpolation', async () => {
    const instance = i18next.createInstance().use(displayBrandingPostProcessor);
    await instance.init({
      lng: 'zh-CN',
      postProcess: ['displayBranding'],
      resources: { 'zh-CN': { translation: { title: '{{brand}} 设置' } } },
    });
    expect(instance.t('title', { brand: 'LobeHub' })).toBe('旅游群 设置');
    instance.addResourceBundle('zh-CN', 'lazy', { title: 'LobeHub Desktop' });
    expect(instance.t('lazy:title')).toBe('旅游群 Desktop');
    expect(instance.t('missing', { defaultValue: 'LobeHub 设置' })).toBe('旅游群 设置');
  });
});
