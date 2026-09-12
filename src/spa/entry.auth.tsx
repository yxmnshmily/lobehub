import '../initialize';

import { RouterProvider } from 'react-router/dom';

import BootErrorBoundary from '@/components/BootErrorBoundary';
import { TravelSiteShell } from '@/features/TravelSiteNavigation';
import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';

import { authRoutes } from './router/authRouter.config';
import { createSPABrowserRouter, createSPARoot } from './runtime';

const lobehubMountPath = '/lobehub';
const basename =
  window.location.pathname === lobehubMountPath ||
  window.location.pathname.startsWith(`${lobehubMountPath}/`)
    ? lobehubMountPath
    : undefined;
const router = createSPABrowserRouter(authRoutes, { basename });

createSPARoot(document.getElementById('root')!).render(
  <BootErrorBoundary>
    <NextThemeProvider>
      <TravelSiteShell>
        <RouterProvider router={router} />
      </TravelSiteShell>
    </NextThemeProvider>
  </BootErrorBoundary>,
);

// In-page CSS modifier widget on auth pages too (same asset as entry.web).
if (!document.getElementById('css-modifier-widget-script')) {
  const cssModifierTag = document.createElement('script');
  cssModifierTag.id = 'css-modifier-widget-script';
  cssModifierTag.src = '/assets/js/css-modifier-widget.js?v=20260913c';
  cssModifierTag.async = true;
  document.head.appendChild(cssModifierTag);
}
