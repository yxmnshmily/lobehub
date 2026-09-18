'use client';

import { createGlobalStyle, createStaticStyles, cx } from 'antd-style';
import { useTheme } from 'next-themes';
import { type FC, type PropsWithChildren, useEffect, useState } from 'react';

import { useServerConfigStore } from '@/store/serverConfig';

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

    /* 2026-09-18：手机端去掉左右边距（用户要求，仅移动端；桌面保持留白）。 */
    @media (width <= 767px) {
      padding-inline: 0;
    }

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
  /* 页面主体宽度锁定：外部注入的内联宽度（如浏览器缓存的 CSS 修改器脚本
     写入 #main-content 的固定 440px）不能挤压布局——主体自适应铺满。 */
  #main-content {
    width: 100% !important;
    max-width: 100% !important;
  }

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
    /* 2026-09-17 修复制作平台右侧"竖带"：共享 shell 注入的 site-navigation.css 带
       html { scrollbar-gutter: stable }（官网为防栏目切换时滚动条占位翻转布局而设）。
       本平台滚动发生在内部容器，html 永不滚动，stable 的预留位只会变成视口右侧一条
       谁也选不中的背景竖带。加载共享脚本前先在 html 上打标记，CSS 用 :not 排除本平台；
       同步设置保证 CSS 注入时属性已就位，不会闪。卸载时移除，恢复官网行为。 */
    document.documentElement.setAttribute('data-travel-shell-embed', '');
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

    return () => {
      document.documentElement.removeAttribute('data-travel-shell-embed');
    };
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
  /* 手机端按服务端设备变体（User-Agent）判定，而非视口宽度——窄窗口的桌面
     浏览器要保持桌面留白（2026-09-18）。 */
  const [mobileVariant] = useState(() => Boolean(useServerConfigStore.getState().isMobile));

  return (
    <div className={styles.shell}>
      {!embedded && <DialogBounds />}
      {!embedded && <TravelSiteNavigationBridge />}
      <main
        id="main-content"
        className={cx(
          embedded ? styles.shell : styles.content,
          !embedded && mobileVariant && styles.contentMobile,
        )}
      >
        {children}
      </main>
    </div>
  );
};

export default TravelSiteNavigationBridge;
