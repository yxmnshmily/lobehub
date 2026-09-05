import '@/spa/initialize';

import { RouterProvider } from 'react-router/dom';

import BootErrorBoundary from '@/components/BootErrorBoundary';
import { TravelSiteShell } from '@/features/TravelSiteNavigation';
import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';
import { createSPABrowserRouter, createSPARoot } from '@/spa/runtime';

import { workbenchRoutes } from './router';

const router = createSPABrowserRouter(workbenchRoutes);

createSPARoot(document.getElementById('root')!).render(
  <BootErrorBoundary>
    <NextThemeProvider>
      <TravelSiteShell>
        <RouterProvider router={router} />
      </TravelSiteShell>
    </NextThemeProvider>
  </BootErrorBoundary>,
);
