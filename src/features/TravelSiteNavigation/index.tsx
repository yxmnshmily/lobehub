'use client';

import { createGlobalStyle, createStaticStyles } from 'antd-style';
import { useTheme } from 'next-themes';
import { type FC, type PropsWithChildren, useEffect, useState } from 'react';

declare global {
  interface Window {
    __siteShellNavigationOnly?: boolean;
  }
}

const styles = createStaticStyles(({ css }) => ({
  content: css`
    /* Keep app portals in the header's stacking context: dialogs must cover it. */
    overflow: hidden;

    box-sizing: border-box;
    width: min(100%, var(--site-shell-max-width, 100rem));
    min-width: 0;
    height: 100%;
    min-height: 0;
    margin-inline: auto;
    padding-block-start: 72px;
    /* Share the header's symmetric gutters, including when the sidebar is collapsed. */
    padding-inline: var(--site-shell-gutter, 16px);

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

const DialogBounds = createGlobalStyle`
  body:has([data-site-shell-header]) {
    --site-dialog-top: 84px;
    --site-dialog-height: calc(100dvh - var(--site-dialog-top) - 16px);

    /* The theme's inline isolation traps its portal host below the sibling header.
       Only release the outer app; nested theme/modal stacking stays intact. */
    #main-content > .ant-app {
      isolation: auto !important;
    }

    /* Anchored popovers also use role=dialog; their position belongs to the anchor. */
    & :is([role='dialog'], [role='alertdialog']):not([data-side]):has(> div[style*='max-width']) {
      inset-block: var(--site-dialog-top) 16px !important;
    }

    & :is([role='dialog'], [role='alertdialog']):not([data-side]) > div[style*='max-width'] {
      width: min(960px, calc(100vw - 32px));
      max-height: var(--site-dialog-height) !important;
    }

    .ant-modal-wrap {
      inset-block: var(--site-dialog-top) 16px;
    }

    .ant-modal {
      inset-block-start: 0;
      max-width: calc(100vw - 32px);
      padding-block-end: 0;
    }

    .ant-modal-content {
      overflow: hidden;
      display: flex;
      flex-direction: column;
      max-height: var(--site-dialog-height);
    }

    .ant-modal-body {
      overflow-y: auto;
      min-height: 0;
    }

    @media (width >= 1280px) {
      --site-dialog-top: 92px;
    }
  }
`;

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
        loadSharedScript('/assets/js/site-shell.js?v=20260907-centered-shell', 'travel-site-shell'),
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

export const TravelSiteShell: FC<PropsWithChildren> = ({ children }) => {
  // Keep this frame free of a second site header even after the original Home
  // composer navigates to its conversation. Do not interrupt the active send.
  const [embedded] = useState(() => /\/embed\/home\/?$/.test(window.location.pathname));

  return (
    <div className={styles.shell}>
      {!embedded && <DialogBounds />}
      {!embedded && <TravelSiteNavigationBridge />}
      <main className={embedded ? styles.shell : styles.content} id="main-content">
        {children}
      </main>
    </div>
  );
};

export default TravelSiteNavigationBridge;
