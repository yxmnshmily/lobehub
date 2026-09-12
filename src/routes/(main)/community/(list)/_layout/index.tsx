import { Flexbox } from '@lobehub/ui';
import { Outlet } from 'react-router';
import { SWRConfig } from 'swr';

import SuspenseRouteBoundary from '@/components/SuspenseRouteBoundary';
import WideScreenContainer from '@/features/WideScreenContainer';
import { RouteSkeletonChromeProvider } from '@/spa/router/routeSkeletonChrome';

import { MAX_WIDTH } from '../../features/const';
import Footer from './Footer';
import Header from './Header';
import { styles } from './style';

const Layout = () => {
  return (
    <>
      <Header />
      <Flexbox className={styles.mainContainer} height={'100%'} width={'100%'}>
        <WideScreenContainer
          className={styles.contentContainer}
          gap={16}
          minWidth={MAX_WIDTH}
          style={{ paddingBottom: 'var(--community-list-page-padding-block-end)' }}
          wrapperStyle={{
            minHeight: '100%',
            position: 'relative',
          }}
        >
          <Flexbox className={styles.contentWrapper} data-community-list-content="" gap={16}>
            <SWRConfig value={{ suspense: true }}>
              <SuspenseRouteBoundary>
                <RouteSkeletonChromeProvider>
                  <Outlet />
                </RouteSkeletonChromeProvider>
              </SuspenseRouteBoundary>
            </SWRConfig>
          </Flexbox>
          <Footer />
        </WideScreenContainer>
      </Flexbox>
    </>
  );
};

export default Layout;
