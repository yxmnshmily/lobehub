'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { Button } from '@lobehub/ui/base-ui';
import { ChevronLeftIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { resolveAuthCallbackPath, withLobeHubMountPath } from '@/features/Auth/utils/mountedPath';
import AuthCard from '@/features/AuthCard';
import { useSession } from '@/libs/better-auth/auth-client';

import { VerifyEmailContent } from './VerifyEmailContent';

const VerifyEmailPage = () => {
  const { t } = useTranslation('auth');
  const { data: session, isPending: isSessionPending } = useSession();
  const [searchParams] = useSearchParams();
  const email = searchParams.get('email');
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const continueUrl = resolveAuthCallbackPath(callbackUrl);
  const signInUrl = withLobeHubMountPath('/signin');
  const errorCode = searchParams.get('error')?.trim().toUpperCase();
  const isAlreadyVerified =
    errorCode === 'EMAIL_ALREADY_VERIFIED' && session?.user.emailVerified === true;
  const isExpired = ['INVALID_TOKEN', 'INVALID_VERIFICATION_TOKEN', 'TOKEN_EXPIRED'].includes(
    errorCode || '',
  );
  const hasClaimedSuccess = searchParams.get('status') === 'success' && !errorCode;
  const isSuccess = hasClaimedSuccess && session?.user.emailVerified === true;
  const hasUntrustedSuccess = hasClaimedSuccess && !isSessionPending && !isSuccess;

  if (isSuccess || isAlreadyVerified) {
    return (
      <AuthCard
        footer={
          <Button block href={continueUrl} size={'large'} type="primary">
            {t('betterAuth.verifyEmail.success.continue')}
          </Button>
        }
        subtitle={t(
          isAlreadyVerified
            ? 'betterAuth.verifyEmail.alreadyVerified.description'
            : 'betterAuth.verifyEmail.success.description',
          { appName: BRANDING_NAME },
        )}
        title={t(
          isAlreadyVerified
            ? 'betterAuth.verifyEmail.alreadyVerified.title'
            : 'betterAuth.verifyEmail.success.title',
        )}
      />
    );
  }

  if (isExpired) {
    return (
      <AuthCard
        subtitle={t('betterAuth.verifyEmail.expired.description')}
        title={t('betterAuth.verifyEmail.expired.title')}
        footer={
          <Button block href={signInUrl} icon={ChevronLeftIcon} size={'large'}>
            {t('betterAuth.verifyEmail.backToSignIn')}
          </Button>
        }
      >
        {email && <VerifyEmailContent callbackUrl={callbackUrl} email={email} />}
      </AuthCard>
    );
  }

  if (errorCode || hasUntrustedSuccess) {
    return (
      <AuthCard
        subtitle={t('betterAuth.verifyEmail.error.description')}
        title={t('betterAuth.verifyEmail.error.title')}
        footer={
          <Button block href={signInUrl} icon={ChevronLeftIcon} size={'large'}>
            {t('betterAuth.verifyEmail.backToSignIn')}
          </Button>
        }
      />
    );
  }

  if (!email) {
    return (
      <AuthCard
        subtitle={t('betterAuth.verifyEmail.error.description')}
        title={t('betterAuth.verifyEmail.error.title')}
        footer={
          <Button block href={signInUrl} icon={ChevronLeftIcon} size={'large'}>
            {t('betterAuth.verifyEmail.backToSignIn')}
          </Button>
        }
      />
    );
  }

  return (
    <AuthCard
      subtitle={t('betterAuth.verifyEmail.description', { email })}
      title={t('betterAuth.verifyEmail.title')}
      footer={
        <Button block href={signInUrl} icon={ChevronLeftIcon} size={'large'}>
          {t('betterAuth.verifyEmail.backToSignIn')}
        </Button>
      }
    >
      <VerifyEmailContent callbackUrl={callbackUrl} email={email} />
    </AuthCard>
  );
};

export default VerifyEmailPage;
