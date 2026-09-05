'use client';

import { ActionIcon } from '@lobehub/ui/base-ui';
import { Moon, Sun } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthTheme } from './useAuthTheme';

const themeIcons = {
  dark: Moon,
  light: Sun,
} as const;

const AuthThemeButton = memo<{ size?: number }>((props) => {
  const { t } = useTranslation('common');
  const { theme, updateTheme } = useAuthTheme();

  return (
    <ActionIcon
      aria-label={t('cmdk.theme')}
      icon={theme === 'dark' ? themeIcons.dark : themeIcons.light}
      size={props.size || { blockSize: 44, size: 20 }}
      onClick={() => updateTheme(theme === 'dark' ? 'light' : 'dark')}
    />
  );
});

AuthThemeButton.displayName = 'AuthThemeButton';

export default AuthThemeButton;
