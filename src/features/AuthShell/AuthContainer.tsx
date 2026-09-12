'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { Center, Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import { cx } from 'antd-style';
import { type FC, type PropsWithChildren, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { useIsDark } from '@/hooks/useIsDark';

import AuthFooterLinks from './AuthFooterLinks';
import AuthLangButton from './AuthLangButton';
import AuthSessionEntry from './AuthSessionEntry';
import AuthThemeButton from './AuthThemeButton';
import { styles } from './style';

const authRouteTitleKeys: Partial<
  Record<string, 'betterAuth.signin.emailStep.title' | 'betterAuth.signup.title'>
> = {
  '/signin': 'betterAuth.signin.emailStep.title',
  '/signup': 'betterAuth.signup.title',
};

const AuthContainer: FC<PropsWithChildren> = ({ children }) => {
  const isDarkMode = useIsDark();
  const { pathname } = useLocation();
  const { i18n, t } = useTranslation('auth');
  const mountedPath = pathname.replace(/^\/lobehub(?=\/|$)/, '').replace(/\/$/, '') || '/';
  const isGuestEntry = mountedPath === '/signin' || mountedPath === '/signup';

  useEffect(() => {
    const mountedPath = pathname.replace(/^\/lobehub(?=\/|$)/, '').replace(/\/$/, '') || '/';
    const titleKey = authRouteTitleKeys[mountedPath];
    if (titleKey) document.title = `${t(titleKey)} · ${BRANDING_NAME}`;
  }, [pathname, t]);

  return (
    <Flexbox className={styles.outerContainer} height={'100%'} padding={8} width={'100%'}>
      <Flexbox
        height={'100%'}
        width={'100%'}
        className={cx(
          isDarkMode ? styles.innerContainerDark : styles.innerContainerLight,
          styles.touchTargets,
        )}
      >
        <Flexbox aria-hidden horizontal align={'center'} padding={16} width={'100%'} />
        <Center
          flex={1}
          key={i18n.language}
          padding={16}
          style={{ justifyContent: 'safe center', minHeight: 0, overflowY: 'auto' }}
          width={'100%'}
        >
          {isGuestEntry ? (
            <AuthSessionEntry key={mountedPath}>{children}</AuthSessionEntry>
          ) : (
            children
          )}
        </Center>
        <Flexbox horizontal align={'center'} justify={'space-between'} padding={16} width={'100%'}>
          <Flexbox horizontal align={'center'}>
            <AuthLangButton />
            <Divider className={styles.divider} orientation={'vertical'} />
            <AuthThemeButton />
          </Flexbox>
          <AuthFooterLinks />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};

export default AuthContainer;
