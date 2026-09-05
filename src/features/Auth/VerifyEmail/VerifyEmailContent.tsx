import { Block, Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { Input } from 'antd';
import { RefreshCw } from 'lucide-react';
import { useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useVerifyEmail } from './useVerifyEmail';

interface VerifyEmailContentProps {
  callbackUrl: string;
  email: string | null;
}

export const VerifyEmailContent = ({ email, callbackUrl }: VerifyEmailContentProps) => {
  const { t } = useTranslation('auth');
  const [otp, setOtp] = useState('');
  const {
    emailResendSeconds,
    handleRequestOtp,
    handleResendEmail,
    handleVerifyOtp,
    mode,
    otpResendSeconds,
    requestingOtp,
    resending,
    setMode,
    verifyingOtp,
  } = useVerifyEmail({ callbackUrl, email });

  useLayoutEffect(() => {
    setOtp('');
  }, [callbackUrl, email]);

  if (mode === 'otp') {
    return (
      <Flexbox gap={16}>
        <Block padding={24}>
          <Flexbox gap={12}>
            <Text align={'center'}>{t('betterAuth.verifyEmail.otp.description')}</Text>
            <Input
              aria-label={t('betterAuth.verifyEmail.otp.inputLabel')}
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              placeholder={t('betterAuth.verifyEmail.otp.placeholder')}
              size="large"
              value={otp}
              onChange={(event) => setOtp(event.target.value.replaceAll(/\D/g, '').slice(0, 6))}
              onPressEnter={() => void handleVerifyOtp(otp)}
            />
          </Flexbox>
        </Block>
        <Button
          disabled={otp.length !== 6}
          loading={verifyingOtp}
          size="large"
          type="primary"
          onClick={() => void handleVerifyOtp(otp)}
        >
          {t('betterAuth.verifyEmail.otp.submit')}
        </Button>
        <Button
          disabled={otpResendSeconds > 0}
          icon={<RefreshCw size={16} />}
          loading={requestingOtp}
          size="large"
          type="default"
          onClick={() => void handleRequestOtp()}
        >
          {otpResendSeconds > 0
            ? t('betterAuth.verifyEmail.otp.resend', { seconds: otpResendSeconds })
            : t('betterAuth.verifyEmail.otp.resendReady')}
        </Button>
        <Button size="large" type="text" onClick={() => setMode('link')}>
          {t('betterAuth.verifyEmail.otp.useLink')}
        </Button>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={16}>
      <Block padding={24}>
        <Text align={'center'}>{t('betterAuth.verifyEmail.checkSpam')}</Text>
      </Block>
      <Button
        disabled={emailResendSeconds > 0}
        icon={<RefreshCw size={16} />}
        loading={resending}
        size="large"
        type="default"
        onClick={handleResendEmail}
      >
        {t('betterAuth.verifyEmail.resend.button')}
      </Button>
      <Button
        loading={requestingOtp}
        size="large"
        type="text"
        onClick={() => void handleRequestOtp()}
      >
        {t('betterAuth.verifyEmail.otp.useCode')}
      </Button>
    </Flexbox>
  );
};
