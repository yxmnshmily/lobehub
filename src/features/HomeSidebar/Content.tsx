import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import GroupSwitcher from '@/features/SuperGroup/GroupSwitcher';
import { SuperGroupSidebarBody } from '@/features/SuperGroup/JoinedGroupSidebar';
import { useMyTravelGroupReadiness } from '@/hooks/useMyTravelGroupReadiness';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import Body from './Body';
import { AgentModalProvider } from './Body/Agent/ModalProvider';
import Header from './Header';

const HomeSidebarContent = () => {
  const workspace = useActiveWorkspaceSlug();
  const { groupId } = useMyTravelGroupReadiness({ manageLifecycle: false });
  const expanded = useGlobalStore(systemStatusSelectors.showLeftPanel);

  if (!workspace) {
    return (
      <SideBarLayout
        body={
          groupId ? (
            <SuperGroupSidebarBody manageDefaultGroup groupId={groupId} />
          ) : (
            <GroupSwitcher compact={!expanded} />
          )
        }
      />
    );
  }

  return (
    <AgentModalProvider>
      <SideBarLayout body={<Body />} header={<Header />} />
    </AgentModalProvider>
  );
};

export default HomeSidebarContent;
