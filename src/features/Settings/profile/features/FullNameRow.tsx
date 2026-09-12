'use client';

import { Flexbox, Input } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { saveToast } from '@/store/utils/saveToast';

import ProfileRow from './ProfileRow';

const FullNameRow = () => {
  const { t } = useTranslation('auth');
  const fullName = useUserStore(userProfileSelectors.fullName);
  const updateFullName = useUserStore((s) => s.updateFullName);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const locked = useRef(false);

  const handleSave = async () => {
    if (locked.current) return;
    const name = value.trim();
    if (!name) {
      setError(t('profile.fullNameRequired'));
      return;
    }
    if (name.length > 64) {
      setError(t('profile.fullNameTooLong'));
      return;
    }
    if (name === fullName) {
      setEditing(false);
      return;
    }

    try {
      locked.current = true;
      setSaving(true);
      await updateFullName(name);
      setEditing(false);
    } catch (error) {
      console.error('Failed to update fullName:', error);
      saveToast(error, { retry: () => void handleSave(), title: t('profile.saveError') });
    } finally {
      locked.current = false;
      setSaving(false);
    }
  };

  return (
    <ProfileRow
      anchor="profile-full-name"
      label={t('profile.fullName')}
      action={
        editing ? (
          <Flexbox horizontal gap={8}>
            <Button disabled={saving} size="small" onClick={() => setEditing(false)}>
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
              setValue(fullName);
              setError('');
              setEditing(true);
            }}
          >
            {t(fullName ? 'profile.edit' : 'profile.set')}
          </Button>
        )
      }
      labelSlot={
        <Text
          strong
          style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, whiteSpace: 'nowrap' }}
        >
          {t('profile.fullName')}
          <Text aria-hidden type="danger">
            *
          </Text>
        </Text>
      }
    >
      {editing ? (
        <Flexbox gap={8} style={{ minWidth: 0, flex: 1 }}>
          <Input
            autoFocus
            required
            aria-label={t('profile.fullName')}
            disabled={saving}
            maxLength={64}
            status={error ? 'error' : undefined}
            value={value}
            onPressEnter={handleSave}
            onChange={(e) => {
              setValue(e.target.value);
              setError('');
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
          {fullName || t('profile.fullNameRequired')}
        </Text>
      )}
    </ProfileRow>
  );
};

export default FullNameRow;
