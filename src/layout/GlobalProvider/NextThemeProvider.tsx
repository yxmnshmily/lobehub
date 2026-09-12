'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { type ReactNode } from 'react';

interface NextThemeProviderProps {
  children: ReactNode;
}

/**
 * The site shell (website/assets/js/theme-switcher.js) stores the user's choice
 * under this key. The app must start from the same source: with
 * `defaultTheme="system"` a dark OS plus a light site shell renders a dark
 * surface while the shell has already switched text to dark — producing
 * dark-on-dark text that is unreadable.
 */
const SHELL_THEME_KEY = 'techarin-color-theme';

const getInitialTheme = (): string => {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(SHELL_THEME_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // localStorage unavailable (private mode) — fall back to the system theme.
  }
  return 'system';
};

export default function NextThemeProvider({ children }: NextThemeProviderProps) {
  return (
    <NextThemesProvider
      disableTransitionOnChange
      enableSystem
      attribute="data-theme"
      defaultTheme={getInitialTheme()}
      forcedTheme={undefined}
    >
      {children}
    </NextThemesProvider>
  );
}
