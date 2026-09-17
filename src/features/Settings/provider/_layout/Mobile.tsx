'use client';

import { type PropsWithChildren } from 'react';
import { useParams, useSearchParams } from 'react-router';

import ProviderMenu from '../ProviderMenu';

interface LayoutProps extends PropsWithChildren {
  onProviderSelect: (providerKey: string) => void;
}

const Layout = ({ children, onProviderSelect }: LayoutProps) => {
  const [searchParams] = useSearchParams();
  // 路由版入口用 path 参数（/settings/provider/:providerId），旧版用 search 参数。
  const params = useParams<{ providerId?: string }>();
  const provider = searchParams.get('provider') ?? params.providerId;
  return provider === 'all' || !provider ? (
    <ProviderMenu mobile={true} onProviderSelect={onProviderSelect} />
  ) : (
    children
  );
};

export default Layout;
