'use client';

import { ActionIcon } from '@lobehub/ui/base-ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { Moon, Sun } from 'lucide-react';
import { useTheme as useNextThemesTheme } from 'next-themes';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useIsDark } from '@/hooks/useIsDark';

const Header = memo(() => {
  const { setTheme } = useNextThemesTheme();
  const isDark = useIsDark();
  const { t } = useTranslation('common');
  const themeLabel = t(isDark ? 'cmdk.themeLight' : 'cmdk.themeDark');

  return (
    <ChatHeader
      right={
        <ActionIcon
          aria-label={themeLabel}
          icon={isDark ? Moon : Sun}
          size={MOBILE_HEADER_ICON_SIZE}
          title={themeLabel}
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
        />
      }
    />
  );
});

export default Header;
