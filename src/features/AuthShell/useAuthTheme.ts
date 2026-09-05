'use client';

import { useTheme as useNextThemesTheme } from 'next-themes';
import { useLayoutEffect, useRef } from 'react';

const WEBSITE_THEME_STORAGE_KEY = 'techarin-color-theme';

export type AuthThemeMode = 'dark' | 'light';

export const useAuthTheme = () => {
  const { setTheme, theme } = useNextThemesTheme();
  const hasSyncedWebsiteTheme = useRef(false);

  useLayoutEffect(() => {
    if (hasSyncedWebsiteTheme.current) return;
    hasSyncedWebsiteTheme.current = true;

    let websiteTheme: AuthThemeMode = 'light';
    try {
      if (window.localStorage.getItem(WEBSITE_THEME_STORAGE_KEY) === 'dark') {
        websiteTheme = 'dark';
      }
    } catch {
      // The public website also falls back to light when storage is unavailable.
    }
    setTheme(websiteTheme);
  }, [setTheme]);

  const updateTheme = (nextTheme: AuthThemeMode) => {
    try {
      window.localStorage.setItem(WEBSITE_THEME_STORAGE_KEY, nextTheme);
    } catch {
      // The visible theme can still change when browser storage is unavailable.
    }
    setTheme(nextTheme);
  };

  return { theme, updateTheme };
};
