import en from '@emoji-mart/data/i18n/en.json';
import zh from '@emoji-mart/data/i18n/zh.json';
import { type EmojiPickerProps } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { lazy, memo, Suspense } from 'react';
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

// @lobehub/ui's EmojiPicker bundles the emoji-mart dataset (~600 KB); load it
// on mount so the picker never sits inside a route's static closure.
const LobeEmojiPicker = lazy(() => import('@lobehub/ui/es/EmojiPicker/index'));

export const EmojiPicker = memo<EmojiPickerProps>(({ shape = 'square', ...rest }) => {
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);
  const size = rest.size ?? 40;

  return (
    <Suspense fallback={<Skeleton height={size} width={size} />}>
      <SWRConfig value={localeConfig}>
        <LobeEmojiPicker
          shape={shape}
          {...rest}
          defaultAvatar={null as any}
          locale={locale === 'zh-CN' ? 'zh-CN' : 'en-US'}
        />
      </SWRConfig>
    </Suspense>
  );
});

export default EmojiPicker;
