import { toast } from '@lobehub/ui/base-ui';
import { Form } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import { useBusinessSignin } from '@/business/client/hooks/useBusinessSignin';
import {
  buildMountedOnboardingPath,
  resolveAuthCallbackPath,
  withLobeHubMountPath,
} from '@/features/Auth/utils/mountedPath';
import { useAuthServerConfigStore } from '@/features/AuthShell';
import { trackLoginOrSignupClicked } from '@/features/User/UserLoginOrSignup/trackLoginOrSignupClicked';
import { requestPasswordReset, signIn } from '@/libs/better-auth/auth-client';
import { isBuiltinProvider, normalizeProviderId } from '@/libs/better-auth/utils/client';
import { sanitizeRedirectPath } from '@/utils/onboardingRedirect';

import { EMAIL_REGEX, USERNAME_REGEX } from './SignInEmailStep';

const LAST_AUTH_PROVIDER_KEY = 'lobehub:auth:last-provider:v1';
const isEmailNotVerifiedError = (error: { code?: string } | null | undefined) =>
  error?.code === 'EMAIL_NOT_VERIFIED';

const getWechatAuthorizationUrl = (result: unknown): string | undefined => {
  if (!result || typeof result !== 'object') return undefined;
  const response = result as { data?: { url?: unknown }; url?: unknown };
  const candidate = response.data?.url ?? response.url;
  if (typeof candidate !== 'string') return undefined;

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.hostname !== 'open.weixin.qq.com') return undefined;

    const redirectUri = url.searchParams.get('redirect_uri');
    if (redirectUri) {
      try {
        const callbackUrl = new URL(redirectUri);
        const usesLoopbackHost = ['127.0.0.1', 'localhost'].includes(callbackUrl.hostname);
        if (usesLoopbackHost && callbackUrl.pathname.endsWith('/api/auth/callback/wechat')) {
          const currentOrigin = new URL(window.location.origin);
          callbackUrl.protocol = currentOrigin.protocol;
          callbackUrl.host = currentOrigin.host;
          url.searchParams.set('redirect_uri', callbackUrl.toString());
        }
      } catch {
        return undefined;
      }
    }

    return url.toString();
  } catch {
    return undefined;
  }
};
type Step = 'email' | 'password' | 'emailSent';

type SentEmailType = 'magicLink' | 'resetPassword';

interface SentEmailInfo {
  email: string;
  type: SentEmailType;
}

interface SignInFormValues {
  email: string;
  password: string;
}

