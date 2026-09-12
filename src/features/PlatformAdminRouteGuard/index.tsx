'use client';

import type { PropsWithChildren, ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import BrandTextLoading from '@/components/Loading/BrandTextLoading';
import { lambdaQuery } from '@/libs/trpc/client';

import {
  isCustomerMainRoutePath,
  resolveCustomerMainRouteAccess,
  resolvePlatformAdminRouteAccess,
} from './access';

const PlatformAdminRouteGuard = ({ children }: PropsWithChildren) => {
  const { data: isPlatformAdmin, isLoading } =
    lambdaQuery.platformAccess.isPlatformAdmin.useQuery();

  const access = resolvePlatformAdminRouteAccess({ isLoading, isPlatformAdmin });
  if (access === 'loading') return <BrandTextLoading debugId="platform-admin-route" />;
  if (access === 'redirect') return <Navigate replace to="/settings/profile" />;

  return children;
};

export default PlatformAdminRouteGuard;

export const platformAdminElement = (element: ReactNode) => (
  <PlatformAdminRouteGuard>{element}</PlatformAdminRouteGuard>
);

export const CustomerMainRouteGuard = ({ children }: PropsWithChildren) => {
  const { pathname, search } = useLocation();
  const { data: isPlatformAdmin, isLoading } = lambdaQuery.platformAccess.isPlatformAdmin.useQuery(
    undefined,
    {
      enabled: !isCustomerMainRoutePath(pathname, search),
    },
  );

  const access = resolveCustomerMainRouteAccess({ isLoading, isPlatformAdmin, pathname, search });
  if (access === 'loading') return <BrandTextLoading debugId="customer-main-route" />;
  if (access === 'redirect') return <Navigate replace to="/settings/profile" />;

  return children;
};

export const customerMainElement = (element: ReactNode) => (
  <CustomerMainRouteGuard>{element}</CustomerMainRouteGuard>
);
