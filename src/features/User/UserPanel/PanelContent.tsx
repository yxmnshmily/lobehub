import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';

import BusinessPanelContent from '@/business/client/features/User/BusinessPanelContent';
import UserPanelAccountSection from '@/business/client/features/User/UserPanelAccountSection';
import UserPanelStatistics from '@/business/client/features/User/UserPanelStatistics';
import UserPanelWorkspaceSection from '@/business/client/features/User/UserPanelWorkspaceSection';
import Menu, { type MenuProps } from '@/components/Menu';
import { isDesktop } from '@/const/version';
import UserInfo from '@/features/User/UserInfo';
import { useSignOut } from '@/hooks/useSignOut';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import UserLoginOrSignup from '../UserLoginOrSignup';
import { useMenu } from './useMenu';

const PanelContent: FC<{ closePopover: () => void }> = ({ closePopover }) => {
  const isLoginWithAuth = useUserStore(authSelectors.isLoginWithAuth);
  const openSignIn = useUserStore((s) => s.openLogin);
  const { mainItems, logoutItems } = useMenu();
  const signOut = useSignOut();

  const handleSignIn = () => {
    openSignIn();
    closePopover();
  };

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    closePopover();

    if (key === 'logout') void signOut();
  };

  return (
    <Flexbox
      gap={2}
      style={{ maxWidth: 'calc(100vw - 32px)', minWidth: 'min(300px, 100%)', width: 300 }}
    >
      {isDesktop || isLoginWithAuth ? (
        <>
          <UserInfo avatarProps={{ clickable: false }} />
          <UserPanelStatistics />
          {isLoginWithAuth && <BusinessPanelContent onNavigate={closePopover} />}
          <UserPanelWorkspaceSection onSwitch={closePopover} />
        </>
      ) : (
        <UserLoginOrSignup onClick={handleSignIn} />
      )}

      <Menu items={[...(mainItems ?? []), ...(logoutItems ?? [])]} onClick={handleMenuClick} />

      <UserPanelAccountSection onNavigate={closePopover} />
    </Flexbox>
  );
};

export default PanelContent;
