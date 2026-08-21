import '../initialize';

import { RouterProvider } from 'react-router/dom';

import BootErrorBoundary from '@/components/BootErrorBoundary';
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
      <RouterProvider router={router} />
    </NextThemeProvider>
  </BootErrorBoundary>,
);
