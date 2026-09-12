import '../initialize';

import { RouterProvider } from 'react-router/dom';

import BootErrorBoundary from '@/components/BootErrorBoundary';
import { TravelSiteShell } from '@/features/TravelSiteNavigation';
import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';
import { bootTiming } from '@/libs/bootTiming';
import { createAppRouter } from '@/utils/router';

import BootShell from './BootShell';
import { isMainLayoutLocation } from './BootShell/routeScope';
import { startAppInitialization } from './initialize/bootstrap';
import { desktopRoutes } from './router/desktopRouter.config';
import { createSPARoot } from './runtime';

bootTiming.mark('bundle-eval');
startAppInitialization();

const debugProxyBase = '/_dangerous_local_dev_proxy';
const lobehubMountPath = '/lobehub';
let basename: string | undefined;
if (window.__DEBUG_PROXY__ || window.location.pathname.startsWith(debugProxyBase)) {
  basename = debugProxyBase;
} else if (
  window.location.pathname === lobehubMountPath ||
  window.location.pathname.startsWith(`${lobehubMountPath}/`)
) {
  basename = lobehubMountPath;
}

const router = createAppRouter(desktopRoutes, { basename });

// Mounting is conditional rather than an early return inside the shell: the hook
// also strips the static logo, and a standalone route needs that logo to stay up
// until its own brand-loading fallback takes over.
const showBootShell = isMainLayoutLocation(desktopRoutes, window.location.pathname, basename);

createSPARoot(document.getElementById('root')!).render(
  <BootErrorBoundary>
    <NextThemeProvider>
      <TravelSiteShell>
        {showBootShell && <BootShell />}
        <RouterProvider router={router} />
      </TravelSiteShell>
    </NextThemeProvider>
  </BootErrorBoundary>,
);

// In-page CSS modifier widget: a floating button that expands/collapses a
// live style editor. The widget script lives in the official website assets
// and is served same-origin (/assets/* -> website), so a classic script tag
// needs no CORS handling and works under every route.
/* CSS 修改器“保存”写出的真实样式文件（lobehub/src/styles/css-modifier-overrides.css），平台直接加载 */
if (!document.getElementById('css-modifier-overrides-link')) {
  const overridesLink = document.createElement('link');
  overridesLink.id = 'css-modifier-overrides-link';
  overridesLink.rel = 'stylesheet';
  overridesLink.href = '/assets/css/css-modifier-overrides.css?v=20260913c';
  document.head.appendChild(overridesLink);
}

if (!document.getElementById('css-modifier-widget-script')) {
  const cssModifierTag = document.createElement('script');
  cssModifierTag.id = 'css-modifier-widget-script';
  /* 版本号防缓存：挂件更新后必须能立即生效 */
  cssModifierTag.src = '/assets/js/css-modifier-widget.js?v=20260913c';
  cssModifierTag.async = true;
  document.head.appendChild(cssModifierTag);
}
