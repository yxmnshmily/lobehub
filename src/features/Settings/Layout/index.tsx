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
        flex={1}
        height={'100%'}
      >
        <Flexbox
          className={styles.contentSurface}
          data-settings-content-surface=""
          data-settings-surface="flat"
          height={'100%'}
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
