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
