'use client';

import { isDesktop } from '@lobechat/const';
import { Flexbox, FormGroup } from '@lobehub/ui';
import { Divider } from 'antd';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { SettingsProfileRowSkeleton } from '@/components/Skeleton/Settings/Profile';
import SettingHeader from '@/features/Settings/features/SettingHeader';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

import AvatarRow from './features/AvatarRow';
import EmailRow from './features/EmailRow';
import FullNameRow from './features/FullNameRow';
import InterestsRow from './features/InterestsRow';
import PasswordRow from './features/PasswordRow';
import ProfileRow from './features/ProfileRow';
import SSOProvidersList from './features/SSOProvidersList';
import UsernameRow from './features/UsernameRow';

interface ProfileSettingProps {
  showSettingHeader?: boolean;
}

const ProfileSetting = ({ showSettingHeader = true }: ProfileSettingProps) => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const [userProfile, isUserLoaded] = useUserStore((s) => [
    userProfileSelectors.userProfile(s),
    s.isLoaded,
  ]);
  const isLoadedAuthProviders = useUserStore(authSelectors.isLoadedAuthProviders);
  const fetchAuthProviders = useUserStore((s) => s.fetchAuthProviders);
  const disableEmailPassword = useServerConfigStore(serverConfigSelectors.disableEmailPassword);

  // Only the core profile rows (avatar / name / username / email) gate on the
  // user record itself. Auth providers are an independent, slower sub-section
  // that renders its own rows when ready — folding it into one
  // composite gate let a single slow/failed dependency skeleton the whole tab.
  const isLoading = !isUserLoaded;

  useEffect(() => {
    if (isLogin) {
      fetchAuthProviders();
    }
  }, [isLogin, fetchAuthProviders]);

  const { t } = useTranslation('auth');

  return (
    <>
      {showSettingHeader && <SettingHeader title={t('profile.title')} />}
      <FormGroup collapsible={false} gap={16} title={t('profile.account')} variant={'filled'}>
        <Flexbox style={{ display: isLoading ? 'flex' : 'none' }}>
          <SettingsProfileRowSkeleton />
          <Divider style={{ margin: 0 }} />
          <SettingsProfileRowSkeleton />
          <Divider style={{ margin: 0 }} />
          <SettingsProfileRowSkeleton />
          <Divider style={{ margin: 0 }} />
          <SettingsProfileRowSkeleton />
        </Flexbox>
        <Flexbox style={{ display: isLoading ? 'none' : 'flex' }}>
          <AvatarRow />

          <Divider style={{ margin: 0 }} />

          <FullNameRow />

          <Divider style={{ margin: 0 }} />

          <UsernameRow />

          <Divider style={{ margin: 0 }} />

          <InterestsRow />

          {!isDesktop && isLogin && !disableEmailPassword && (
            <>
              <Divider style={{ margin: 0 }} />
              <PasswordRow />
            </>
          )}

          {isLogin && userProfile?.email && (
            <>
              <Divider style={{ margin: 0 }} />
              <EmailRow />
            </>
          )}

          {isLogin && !isDesktop && isLoadedAuthProviders && (
            <>
              <Divider style={{ margin: 0 }} />
              <ProfileRow anchor={'profile-connected-accounts'} label={t('profile.sso.providers')}>
                <SSOProvidersList />
              </ProfileRow>
            </>
          )}
        </Flexbox>
      </FormGroup>
    </>
  );
};

export default ProfileSetting;
