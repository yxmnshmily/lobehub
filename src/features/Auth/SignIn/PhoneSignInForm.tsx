import { Flexbox, Icon, Input } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { Form } from 'antd';
import { MessageSquare, Phone } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AuthAgreement, useAuthAgreement } from '@/features/AuthShell';
import { phoneNumber } from '@/libs/better-auth/auth-client';

import { isFormValidationError, normalizePhone } from './phoneSignIn';

export const PhoneSignInForm = ({ callbackUrl }: { callbackUrl: string }) => {
  const { t } = useTranslation('auth');
  const { agreementChecked, continueWithAgreement, setAgreementChecked } = useAuthAgreement(
    undefined,
    true,
  );
  const [form] = Form.useForm<{ code: string; phone: string }>();
  const [codeSent, setCodeSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const sendingRef = useRef(false);

  useEffect(() => {
    if (!codeSent) return;

    const timer = window.setInterval(
      () => setResendSeconds((seconds) => Math.max(0, seconds - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [codeSent]);

  const sendCode = async () => {
    if (sendingRef.current || resendSeconds > 0) return;

    sendingRef.current = true;
    try {
      const { phone } = await form.validateFields(['phone']);
      setSending(true);
      const result = await phoneNumber.sendOtp({ phoneNumber: normalizePhone(phone) });
      if (result.error) throw new Error('SEND_FAILED');
      setCodeSent(true);
      setResendSeconds(60);
    } catch (error) {
      if (isFormValidationError(error)) return;
      toast.error(t('betterAuth.phone.sendFailed'));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const verifyCode = async ({ code, phone }: { code: string; phone: string }) => {
    setVerifying(true);
    try {
      const result = await phoneNumber.verify({ code, phoneNumber: normalizePhone(phone) });
      if (result.error) throw new Error('VERIFY_FAILED');
      window.location.assign(callbackUrl);
    } catch {
      toast.error(t('betterAuth.phone.verifyFailed'));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={(values) => continueWithAgreement(() => void verifyCode(values))}
    >
      <Form.Item
        name="phone"
        rules={[
          { message: t('betterAuth.phone.phoneRequired'), required: true },
          { message: t('betterAuth.phone.phoneInvalid'), pattern: /^1[3-9]\d{9}$/ },
        ]}
      >
        <Input
          autoComplete="tel"
          inputMode="tel"
          placeholder={t('betterAuth.phone.phonePlaceholder')}
          prefix={<Icon icon={Phone} size={16} style={{ marginInline: 6 }} />}
          size="large"
          style={{ padding: 6 }}
        />
      </Form.Item>
      {codeSent && (
        <Form.Item
          getValueFromEvent={(event) => event.target.value.replaceAll(/\D/g, '').slice(0, 6)}
          name="code"
          rules={[{ len: 6, message: t('betterAuth.phone.codeInvalid'), required: true }]}
        >
          <Input
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            placeholder={t('betterAuth.phone.codePlaceholder')}
            prefix={<Icon icon={MessageSquare} size={16} style={{ marginInline: 6 }} />}
            size="large"
            style={{ padding: 6 }}
          />
        </Form.Item>
      )}
      <AuthAgreement checked={agreementChecked} onChange={setAgreementChecked} />
      <Flexbox gap={8}>
        {!codeSent ? (
          <Button
            block
            loading={sending}
            size="large"
            type="primary"
            onClick={() => continueWithAgreement(() => void sendCode())}
          >
            {t('betterAuth.phone.sendCode')}
          </Button>
        ) : (
          <>
            <Button block htmlType="submit" loading={verifying} size="large" type="primary">
              {t('betterAuth.phone.signInOrSignUp')}
            </Button>
            <Button
              block
              disabled={resendSeconds > 0}
              loading={sending}
              size="large"
              onClick={() => void sendCode()}
            >
              {resendSeconds > 0
                ? t('betterAuth.phone.resendIn', { seconds: resendSeconds })
                : t('betterAuth.phone.resend')}
            </Button>
          </>
        )}
      </Flexbox>
    </Form>
  );
};
