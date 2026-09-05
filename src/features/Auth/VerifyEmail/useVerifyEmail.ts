import { toast } from '@lobehub/ui/base-ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  buildMountedEmailVerificationResultPath,
  resolveAuthCallbackPath,
} from '@/features/Auth/utils/mountedPath';
import { useSingleton } from '@/hooks/useSingleton';
import { emailOtp, sendVerificationEmail } from '@/libs/better-auth/auth-client';

export type EmailVerificationMode = 'link' | 'otp';

interface UseVerifyEmailParams {
  callbackUrl: string;
  email: string | null;
  onVerified?: (callbackUrl: string) => void;
}

const VERIFICATION_EMAIL_TIMEOUT_MS = 15_000;
const EMAIL_RESEND_SECONDS = 60;
const OTP_RESEND_SECONDS = 60;

const withTimeout = async <T>(
  controller: AbortController,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectOnAbort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    rejectOnAbort = () => reject(new Error('Email verification request aborted'));
    if (controller.signal.aborted) rejectOnAbort();
    else controller.signal.addEventListener('abort', rejectOnAbort, { once: true });

    timeout = setTimeout(() => controller.abort(), VERIFICATION_EMAIL_TIMEOUT_MS);
  });

  try {
    return await Promise.race([request(controller.signal), abortPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (rejectOnAbort) controller.signal.removeEventListener('abort', rejectOnAbort);
  }
};

export const useVerifyEmail = ({ email, callbackUrl, onVerified }: UseVerifyEmailParams) => {
  const { t } = useTranslation('auth');
  const [emailResendSeconds, setEmailResendSeconds] = useState(0);
  const [mode, setMode] = useState<EmailVerificationMode>('link');
  const [otpResendSeconds, setOtpResendSeconds] = useState(0);
  const [requestingOtp, setRequestingOtp] = useState(false);
  const [resending, setResending] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const emailCooldownActive = useRef(false);
  const otpCooldownActive = useRef(false);
  const otpRequestInFlight = useRef(false);
  const otpVerifyInFlight = useRef(false);
  const resendInFlight = useRef(false);
  const mounted = useRef(true);
  const activeControllers = useSingleton(() => new Set<AbortController>());
  const requestScope = useSingleton(() => ({ callbackUrl, email, generation: 0 }));
  const isEmailCooldownActive = emailResendSeconds > 0;
  const isOtpCooldownActive = otpResendSeconds > 0;
  const isCurrentRequest = (generation: number) =>
    mounted.current && requestScope.generation === generation;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const controller of activeControllers) controller.abort();
      activeControllers.clear();
      otpRequestInFlight.current = false;
      otpVerifyInFlight.current = false;
      resendInFlight.current = false;
    };
  }, [activeControllers]);

  useLayoutEffect(() => {
    if (requestScope.email === email && requestScope.callbackUrl === callbackUrl) return;

    requestScope.email = email;
    requestScope.callbackUrl = callbackUrl;
    requestScope.generation += 1;
    for (const controller of activeControllers) controller.abort();
    activeControllers.clear();
    emailCooldownActive.current = false;
    otpCooldownActive.current = false;
    otpRequestInFlight.current = false;
    otpVerifyInFlight.current = false;
    resendInFlight.current = false;
    setEmailResendSeconds(0);
    setMode('link');
    setOtpResendSeconds(0);
    setRequestingOtp(false);
    setResending(false);
    setVerifyingOtp(false);
  }, [activeControllers, callbackUrl, email, requestScope]);

  useEffect(() => {
    if (!isEmailCooldownActive) {
      emailCooldownActive.current = false;
      return;
    }

    const interval = setInterval(
      () =>
        setEmailResendSeconds((seconds) => {
          const nextSeconds = Math.max(0, seconds - 1);
          if (nextSeconds === 0) emailCooldownActive.current = false;
          return nextSeconds;
        }),
      1000,
    );
    return () => clearInterval(interval);
  }, [isEmailCooldownActive]);

  useEffect(() => {
    if (!isOtpCooldownActive) {
      otpCooldownActive.current = false;
      return;
    }

    const interval = setInterval(
      () =>
        setOtpResendSeconds((seconds) => {
          const nextSeconds = Math.max(0, seconds - 1);
          if (nextSeconds === 0) otpCooldownActive.current = false;
          return nextSeconds;
        }),
      1000,
    );
    return () => clearInterval(interval);
  }, [isOtpCooldownActive]);

  const runRequest = async <T>(request: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    activeControllers.add(controller);
    try {
      return await withTimeout(controller, request);
    } finally {
      activeControllers.delete(controller);
    }
  };

  const handleResendEmail = async () => {
    if (!mounted.current || resendInFlight.current || emailCooldownActive.current) return;
    if (!email) {
      toast.error(t('betterAuth.verifyEmail.resend.noEmail'));
      return;
    }

    resendInFlight.current = true;
    const requestGeneration = requestScope.generation;
    setResending(true);
    try {
      const result = await runRequest((signal) =>
        sendVerificationEmail({
          callbackURL: buildMountedEmailVerificationResultPath(callbackUrl, email),
          email,
          fetchOptions: { signal },
        }),
      );
      if (!isCurrentRequest(requestGeneration)) return;
      if (result.error) {
        if (result.error.code === 'EMAIL_ALREADY_VERIFIED') {
          toast.success(t('betterAuth.verifyEmail.resend.alreadyVerified'));
          return;
        }
        if (result.error.status === 429 || result.error.code === 'RATE_LIMIT_EXCEEDED') {
          toast.error(t('betterAuth.verifyEmail.resend.rateLimited'));
          return;
        }
        toast.error(t('betterAuth.verifyEmail.resend.error'));
        return;
      }
      emailCooldownActive.current = true;
      setEmailResendSeconds(EMAIL_RESEND_SECONDS);
      toast.success(t('betterAuth.verifyEmail.resend.success'));
    } catch {
      if (!isCurrentRequest(requestGeneration)) return;
      console.error('Verification email resend failed');
      toast.error(t('betterAuth.verifyEmail.resend.error'));
    } finally {
      if (isCurrentRequest(requestGeneration)) {
        resendInFlight.current = false;
        setResending(false);
      }
    }
  };

  const handleRequestOtp = async () => {
    if (!mounted.current || otpRequestInFlight.current || otpCooldownActive.current) return;
    if (!email) {
      toast.error(t('betterAuth.verifyEmail.resend.noEmail'));
      return;
    }

    otpRequestInFlight.current = true;
    const requestGeneration = requestScope.generation;
    setRequestingOtp(true);
    try {
      const result = await runRequest((signal) =>
        emailOtp.sendVerificationOtp({
          email,
          fetchOptions: { signal },
          type: 'email-verification',
        }),
      );
      if (!isCurrentRequest(requestGeneration)) return;
      const errorCode = result.error?.code?.toUpperCase();
      if (result.error && errorCode !== 'USER_NOT_FOUND') {
        if (result.error.status === 429 || errorCode === 'RATE_LIMIT_EXCEEDED') {
          toast.error(t('betterAuth.verifyEmail.resend.rateLimited'));
          return;
        }
        toast.error(t('betterAuth.verifyEmail.otp.sendError'));
        return;
      }

      setMode('otp');
      otpCooldownActive.current = true;
      setOtpResendSeconds(OTP_RESEND_SECONDS);
      toast.success(t('betterAuth.verifyEmail.otp.sent'));
    } catch {
      if (!isCurrentRequest(requestGeneration)) return;
      console.error('Verification code request failed');
      toast.error(t('betterAuth.verifyEmail.otp.sendError'));
    } finally {
      if (isCurrentRequest(requestGeneration)) {
        otpRequestInFlight.current = false;
        setRequestingOtp(false);
      }
    }
  };

  const handleVerifyOtp = async (otp: string) => {
    if (!mounted.current || otpVerifyInFlight.current) return;
    if (!/^\d{6}$/.test(otp)) {
      toast.error(t('betterAuth.verifyEmail.otp.invalid'));
      return;
    }
    if (!email) {
      toast.error(t('betterAuth.verifyEmail.resend.noEmail'));
      return;
    }

    otpVerifyInFlight.current = true;
    const requestGeneration = requestScope.generation;
    setVerifyingOtp(true);
    try {
      const result = await runRequest((signal) =>
        emailOtp.verifyEmail({ email, fetchOptions: { signal }, otp }),
      );
      if (!isCurrentRequest(requestGeneration)) return;
      const errorCode = result.error?.code?.toUpperCase();
      if (result.error && errorCode !== 'EMAIL_ALREADY_VERIFIED') {
        toast.error(t('betterAuth.verifyEmail.otp.error'));
        return;
      }

      const target = resolveAuthCallbackPath(callbackUrl);
      if (onVerified) onVerified(target);
      else if (typeof window !== 'undefined') window.location.assign(target);
    } catch {
      if (!isCurrentRequest(requestGeneration)) return;
      console.error('Verification code confirmation failed');
      toast.error(t('betterAuth.verifyEmail.otp.error'));
    } finally {
      if (isCurrentRequest(requestGeneration)) {
        otpVerifyInFlight.current = false;
        setVerifyingOtp(false);
      }
    }
  };

  return {
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
  };
};
