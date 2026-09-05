import { toast } from '@lobehub/ui/base-ui';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface ChangePasswordValues {
  confirmPassword: string;
  currentPassword: string;
  newPassword: string;
}

const validatePasswordChange = ({
  confirmPassword,
  currentPassword,
  newPassword,
}: ChangePasswordValues): string | undefined => {
  if (!currentPassword) return 'profile.currentPasswordRequired';
  if (!newPassword) return 'betterAuth.errors.passwordRequired';
  if (newPassword.length < 8) return 'betterAuth.errors.passwordMinLength';
  if (newPassword.length > 64) return 'betterAuth.errors.passwordMaxLength';
  if (!confirmPassword) return 'betterAuth.resetPassword.confirmPasswordRequired';
  if (newPassword !== confirmPassword) return 'betterAuth.errors.passwordMismatch';
};

export const useChangePassword = (onSuccess?: () => void) => {
  const { t } = useTranslation('auth');
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  const clearError = () => setError('');

  const submit = async (values: ChangePasswordValues): Promise<boolean> => {
    if (inFlight.current) return false;

    const validationError = validatePasswordChange(values);
    if (validationError) {
      setError(t(validationError));
      return false;
    }

    inFlight.current = true;
    setChanging(true);
    setError('');
    try {
      const { changePassword } = await import('@/libs/better-auth/auth-client');
      const { error: authError } = await changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        revokeOtherSessions: true,
      });
      if (authError) {
        setError(t('profile.changePasswordError'));
        return false;
      }

      toast.success(t('profile.changePasswordSuccess'));
      onSuccess?.();
      return true;
    } catch {
      setError(t('profile.changePasswordError'));
      return false;
    } finally {
      inFlight.current = false;
      setChanging(false);
    }
  };

  return { changing, clearError, error, submit };
};
