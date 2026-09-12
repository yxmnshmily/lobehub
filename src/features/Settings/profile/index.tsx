'use client';

import { isDesktop } from '@lobechat/const';
import { Flexbox, FormGroup } from '@lobehub/ui';
import { Alert, Button, Text, toast } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import { CircleUserRound } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { SettingsProfileRowSkeleton } from '@/components/Skeleton/Settings/Profile';
import SettingHeader from '@/features/Settings/features/SettingHeader';
import { useSession } from '@/libs/better-auth/auth-client';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

import AvatarRow from './features/AvatarRow';
import EmailRow from './features/EmailRow';
import FullNameRow from './features/FullNameRow';
import PasswordRow from './features/PasswordRow';
import PhoneRow from './features/PhoneRow';
import ProfileRow from './features/ProfileRow';
import SSOProvidersList from './features/SSOProvidersList';

interface ProfileSettingProps {
  showSettingHeader?: boolean;
}

const ProfileSetting = ({ showSettingHeader = true }: ProfileSettingProps) => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const [userProfile, isUserLoaded] = useUserStore((s) => [
    userProfileSelectors.userProfile(s),
    s.isLoaded,
  ]);
  const fetchAuthProviders = useUserStore((s) => s.fetchAuthProviders);
  const hasWechatAccount = useUserStore(
    (s) => s.authProviders?.some((p) => p.provider === 'wechat') ?? false,
  );
  const session = useSession();
  const isWechatAccount = hasWechatAccount || userProfile?.email?.endsWith('@wechat.lobehub');
  const needsWechatProfile =
    !session.isPending &&
    isWechatAccount &&
    (!userProfile?.fullName?.trim() || !session.data?.user.phoneNumber);
  const disableEmailPassword = useServerConfigStore(serverConfigSelectors.disableEmailPassword);

  // Only the core profile rows (avatar / name / user ID / email) gate on the
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
      <FormGroup
        collapsible={false}
        gap={16}
        variant={'filled'}
        title={
          <Flexbox horizontal align="center" gap={8}>
            <CircleUserRound aria-hidden size={20} />
            {t('profile.account')}
          </Flexbox>
        }
      >
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
          {isLogin && needsWechatProfile && (
            <Alert
              style={{ marginBottom: 16 }}
              title={t('profile.wechatCompleteProfile')}
              type="info"
            />
          )}
          <AvatarRow />

          <Divider style={{ margin: 0 }} />

          <FullNameRow />

          <Divider style={{ margin: 0 }} />

          <ProfileRow
            anchor="profile-user-id"
            label={t('profile.userId')}
            action={
              userProfile?.id ? (
                <Button
                  size="small"
                  type="default"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(userProfile.id);
                      toast.success(t('copySuccess', { ns: 'common' }));
                    } catch {
                      toast.error(t('copyFail', { ns: 'common' }));
                    }
                  }}
                >
                  {t('copy', { ns: 'common' })}
                </Button>
              ) : undefined
            }
          >
            <Text style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{userProfile?.id || '—'}</Text>
          </ProfileRow>

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

          {isLogin && !isDesktop && (
            <>
              <Divider style={{ margin: 0 }} />
              <PhoneRow />
            </>
          )}

          {isLogin && !isDesktop && (
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
