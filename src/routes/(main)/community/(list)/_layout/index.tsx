import { Flexbox } from '@lobehub/ui';
import { useResponsive } from 'antd-style';
import { Outlet } from 'react-router';

import WideScreenContainer from '@/features/WideScreenContainer';
import { RouteSkeletonChromeProvider } from '@/spa/router/routeSkeletonChrome';

import { MAX_WIDTH } from '../../features/const';
import Footer from './Footer';
import Header from './Header';
import { styles } from './style';

const Layout = () => {
  /* minWidth(1440) 只在桌面（≥768px）生效：窄屏下这个 1440px 内容块配合
     WideScreenContainer 的 align-self: center 会把左半边（含分类列表的
     图标和文字）推到视口外，只剩计数徽章可见。 */
  const { md = true } = useResponsive();

  return (
    <>
      <Header />
      <Flexbox className={styles.mainContainer} height={'100%'} width={'100%'}>
        <WideScreenContainer
          className={styles.contentContainer}
          gap={16}
          minWidth={md ? MAX_WIDTH : undefined}
          style={{ paddingBottom: 'var(--community-list-page-padding-block-end)' }}
          wrapperStyle={{
            minHeight: '100%',
            position: 'relative',
          }}
        >
          <Flexbox className={styles.contentWrapper} data-community-list-content="" gap={16}>
            <RouteSkeletonChromeProvider>
              <Outlet />
            </RouteSkeletonChromeProvider>
          </Flexbox>
          <Footer />
        </WideScreenContainer>
      </Flexbox>
    </>
  );
};

export default Layout;
