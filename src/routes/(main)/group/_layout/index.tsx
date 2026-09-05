import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { Outlet, useParams } from 'react-router';
import { SWRConfig } from 'swr';

import AsyncError from '@/components/AsyncError';
import SurfaceSkeleton from '@/components/Skeleton/Surface';
import SuspenseRouteBoundary from '@/components/SuspenseRouteBoundary';
import { isDesktop } from '@/const/version';
import { GroupNotFound, GroupNotFoundGuard } from '@/features/GroupNotFound';
import ProtocolUrlHandler from '@/features/ProtocolUrlHandler';
import { useServerConfigStore } from '@/store/serverConfig';

import MemberConversation from '../features/MemberConversation';
import GroupIdSync from './GroupIdSync';
import MobileTopics from './MobileTopics';
import RegisterHotkeys from './RegisterHotkeys';
import Sidebar from './Sidebar';
import { styles } from './style';
import { useGroupRouteAccess } from './useGroupRouteAccess';

const Layout: FC = () => {
  const { gid } = useParams<{ gid?: string }>();
  const access = useGroupRouteAccess();
  const isMobile =
    useServerConfigStore((state) => state.isMobile) ??
    (typeof __MOBILE__ !== 'undefined' ? __MOBILE__ : false);
  const showDesktopControls = !isMobile && access.kind !== 'member';

  let content;
  if (access.kind === 'loading') {
    content = <SurfaceSkeleton variant={'detail'} />;
  } else if (access.kind === 'error') {
    content = <AsyncError error={access.error} variant={'page'} onRetry={access.retry} />;
  } else if (access.kind === 'unavailable') {
    content = <GroupNotFound />;
  } else if (access.kind === 'member') {
    content = <MemberConversation group={access.group} onUnavailable={access.markUnavailable} />;
  } else if (gid) {
    content = (
      <GroupNotFoundGuard>
        <SWRConfig value={{ suspense: true }}>
          <SuspenseRouteBoundary>
            <Outlet />
          </SuspenseRouteBoundary>
        </SWRConfig>
      </GroupNotFoundGuard>
    );
  }

  return (
    <>
      {showDesktopControls && <Sidebar />}
      <Flexbox
        className={styles.mainContainer}
        flex={1}
        height={'100%'}
        style={{ minWidth: 0 }}
        width={'100%'}
      >
        {/* Keep the sidebar interactive while the routed group is loading or unavailable. */}
        {content}
      </Flexbox>
      {showDesktopControls && <RegisterHotkeys />}
      {isMobile && access.kind === 'owner' && <MobileTopics />}
      {isDesktop && access.kind !== 'member' && <ProtocolUrlHandler />}
      <GroupIdSync />
    </>
  );
};

export default Layout;
