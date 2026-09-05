import '../initialize';

import { RouterProvider } from 'react-router/dom';

import { TravelSiteShell } from '@/features/TravelSiteNavigation';
import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';
import { bootTiming } from '@/libs/bootTiming';
import { createAppRouter } from '@/utils/router';

import { startAppInitialization } from './initialize/bootstrap';
import { mobileRoutes } from './router/mobileRouter.config';
import { createSPARoot } from './runtime';

bootTiming.mark('bundle-eval');
startAppInitialization();

const lobehubMountPath = '/lobehub';
const basename =
  window.location.pathname === lobehubMountPath ||
  window.location.pathname.startsWith(`${lobehubMountPath}/`)
    ? lobehubMountPath
    : undefined;
const router = createAppRouter(mobileRoutes, { basename });

createSPARoot(document.getElementById('root')!).render(
  <NextThemeProvider>
    <TravelSiteShell>
      <RouterProvider router={router} />
    </TravelSiteShell>
  </NextThemeProvider>,
);
