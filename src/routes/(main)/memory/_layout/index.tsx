'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { Outlet } from 'react-router';
import { SWRConfig } from 'swr';

import SuspenseRouteBoundary from '@/components/SuspenseRouteBoundary';
import { RouteSkeletonChromeProvider } from '@/spa/router/routeSkeletonChrome';

import Sidebar from './Sidebar';
import Nav from './Sidebar/Header/Nav';
import { styles } from './style';

const DesktopMemoryLayout: FC = () => {
  return (
    <>
      <Sidebar />
      <Flexbox className={styles.mainContainer} flex={1} height={'100%'}>
        <div className={styles.contentLayout}>
          <aside className={styles.navigation} data-memory-navigation="">
            <Nav horizontal />
          </aside>
          <Flexbox
            flex={1}
            /* This module has no outer gutter, so the page keeps the whole
               48px cushion itself — same value on every memory tab
               (identity / contexts / preferences / experiences / activities). */
            style={{ minHeight: 0, minWidth: 0, overflow: 'hidden', padding: 48 }}
          >
            <SWRConfig value={{ suspense: true }}>
              <SuspenseRouteBoundary>
                <RouteSkeletonChromeProvider>
                  <Outlet />
                </RouteSkeletonChromeProvider>
              </SuspenseRouteBoundary>
            </SWRConfig>
          </Flexbox>
        </div>
      </Flexbox>
    </>
  );
};

export default DesktopMemoryLayout;
