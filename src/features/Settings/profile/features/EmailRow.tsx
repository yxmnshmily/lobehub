'use client';

import { Flexbox, Input } from '@lobehub/ui';
import { Button, Text, toast } from '@lobehub/ui/base-ui';
import { AnimatePresence, m } from 'motion/react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { withLobeHubMountPath } from '@/features/Auth/utils/mountedPath';
import { getEmailChangeErrorKey } from '@/features/Auth/utils/userFacingError';
import { changeEmail } from '@/libs/better-auth/auth-client';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import ProfileRow from './ProfileRow';

const EMAIL_REGEX = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

const EmailRow = () => {
  const { t } = useTranslation('auth');
  const email = useUserStore(userProfileSelectors.email);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleStartEdit = () => {
    setEditValue('');
    setError('');
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue('');
    setError('');
  };

  const handleSave = useCallback(async () => {
    const trimmed = editValue.trim();
    if (!trimmed) return;

    if (!EMAIL_REGEX.test(trimmed)) {
      setError(t('profile.emailInvalid'));
      return;
    }

    try {
      setSaving(true);
      setError('');
      const res = await changeEmail({
        callbackURL: withLobeHubMountPath('/settings/profile'),
        newEmail: trimmed,
      });
      if (res.error) {
        setError(t(getEmailChangeErrorKey(res.error)));
        return;
      }
      setIsEditing(false);
      toast.success(t('profile.emailChangeSuccess'));
    } catch {
      console.error('Email change failed');
      setError(t('profile.emailChangeError'));
    } finally {
      setSaving(false);
    }
  }, [editValue, t]);

  const editingContent = (
    <m.div
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      initial={{ opacity: 0, y: -10 }}
      key="editing"
      transition={{ duration: 0.2 }}
    >
      <Flexbox gap={12}>
        <Input
          autoFocus
          autoComplete="email"
          inputMode="email"
          placeholder={t('profile.emailPlaceholder')}
          status={error ? 'error' : undefined}
          type="email"
          value={editValue}
          onPressEnter={handleSave}
          onChange={(e) => {
            setEditValue(e.target.value);
            if (error) setError('');
          }}
        />
        {error && (
          <Text style={{ fontSize: 12 }} type="danger">
            {error}
          </Text>
        )}
        <Flexbox horizontal gap={8} justify="flex-end">
          <Button disabled={saving} size="small" onClick={handleCancel}>
            {t('profile.cancel')}
          </Button>
          <Button loading={saving} size="small" type="primary" onClick={handleSave}>
            {t('profile.save')}
          </Button>
        </Flexbox>
      </Flexbox>
    </m.div>
  );

  const displayContent = (
    <m.div
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      initial={{ opacity: 0 }}
      key="display"
      transition={{ duration: 0.2 }}
    >
      <Text>{email || '--'}</Text>
    </m.div>
  );

  return (
    <ProfileRow
      anchor={'profile-email'}
      label={t('profile.email')}
      action={
        !isEditing && (
          <Button size="small" onClick={handleStartEdit}>
            {t('profile.updateEmail')}
          </Button>
        )
      }
    >
      <AnimatePresence mode="wait">{isEditing ? editingContent : displayContent}</AnimatePresence>
    </ProfileRow>
  );
};

export default EmailRow;
