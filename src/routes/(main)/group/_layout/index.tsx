import { Flexbox } from '@lobehub/ui';
import { type FC, Suspense } from 'react';
import { Outlet, useLocation, useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import SurfaceSkeleton from '@/components/Skeleton/Surface';
import { isDesktop } from '@/const/version';
import { GroupNotFound, GroupNotFoundGuard } from '@/features/GroupNotFound';
import ProtocolUrlHandler from '@/features/ProtocolUrlHandler';
import JoinedGroupSidebar, {
  SuperGroupSidebarBody,
} from '@/features/SuperGroup/JoinedGroupSidebar';
import MemberProfile from '@/features/SuperGroup/MemberProfile';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useServerConfigStore } from '@/store/serverConfig';

import MemberConversation from '../features/MemberConversation';
import GroupIdSync from './GroupIdSync';
import MobileSidebar from './MobileSidebar';
import MobileTopics from './MobileTopics';
import RegisterHotkeys from './RegisterHotkeys';
import Sidebar from './Sidebar';
import { styles } from './style';
import { useGroupRouteAccess } from './useGroupRouteAccess';

const Layout: FC = () => {
  const { gid } = useParams<{ gid?: string }>();
  const { pathname } = useLocation();
  const access = useGroupRouteAccess();
  const narrowViewport = useIsMobile();
  const isMobile =
    (useServerConfigStore((state) => state.isMobile) ??
      (typeof __MOBILE__ !== 'undefined' ? __MOBILE__ : false)) ||
    narrowViewport;
  const memberSidebarGroupId =
    access.kind === 'member'
      ? access.group.groupId
      : access.kind === 'loading'
        ? access.memberSidebarGroupId
        : undefined;
  const showDesktopControls = !isMobile && !memberSidebarGroupId;

  let content;
  if (access.kind === 'loading') {
    content = <SurfaceSkeleton variant={'detail'} />;
  } else if (access.kind === 'error') {
    content = <AsyncError error={access.error} variant={'page'} onRetry={access.retry} />;
  } else if (access.kind === 'unavailable') {
    content = <GroupNotFound />;
  } else if (access.kind === 'member') {
    const routedChild =
      /\/group\/[^/]+\/(?:permission|members|topics|projects?|goals?|tasks?)(?:\/|$)/.test(
        pathname,
      );
    const memberProfile = /\/group\/[^/]+\/profile(?:\/|$)/.test(pathname);
    content = routedChild ? (
      <Suspense fallback={<SurfaceSkeleton variant="detail" />}>
        <Outlet />
      </Suspense>
    ) : memberProfile ? (
      <MemberProfile group={access.group} showDesktopSidebar={false} />
    ) : (
      <MemberConversation
        group={access.group}
        showDesktopSidebar={false}
        onUnavailable={access.markUnavailable}
      />
    );
  } else if (gid) {
    content = (
      <GroupNotFoundGuard>
        <Suspense fallback={<SurfaceSkeleton variant="detail" />}>
          <Outlet />
        </Suspense>
      </GroupNotFoundGuard>
    );
  }

  const conversation = (
    <Flexbox
      className={styles.mainContainer}
      flex={1}
      height="100%"
      style={{ minWidth: 0 }}
      width="100%"
    >
      {content}
    </Flexbox>
  );

  return (
    <>
      {!isMobile && memberSidebarGroupId && <JoinedGroupSidebar groupId={memberSidebarGroupId} />}
      {showDesktopControls && <Sidebar />}
      {isMobile && (access.kind === 'owner' || memberSidebarGroupId) ? (
        <MobileSidebar
          key={gid}
          sidebar={
            memberSidebarGroupId ? (
              <SuperGroupSidebarBody groupId={memberSidebarGroupId} />
            ) : undefined
          }
        >
          {conversation}
        </MobileSidebar>
      ) : (
        conversation
      )}
      {showDesktopControls && <RegisterHotkeys />}
      {isMobile && access.kind === 'owner' && <MobileTopics />}
      {isDesktop && access.kind !== 'member' && <ProtocolUrlHandler />}
      <GroupIdSync />
    </>
  );
};

export default Layout;
