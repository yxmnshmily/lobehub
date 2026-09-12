'use client';

import { Flexbox, Input } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { normalizePhone } from '@/features/Auth/SignIn/phoneSignIn';
import { phoneNumber, useSession } from '@/libs/better-auth/auth-client';
import { useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';

import ProfileRow from './ProfileRow';

const PhoneRow = () => {
  const { t } = useTranslation('auth');
  const session = useSession();
  const enabled = useServerConfigStore((s) => s.serverConfig.enablePhoneAuth);
  const refreshUserState = useUserStore((s) => s.refreshUserState);
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sentPhone, setSentPhone] = useState('');
  const [boundPhone, setBoundPhone] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const currentPhone = boundPhone || session.data?.user.phoneNumber;

  useEffect(() => {
    if (!countdown) return;
    const timer = setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const cancel = () => {
    setEditing(false);
    setPhone('');
    setCode('');
    setSentPhone('');
    setError('');
  };

  const submit = async (verify: boolean) => {
    if (locked.current || !enabled || !session.data?.user) return;
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setError(t('betterAuth.phone.phoneInvalid'));
      return;
    }
    const normalized = normalizePhone(phone);
    if (verify && (normalized !== sentPhone || !/^\d{6}$/.test(code))) {
      setError(t('betterAuth.phone.codeInvalid'));
      return;
    }
    if (!verify && countdown > 0) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const result = verify
        ? await phoneNumber.verify({
            code,
            disableSession: true,
            phoneNumber: normalized,
            updatePhoneNumber: true,
          })
        : await phoneNumber.sendOtp({ phoneNumber: normalized });
      if (result.error) {
        setError(
          t(
            result.error.code === 'PHONE_NUMBER_EXIST'
              ? 'profile.phoneInUse'
              : verify
                ? 'betterAuth.phone.verifyFailed'
                : 'betterAuth.phone.sendFailed',
          ),
        );
        return;
      }
      if (verify) {
        setBoundPhone(normalized);
        cancel();
        // Binding has already succeeded; a refresh failure must not report a failed binding.
        void Promise.allSettled([session.refetch(), refreshUserState()]);
      } else {
        setSentPhone(normalized);
        setCountdown(60);
      }
    } catch {
      setError(t(verify ? 'betterAuth.phone.verifyFailed' : 'betterAuth.phone.sendFailed'));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  return (
    <ProfileRow
      anchor="profile-phone"
      label={t('profile.phone')}
      action={
        !editing && (
          <Button
            disabled={!enabled || !session.data?.user}
            size="small"
            type="default"
            onClick={() => setEditing(true)}
          >
            {t(currentPhone ? 'profile.changePhone' : 'profile.bindPhone')}
          </Button>
        )
      }
      labelSlot={
        <Text
          strong
          style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, whiteSpace: 'nowrap' }}
        >
          {t('profile.phone')}
          <Text aria-hidden type="danger">
            *
          </Text>
        </Text>
      }
    >
      {editing ? (
        <Flexbox gap={12} style={{ minWidth: 0, width: '100%' }}>
          <Flexbox horizontal align="center" gap={8} style={{ flexWrap: 'wrap', minWidth: 0 }}>
            <Input
              required
              aria-label={t('profile.phone')}
              autoComplete="tel-national"
              disabled={busy}
              inputMode="tel"
              maxLength={11}
              placeholder={t('betterAuth.phone.phonePlaceholder')}
              style={{ flex: '1 1 180px', minWidth: 0 }}
              type="tel"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                setSentPhone('');
                setCode('');
                setError('');
              }}
            />
            <Button disabled={busy || countdown > 0} onClick={() => submit(false)}>
              {countdown > 0
                ? t('betterAuth.phone.resendIn', { seconds: countdown })
                : t('betterAuth.phone.sendCode')}
            </Button>
            {sentPhone && (
              <>
                <Input
                  aria-label={t('betterAuth.phone.codePlaceholder')}
                  autoComplete="one-time-code"
                  disabled={busy}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder={t('betterAuth.phone.codePlaceholder')}
                  style={{ flex: '1 1 140px', minWidth: 0 }}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  onPressEnter={() => submit(true)}
                />
                <Button loading={busy} type="primary" onClick={() => submit(true)}>
                  {t('profile.confirmPhone')}
                </Button>
              </>
            )}
            <Button disabled={busy} onClick={cancel}>
              {t('profile.cancel')}
            </Button>
          </Flexbox>
          {error && (
            <Text role="alert" type="danger">
              {error}
            </Text>
          )}
        </Flexbox>
      ) : (
        <Text>
          {currentPhone?.replace(/^\+?86(?=1[3-9]\d{9}$)/, '') ||
            t(enabled ? 'profile.phoneRequired' : 'profile.phoneUnavailable')}
        </Text>
      )}
    </ProfileRow>
  );
};

export default PhoneRow;
