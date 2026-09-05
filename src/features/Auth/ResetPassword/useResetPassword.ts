import { toast } from '@lobehub/ui/base-ui';
import { Form } from 'antd';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { resetPassword } from '@/libs/better-auth/auth-client';

interface ResetPasswordFormValues {
  confirmPassword: string;
  newPassword: string;
}

interface UseResetPasswordParams {
  email: string | null;
  onSuccessRedirect: (url: string) => void;
  token: string | null;
}

const RESET_PASSWORD_TIMEOUT_MS = 15_000;

const resetPasswordWithTimeout = async (payload: Parameters<typeof resetPassword>[0]) => {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('Password reset request timed out'));
    }, RESET_PASSWORD_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      resetPassword({
        ...payload,
        fetchOptions: { signal: controller.signal },
      }),
      timeoutPromise,
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

export const useResetPassword = ({ email, token, onSuccessRedirect }: UseResetPasswordParams) => {
  const { t } = useTranslation('auth');
  const [form] = Form.useForm<ResetPasswordFormValues>();
  const [loading, setLoading] = useState(false);
  const resetInFlight = useRef(false);

  const handleResetPassword = async (values: ResetPasswordFormValues) => {
    if (resetInFlight.current) return;
    if (!token) {
      toast.error(t('betterAuth.resetPassword.invalidToken'));
      return;
    }

    resetInFlight.current = true;
    setLoading(true);
    try {
      const result = await resetPasswordWithTimeout({ newPassword: values.newPassword, token });
      if (result.error) {
        const isInvalidToken = ['INVALID_TOKEN', 'TOKEN_EXPIRED'].includes(result.error.code || '');
        toast.error(
          t(
            isInvalidToken
              ? 'betterAuth.resetPassword.invalidToken'
              : 'betterAuth.resetPassword.error',
          ),
        );
        return;
      }
      toast.success(t('betterAuth.resetPassword.success'));
      const redirectUrl = email ? `/signin?email=${encodeURIComponent(email)}` : '/signin';
      onSuccessRedirect(redirectUrl);
    } catch {
      console.error('Password reset failed');
      toast.error(t('betterAuth.resetPassword.error'));
    } finally {
      resetInFlight.current = false;
      setLoading(false);
    }
  };

  return {
    form,
    handleResetPassword,
    loading,
  };
};