export const useSignIn = () => {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const getCallbackUrl = () => resolveAuthCallbackPath(searchParams.get('callbackUrl'));
  const sessionExpired = searchParams.get('reason') === 'sessionExpired';
  const enableMagicLink = useAuthServerConfigStore((s) => s.serverConfig.enableMagicLink || false);
  const enablePhoneAuth = useAuthServerConfigStore((s) => s.serverConfig.enablePhoneAuth || false);
  const disableEmailPassword = useAuthServerConfigStore(
    (s) => s.serverConfig.disableEmailPassword || false,
  );
  const enableBusinessFeatures = useAuthServerConfigStore(
    (s) => s.serverConfig.enableBusinessFeatures || false,
  );
  const [form] = Form.useForm<SignInFormValues>();
  const [loading, setLoading] = useState(false);
  const signInInFlight = useRef(false);
  // Locks the email-dispatch actions (magic link / password reset / resend) so a
  // slow network can't be double-clicked into multiple emails.
  const [sending, setSending] = useState(false);
  const [socialLoading, setSocialLoading] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'email' | 'phone'>('phone');
  const [wechatAuthUrl, setWechatAuthUrl] = useState<string | null>(null);
  const wechatAttemptRef = useRef(0);
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [sentInfo, setSentInfo] = useState<SentEmailInfo | null>(null);
  const [isSocialOnly, setIsSocialOnly] = useState(false);
  const [lastAuthProvider] = useState(() => {
    try {
      return localStorage.getItem(LAST_AUTH_PROVIDER_KEY);
    } catch {
      return null;
    }
  });
  const serverConfigInit = useAuthServerConfigStore((s) => s.serverConfigInit);
  const oAuthSSOProviders = useAuthServerConfigStore((s) => s.serverConfig.oAuthSSOProviders) || [];
  const { getAdditionalData, preSocialSigninCheck, ssoProviders } = useBusinessSignin();

  useEffect(() => {
    const emailParam = searchParams.get('email');
    if (emailParam) {
      form.setFieldValue('email', emailParam);
      setAuthMode('email');
    }
  }, [searchParams, form]);

  const handleSendMagicLink = async (targetEmail?: string): Promise<boolean> => {
    if (sending) return false;
    try {
      const emailValue =
        targetEmail ||
        (await form
          .validateFields(['email'])
          .then((v) => v.email as string)
          .catch(() => null));
      if (!emailValue) return false;

      setSending(true);
      const callbackUrl = getCallbackUrl();
      const { error } = await signIn.magicLink({
        callbackURL: callbackUrl,
        email: emailValue,
        // First-time magic-link users are signups — land them on onboarding first
        newUserCallbackURL: buildMountedOnboardingPath(searchParams.get('callbackUrl')),
      });
      if (error) {
        toast.error(t('betterAuth.signin.magicLinkError'));
        return false;
      }
      // Success is a forward step, not a fleeting toast: land on a persistent
      // "check your inbox" screen (ux Act §3.5).
      setSentInfo({ email: emailValue, type: 'magicLink' });
      setStep('emailSent');
      return true;
    } catch (error) {
      if (!(error as any)?.errorFields) {
        console.error('Magic link request failed');
        toast.error(t('betterAuth.signin.magicLinkError'));
      }
      return false;
    } finally {
      setSending(false);
    }
  };

  const normalizeSignInIdentifier = (identifier: string): string | null => {
    const trimmedIdentifier = identifier.trim();
    if (!trimmedIdentifier) return null;

    const isEmailIdentifier = EMAIL_REGEX.test(trimmedIdentifier);
    if (isEmailIdentifier) return trimmedIdentifier.toLowerCase();

    if (!USERNAME_REGEX.test(trimmedIdentifier)) {
      toast.error(t('betterAuth.errors.emailInvalid'));
      return null;
    }

    return trimmedIdentifier;
  };

  const handleCheckUser = async (values: Pick<SignInFormValues, 'email'>) => {
    setLoading(true);
    await trackLoginOrSignupClicked({ spm: 'signin.email_step.submit' });

    try {
      const identifier = normalizeSignInIdentifier(values.email);
      if (!identifier) return;

      // Every syntactically valid identifier gets the same next step. Account
      // existence and credential type are only evaluated with the password.
      setEmail(identifier);
      setAuthMode('email');
      if (enableMagicLink && EMAIL_REGEX.test(identifier)) {
        await handleSendMagicLink(identifier);
        return;
      }
      setStep('password');
    } catch {
      console.error('Account lookup failed');
      toast.error(t('betterAuth.signin.error'));
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async (values: Pick<SignInFormValues, 'password'>) => {
    if (signInInFlight.current) return;
    signInInFlight.current = true;
    setLoading(true);

    try {
      await trackLoginOrSignupClicked({ spm: 'signin.password_step.submit' });
      const callbackUrl = getCallbackUrl();
      if (!EMAIL_REGEX.test(email)) {
        const response = await fetch('/api/auth/resolve-username', {
          body: JSON.stringify({
            callbackURL: callbackUrl,
            password: values.password,
            username: email,
          }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        });
        if (response.ok) {
          window.location.href = sanitizeRedirectPath(callbackUrl);
          return;
        }
        form.setFields([{ errors: [t('betterAuth.signin.error')], name: 'password' }]);
        return;
      }

      const result = await signIn.email(
        { callbackURL: callbackUrl, email, password: values.password },
        {
          onError: (ctx) => {
            console.error('Email sign in failed', { status: ctx.error.status });
            if (isEmailNotVerifiedError(ctx.error)) {
              navigate(
                `/verify-email?email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(callbackUrl)}`,
              );
            }
          },
          // callbackUrl targets the main app, outside this auth SPA — full page load required
          onSuccess: () => {
            window.location.href = sanitizeRedirectPath(callbackUrl);
          },
        },
      );

      if (result.error && !isEmailNotVerifiedError(result.error)) {
        // Wrong password is the most common sign-in failure. Keep the error
        // pinned inline on the field (persistent, with retry context) rather
        // than a toast that vanishes in 3s (ux Read §1.1 / Same-Page Error).
        form.setFields([
          {
            errors: [t('betterAuth.signin.error')],
            name: 'password',
          },
        ]);
      }
    } catch {
      console.error('Email sign in failed');
      toast.error(t('betterAuth.signin.error'));
    } finally {
      signInInFlight.current = false;
      setLoading(false);
    }
  };

  const handleSocialSignIn = async (provider: string) => {
    setSocialLoading(provider);
    const normalizedProvider = normalizeProviderId(provider);
    const isWechat = normalizedProvider === 'wechat';
    const wechatAttempt = isWechat ? ++wechatAttemptRef.current : 0;
    if (isWechat) setWechatAuthUrl('');
    await trackLoginOrSignupClicked({
      provider: normalizedProvider,
      spm: 'signin.social.click',
    });

    try {
      if (enableBusinessFeatures && !(await preSocialSigninCheck())) {
        if (isWechat) setWechatAuthUrl(null);
        setSocialLoading(null);
        return;
      }

      try {
        localStorage.setItem(LAST_AUTH_PROVIDER_KEY, provider);
      } catch {
        // Ignore localStorage errors (e.g., quota exceeded, private mode)
      }

      const callbackUrl = getCallbackUrl();
      // First-time OAuth users are signups — land them on onboarding first
      const newUserCallbackURL = buildMountedOnboardingPath(searchParams.get('callbackUrl'));
      const additionalData = await getAdditionalData();
      const signInWithAdditionalData = async () =>
        isBuiltinProvider(normalizedProvider)
          ? await signIn.social({
              additionalData,
              callbackURL: callbackUrl,
              newUserCallbackURL,
              provider: normalizedProvider,
            })
          : await signIn.oauth2({
              additionalData,
              callbackURL: callbackUrl,
              disableRedirect: isWechat,
              newUserCallbackURL,
              providerId: normalizedProvider,
            });

      const result = await signInWithAdditionalData();

      if (result && 'error' in result && result.error) throw result.error;
      if (isWechat) {
        const authorizationUrl = getWechatAuthorizationUrl(result);
        if (!authorizationUrl) throw new Error('Missing WeChat authorization URL');
        if (wechatAttemptRef.current !== wechatAttempt) return;
        setWechatAuthUrl(authorizationUrl);
      }
    } catch {
      if (isWechat && wechatAttemptRef.current !== wechatAttempt) return;
      if (isWechat) setWechatAuthUrl(null);
      console.error(`${normalizedProvider} sign in failed`);
      toast.error(t('betterAuth.signin.socialError'));
    } finally {
      setSocialLoading(null);
    }
  };

  const handleBackToEmail = () => {
    setStep('email');
    setEmail('');
    setIsSocialOnly(false);
    // Drop the previous account's password + any inline error. The form
    // instance is shared across steps and defaults to preserve, so without this
    // the next email's password step remounts pre-filled with the stale value.
    form.resetFields(['password']);
  };

  const handleGoToSignup = () => {
    const currentEmail = form.getFieldValue('email');
    const callbackUrl = getCallbackUrl();
    const params = new URLSearchParams();
    if (currentEmail) params.set('email', currentEmail);
    params.set('callbackUrl', callbackUrl);
    const utmSource = searchParams.get('utm_source');
    if (utmSource) params.set('utm_source', utmSource);
    const referral = searchParams.get('referral');
    if (referral) params.set('referral', referral);
    void trackLoginOrSignupClicked({ spm: 'signin.go_to_signup.click' }).finally(() => {
      navigate(`/signup?${params.toString()}`);
    });
  };

  // Fire the password-reset email. Returns true on success. Shared by the
  // "forgot password" entry and the resend action on the sent screen.
  const dispatchPasswordReset = async (targetEmail: string): Promise<boolean> => {
    if (sending) return false;
    setSending(true);
    try {
      // The better-auth client resolves with `{ data, error }` instead of
      // throwing, so a failed send would otherwise land on the "email sent" screen.
      const { error } = await requestPasswordReset({
        email: targetEmail,
        redirectTo: withLobeHubMountPath(
          `/reset-password?email=${encodeURIComponent(targetEmail)}`,
        ),
      });
      if (error) throw error;
      return true;
    } catch {
      toast.error(t('betterAuth.signin.forgotPasswordError'));
      return false;
    } finally {
      setSending(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email || sending) return;
    const ok = await dispatchPasswordReset(email);
    if (!ok) return;
    setSentInfo({ email, type: 'resetPassword' });
    setStep('emailSent');
  };

  const handleResendEmail = async () => {
    if (!sentInfo || sending) return;
    const ok =
      sentInfo.type === 'magicLink'
        ? await handleSendMagicLink(sentInfo.email)
        : await dispatchPasswordReset(sentInfo.email);
    if (ok) toast.success(t('betterAuth.signin.emailSent.resent'));
  };

  // "Use a different email" — always drop back to the email entry so the label
  // matches the action (returning to the password step would keep the same email).
  const handleBackFromSent = () => {
    setSentInfo(null);
    handleBackToEmail();
  };

  const resolvedProviders = enableBusinessFeatures ? ssoProviders : oAuthSSOProviders;
  const sortedProviders = lastAuthProvider
    ? [...resolvedProviders].sort((a, b) => {
        if (a === lastAuthProvider) return -1;
        if (b === lastAuthProvider) return 1;
        return 0;
      })
    : resolvedProviders;

  return {
    authMode,
    callbackUrl: getCallbackUrl(),
    closeWechatAuth: () => {
      wechatAttemptRef.current += 1;
      setWechatAuthUrl(null);
    },
    disableEmailPassword,
    email,
    enablePhoneAuth,
    form,
    handleBackFromSent,
    handleBackToEmail,
    handleCheckUser,
    handleForgotPassword,
    handleGoToSignup,
    handleResendEmail,
    handleSignIn,
    handleSocialSignIn,
    isSocialOnly,
    lastAuthProvider,
    loading,
    oAuthSSOProviders: sortedProviders,
    sending,
    sessionExpired,
    sentInfo,
    serverConfigInit: enableBusinessFeatures ? true : serverConfigInit,
    setAuthMode,
    socialLoading,
    step,
    wechatAuthUrl,
  };
};
