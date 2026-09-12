import { RouterProvider } from 'react-router/dom';

import BootErrorBoundary from '@/components/BootErrorBoundary';
import { TravelSiteShell } from '@/features/TravelSiteNavigation';
import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';
import { createSPABrowserRouter, createSPARoot } from '@/spa/runtime';

import { shareRoutes } from './router';

const mountPath = '/lobehub';
const basename =
  window.location.pathname === mountPath || window.location.pathname.startsWith(`${mountPath}/`)
    ? mountPath
    : undefined;
const router = createSPABrowserRouter(shareRoutes, { basename });

createSPARoot(document.getElementById('root')!).render(
  <BootErrorBoundary>
    <NextThemeProvider>
      <TravelSiteShell>
        <RouterProvider router={router} />
      </TravelSiteShell>
    </NextThemeProvider>
  </BootErrorBoundary>,
);
