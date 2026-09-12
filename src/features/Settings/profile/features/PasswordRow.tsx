'use client';

import { Flexbox, Icon, InputPassword } from '@lobehub/ui';
import { Button, Modal, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { CheckCircle2Icon, XIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

import ProfileRow from './ProfileRow';
import { type ChangePasswordValues, useChangePassword } from './useChangePassword';
import { usePasswordReset } from './usePasswordReset';

const emptyPasswordValues: ChangePasswordValues = {
  confirmPassword: '',
  currentPassword: '',
  newPassword: '',
};

const PasswordRow = () => {
  const { t } = useTranslation('auth');
  const userProfile = useUserStore(userProfileSelectors.userProfile);
  const hasPasswordAccount = useUserStore(authSelectors.hasPasswordAccount);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [passwordValues, setPasswordValues] = useState(emptyPasswordValues);
  const { requestReset, sending, sent } = usePasswordReset(userProfile?.email);
  const { changing, clearError, error, submit } = useChangePassword(() => {
    setChangePasswordOpen(false);
    setPasswordValues(emptyPasswordValues);
  });

  const openChangePassword = () => {
    clearError();
    setPasswordValues(emptyPasswordValues);
    setChangePasswordOpen(true);
  };

  const closeChangePassword = () => {
    if (changing) return;
    clearError();
    setPasswordValues(emptyPasswordValues);
    setChangePasswordOpen(false);
  };

  const updatePasswordValue = (key: keyof ChangePasswordValues, value: string) => {
    clearError();
    setPasswordValues((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit(passwordValues);
  };

  return (
    <ProfileRow
      anchor={'profile-password'}
      label={t('profile.password')}
      action={
        <Button
          loading={hasPasswordAccount ? false : sending}
          size="small"
          onClick={hasPasswordAccount ? openChangePassword : requestReset}
        >
          {sent
            ? t('betterAuth.signin.emailSent.resend')
            : hasPasswordAccount
              ? t('profile.changePassword')
              : t('profile.setPassword')}
        </Button>
      }
    >
      {!sent && <Text>********</Text>}
      {sent && (
        <Flexbox horizontal align={'center'} gap={6}>
          <Icon color={cssVar.colorSuccess} icon={CheckCircle2Icon} size={14} />
          <Text fontSize={12} type={'secondary'}>
            {t('profile.resetPasswordSent', { email: userProfile?.email })}
          </Text>
        </Flexbox>
      )}
      <Modal
        centered
        destroyOnHidden
        closeIcon={<XIcon aria-label={t('close', { ns: 'common' })} role="img" size={16} />}
        footer={null}
        maskClosable={!changing}
        open={changePasswordOpen}
        title={t('profile.changePassword')}
        width={420}
        onCancel={closeChangePassword}
      >
        <form onSubmit={handleSubmit}>
          <Flexbox gap={12}>
            <InputPassword
              autoFocus
              aria-label={t('profile.currentPassword')}
              autoComplete="current-password"
              placeholder={t('profile.currentPassword')}
              value={passwordValues.currentPassword}
              onChange={(event) => updatePasswordValue('currentPassword', event.target.value)}
            />
            <InputPassword
              aria-label={t('betterAuth.resetPassword.newPasswordPlaceholder')}
              autoComplete="new-password"
              placeholder={t('betterAuth.resetPassword.newPasswordPlaceholder')}
              value={passwordValues.newPassword}
              onChange={(event) => updatePasswordValue('newPassword', event.target.value)}
            />
            <InputPassword
              aria-label={t('betterAuth.resetPassword.confirmPasswordPlaceholder')}
              autoComplete="new-password"
              placeholder={t('betterAuth.resetPassword.confirmPasswordPlaceholder')}
              value={passwordValues.confirmPassword}
              onChange={(event) => updatePasswordValue('confirmPassword', event.target.value)}
            />
            {error && (
              <Text role="alert" type="danger">
                {error}
              </Text>
            )}
            <Flexbox horizontal gap={8} justify="flex-end">
              <Button disabled={changing} onClick={closeChangePassword}>
                {t('profile.cancel')}
              </Button>
              <Button htmlType="submit" loading={changing} type="primary">
                {t('profile.save')}
              </Button>
            </Flexbox>
          </Flexbox>
        </form>
      </Modal>
    </ProfileRow>
  );
};

export default PasswordRow;
