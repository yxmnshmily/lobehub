'use client';

import { Flexbox } from '@lobehub/ui';
import { useResponsive } from 'antd-style';
import { memo } from 'react';
import { Outlet, useParams } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import DesktopLayoutContainer from './_layout/Desktop/Container';
import MobileLayout from './_layout/Mobile';
import ProviderDetailPageComponent from './detail';
import ProviderMenu from './ProviderMenu';

// Layout component that wraps provider pages with navigation
export const ProviderLayout = memo(() => {
  const navigate = useWorkspaceAwareNavigate();
  /* 注意：antd-style 的 `mobile` 键 = xs（<576px），太窄。这里与设置页其它
     响应式规则同一口径：宽度 <768px（!md，低于 iPad mini 竖屏）即移动布局。 */
  const { md = true } = useResponsive();
  const isMobileViewport = !md;

  const handleProviderSelect = (providerKey: string) => {
    navigate(`/settings/provider/${providerKey}`);
  };

  /* 手机宽度（<768px）走单栏布局：provider=all 显示服务商列表，选中后整屏
     切换详情。之前路由固定渲染桌面双栏（左 280px 列表 + 右详情），窄屏下
     右栏被挤成竖缝、底部横向滚动条小到无法点击。 */
  if (isMobileViewport) {
    return (
      <MobileLayout onProviderSelect={handleProviderSelect}>
        <DesktopLayoutContainer>
          <Outlet />
        </DesktopLayoutContainer>
      </MobileLayout>
    );
  }

  return (
    <Flexbox
      horizontal
      width={'100%'}
      style={{
        maxHeight: '100%',
      }}
    >
      <ProviderMenu mobile={false} onProviderSelect={handleProviderSelect} />
      <DesktopLayoutContainer>
        <Outlet />
      </DesktopLayoutContainer>
    </Flexbox>
  );
});

ProviderLayout.displayName = 'ProviderLayout';

// Detail page component that receives providerId from route params
export const ProviderDetailPage = memo(() => {
  const params = useParams<{ providerId: string }>();
  const navigate = useWorkspaceAwareNavigate();

  const handleProviderSelect = (providerKey: string) => {
    navigate(`/settings/provider/${providerKey}`);
  };

  return (
    <ProviderDetailPageComponent
      id={params.providerId ?? ''}
      onProviderSelect={handleProviderSelect}
    />
  );
});

ProviderDetailPage.displayName = 'ProviderDetailPage';

// Default export for backward compatibility (used by SettingsContent)
type ProviderPageType = {
  mobile?: boolean;
};

const ProviderPage = (props: ProviderPageType) => {
  const { mobile } = props;

  // For mobile or when used via SettingsContent, use the old Page component
  // This is a fallback for non-router usage
  const OldPage = require('./(list)').default;
  return <OldPage mobile={mobile} />;
};

export default ProviderPage;
