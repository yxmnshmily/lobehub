import { renderToStaticMarkup } from 'react-dom/server';
import useSWR, { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';

import EmojiPicker from './index';

vi.mock('@/store/global', () => ({ useGlobalStore: () => 'zh-CN' }));
vi.mock('@lobehub/ui', () => ({
  EmojiPicker: ({ locale }: { locale: string }) => {
    const { data } = useSWR<{ search: string }>(locale, () => {
      throw new Error('Unresolvable browser package import');
    });
    return <span>{data?.search}</span>;
  },
}));

describe('emoji locale loading', () => {
  it('supplies bundled Chinese data inside a suspense-enabled route without dynamic imports', () => {
    expect(() =>
      renderToStaticMarkup(
        <SWRConfig value={{ suspense: true }}>
          <EmojiPicker />
        </SWRConfig>,
      ),
    ).not.toThrow();
    expect(renderToStaticMarkup(<EmojiPicker />)).toContain('搜索');
  });
});
