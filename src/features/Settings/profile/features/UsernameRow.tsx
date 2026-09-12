'use client';

import { Flexbox, Input } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import ProfileRow from './ProfileRow';

const UsernameRow = () => {
  const { t } = useTranslation('auth');
  const username = useUserStore(userProfileSelectors.username);
  const updateUsername = useUserStore((s) => s.updateUsername);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const locked = useRef(false);

  const usernameRegex = /^\w+$/;

  const validateUsername = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return t('profile.usernameRequired');
    if (trimmed.length > 64) return t('profile.usernameTooLong');
    if (!usernameRegex.test(trimmed)) return t('profile.usernameRule');
    return '';
  };

  const handleSave = async () => {
    if (locked.current) return;
    const next = value.trim();
    if (next === username || (!next && !username)) {
      setError('');
      setEditing(false);
      return;
    }

    const validationError = validateUsername(next);
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      locked.current = true;
      setSaving(true);
      setError('');
      await updateUsername(next);
      setEditing(false);
    } catch (err: any) {
      console.error('Failed to update username:', err);
      if (err?.data?.code === 'CONFLICT' || err?.message === 'USERNAME_TAKEN') {
        setError(t('profile.usernameDuplicate'));
      } else {
        setError(t('profile.usernameUpdateFailed'));
      }
    } finally {
      locked.current = false;
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setError('');
    setEditing(false);
  };

  return (
    <ProfileRow
      anchor="profile-username"
      label={t('profile.username')}
      action={
        editing ? (
          <Flexbox horizontal gap={8}>
            <Button disabled={saving} size="small" onClick={handleCancel}>
              {t('profile.cancel')}
            </Button>
            <Button loading={saving} size="small" type="primary" onClick={handleSave}>
              {t('profile.save')}
            </Button>
          </Flexbox>
        ) : (
          <Button
            size="small"
            type="default"
            onClick={() => {
              setValue(username || '');
              setError('');
              setEditing(true);
            }}
          >
            {t(username ? 'profile.edit' : 'profile.set')}
          </Button>
        )
      }
    >
      {editing ? (
        <Flexbox gap={8} style={{ minWidth: 0, flex: 1 }}>
          <Input
            autoFocus
            aria-label={t('profile.username')}
            disabled={saving}
            maxLength={64}
            placeholder={t('profile.usernamePlaceholder')}
            status={error ? 'error' : undefined}
            value={value}
            onPressEnter={handleSave}
            onChange={(e) => {
              setValue(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !saving) {
                e.preventDefault();
                handleCancel();
              }
            }}
          />
          {error && (
            <Text role="alert" type="danger">
              {error}
            </Text>
          )}
        </Flexbox>
      ) : (
        <Text style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          {username || t('profile.usernameOptional')}
        </Text>
      )}
    </ProfileRow>
  );
};

export default UsernameRow;
