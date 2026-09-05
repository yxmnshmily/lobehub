'use client';

import { SiDiscord } from '@icons-pack/react-simple-icons';
import { SOCIAL_URL } from '@lobechat/business-const';
import { Flexbox, Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { withLobeHubMountPath } from '@/features/Auth/utils/mountedPath';
import AuthCard from '@/features/AuthCard';

const normalizeErrorCode = (code?: string | null) =>
  (code || 'UNKNOWN').trim().toUpperCase().replaceAll('-', '_');

const AuthErrorPage = memo(() => {
  const { t } = useTranslation('authError');
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');

  const code = normalizeErrorCode(error);
  const description = t(`codes.${code}`, { defaultValue: t('codes.UNKNOWN') });

  return (
    <AuthCard
      subtitle={description}
      title={t('title')}
      footer={
        <Flexbox gap={12} justify="center" wrap="wrap">
          <Button block href={withLobeHubMountPath('/signin')} size={'large'} type="primary">
            {t('actions.retry')}
          </Button>
          <Button block href={'/index.html'} size={'large'}>
            {t('actions.home')}
          </Button>
          <Button
            block
            href={SOCIAL_URL.discord}
            icon={<Icon fill={cssVar.colorText} icon={SiDiscord} />}
            target="_blank"
            type="text"
          >
            {t('actions.discord')}
          </Button>
        </Flexbox>
      }
    />
  );
});

AuthErrorPage.displayName = 'AuthErrorPage';

export default AuthErrorPage;
