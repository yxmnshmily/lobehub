'use client';

import { type PropsWithChildren } from 'react';
import { useParams, useSearchParams } from 'react-router';

import DesktopLayoutContainer from '../_layout/Desktop/Container';
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
    /* 列表本身不滚动（overflow 未设），外层 contentSurface 又是 overflow hidden
       ——不包进 DesktopLayoutContainer（内含 overflowY auto 的 SettingContainer）
       列表超高会被直接剪掉，且没有任何滚动条。 */
    <DesktopLayoutContainer>
      <ProviderMenu mobile={true} onProviderSelect={onProviderSelect} />
    </DesktopLayoutContainer>
  ) : (
    children
  );
};

export default Layout;
