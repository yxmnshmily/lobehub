'use client';

import { createStaticStyles } from 'antd-style';
import { useTheme } from 'next-themes';
import { type FC, type PropsWithChildren, useEffect } from 'react';

declare global {
  interface Window {
    __siteShellNavigationOnly?: boolean;
  }
}

const styles = createStaticStyles(({ css }) => ({
  content: css`
    isolation: isolate;

    overflow: hidden;

    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    height: 100%;
    min-height: 0;
    padding-block-start: 72px;

    @media (width >= 1280px) {
      padding-block-start: 80px;
    }
  `,
  shell: css`
    overflow: hidden;

    width: 100%;
    min-width: 0;
    height: 100%;
    min-height: 0;
  `,
}));

const loadSharedScript = (src: string, marker: string) =>
  new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-shared-script="${marker}"]`,
    );
    if (existing?.dataset.loaded === 'true') {
      resolve();
      return;
    }

    const script = existing || document.createElement('script');
    const handleLoad = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', () => reject(new Error(`Unable to load ${src}`)), {
      once: true,
    });
    if (existing) return;

    script.dataset.sharedScript = marker;
    script.src = src;
    document.head.appendChild(script);
  });

const TravelSiteNavigationBridge: FC = () => {
  const { resolvedTheme, setTheme, theme } = useTheme();
  const currentTheme = resolvedTheme || theme;

  useEffect(() => {
    if (currentTheme !== 'dark' && currentTheme !== 'light') return;
    const isLight = currentTheme === 'light';
    document.documentElement.classList.toggle('theme-light', isLight);
    document.body.classList.toggle('theme-light', isLight);
    const themeToggle = document.querySelector<HTMLElement>('.theme-toggle');
    if (themeToggle) {
      const label = isLight ? '切换为黑色主题' : '切换为白色主题';
      themeToggle.setAttribute('aria-label', label);
      themeToggle.setAttribute('title', label);
    }
    try {
      window.localStorage.setItem('techarin-color-theme', currentTheme);
    } catch {
      // The shared header still follows the active page theme without storage.
    }
  }, [currentTheme]);

  useEffect(() => {
    const syncLobeHubTheme = (event: Event) => {
      const nextTheme = (event as CustomEvent<{ theme?: string }>).detail?.theme;
      if (nextTheme === 'dark' || nextTheme === 'light') setTheme(nextTheme);
    };
    window.addEventListener('site-theme-change', syncLobeHubTheme);
    return () => window.removeEventListener('site-theme-change', syncLobeHubTheme);
  }, [setTheme]);

  useEffect(() => {
    window.__siteShellNavigationOnly = true;
    void loadSharedScript(
      '/assets/js/theme-switcher.js?v=20260905-lobehub-shared-shell-2',
      'travel-theme',
    )
      .then(() =>
        loadSharedScript(
          '/assets/js/modules/site-share.js?v=20260905-lobehub-shared-shell-2',
          'travel-site-share',
        ),
      )
      .then(() =>
        loadSharedScript(
          '/assets/js/site-shell.js?v=20260905-lobehub-shared-shell-3',
          'travel-site-shell',
        ),
      )
      .catch((error) => console.error('[Travel Site Shell]', error));
  }, []);

  return (
    <header
      aria-label="旅游群全站导航"
      data-site-shell-header=""
      data-site-shell-navigation-only=""
    />
  );
};

export const TravelSiteShell: FC<PropsWithChildren> = ({ children }) => (
  <div className={styles.shell}>
    <TravelSiteNavigationBridge />
    <main className={styles.content} id="main-content">
      {children}
    </main>
  </div>
);

export default TravelSiteNavigationBridge;
