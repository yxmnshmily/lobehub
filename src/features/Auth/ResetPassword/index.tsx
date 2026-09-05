'use client';

import { Button } from '@lobehub/ui/base-ui';
import { ChevronLeftIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useSearchParams } from 'react-router';

import { withLobeHubMountPath } from '@/features/Auth/utils/mountedPath';
import AuthCard from '@/features/AuthCard';
import { useAuthServerConfigStore } from '@/features/AuthShell';

import { ResetPasswordContent } from './ResetPasswordContent';

const ResetPasswordPage = () => {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const disableEmailPassword = useAuthServerConfigStore(
    (s) => s.serverConfig.disableEmailPassword || false,
  );
  const token = searchParams.get('token');
  const email = searchParams.get('email');

  if (disableEmailPassword) return <Navigate replace to="/signin" />;

  return (
    <AuthCard
      subtitle={t('betterAuth.resetPassword.description')}
      title={t('betterAuth.resetPassword.title')}
      footer={
        <Button block href={withLobeHubMountPath('/signin')} icon={ChevronLeftIcon} size={'large'}>
          {t('betterAuth.resetPassword.backToSignIn')}
        </Button>
      }
    >
      <ResetPasswordContent
        email={email}
        token={token}
        onSuccessRedirect={(url) => navigate(url)}
      />
    </AuthCard>
  );
};

export default ResetPasswordPage;
