import en from '@emoji-mart/data/i18n/en.json';
import zh from '@emoji-mart/data/i18n/zh.json';
import { type EmojiPickerProps } from '@lobehub/ui';
import { EmojiPicker as LobeEmojiPicker } from '@lobehub/ui';
import { memo } from 'react';
import { SWRConfig } from 'swr';

import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';

// The upstream picker uses a vite-ignored package import. Supply bundled locale
// data in an isolated cache so route suspense cannot trigger that browser import.
const localeConfig = {
  fallback: { 'en-US': en, 'zh-CN': zh },
  provider: () => new Map(),
  revalidateIfStale: false,
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
};

export const EmojiPicker = memo<EmojiPickerProps>(({ shape = 'square', ...rest }) => {
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);

  return (
    <SWRConfig value={localeConfig}>
      <LobeEmojiPicker
        shape={shape}
        {...rest}
        defaultAvatar={null as any}
        locale={locale === 'zh-CN' ? 'zh-CN' : 'en-US'}
      />
    </SWRConfig>
  );
});

export default EmojiPicker;
