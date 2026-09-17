'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { Outlet } from 'react-router';

import { useActiveNavKey } from '@/features/NavPanel/useActiveNavKey';
import SideBar from '@/features/Settings/Layout/SideBar';
import { RouteSkeletonChromeProvider } from '@/spa/router/routeSkeletonChrome';

import SettingsContextProvider from './ContextProvider';
import { styles } from './style';

const Layout: FC = () => {
  const isDataCenter = useActiveNavKey() === 'data-center';
  return (
    <SettingsContextProvider
      value={{
        showOpenAIApiKey: true,
        showOpenAIProxyUrl: true,
      }}
    >
      {!isDataCenter && <SideBar />}
      <Flexbox
        className={styles.mainContainer}
        data-settings-desktop-layout="a"
        style={{
          /* 网站式滚动：纵向滚动由 DesktopLayoutContainer 框架承担（滚动条
             贴窗口右缘）。本层纯文档流、高度随内容长高——不能有 flex/height
             锁，否则内容被压在视口高度里，框架永远"看不到"溢出。 */
          minHeight: '100%',
          width: '100%',
        }}
      >
        <Flexbox
          className={styles.contentSurface}
          data-settings-content-surface=""
          data-settings-surface="flat"
          style={{ flex: '0 0 auto', minHeight: '100%', width: '100%' }}
        >
          <RouteSkeletonChromeProvider>
            <Outlet />
          </RouteSkeletonChromeProvider>
        </Flexbox>
      </Flexbox>
    </SettingsContextProvider>
  );
};

export default Layout;
