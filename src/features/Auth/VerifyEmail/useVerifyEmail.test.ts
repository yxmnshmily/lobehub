import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useVerifyEmail } from './useVerifyEmail';

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  sendVerificationOtp: vi.fn(),
  sendVerificationEmail: vi.fn(),
  success: vi.fn(),
  verifyEmailOtp: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  toast: { error: mocks.error, success: mocks.success },
}));
vi.mock('@/libs/better-auth/auth-client', () => ({
  emailOtp: {
    sendVerificationOtp: mocks.sendVerificationOtp,
    verifyEmail: mocks.verifyEmailOtp,
  },
  sendVerificationEmail: mocks.sendVerificationEmail,
}));

describe('useVerifyEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/lobehub/verify-email');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('resends verification to the requested account with its callback intact', async () => {
    mocks.sendVerificationEmail.mockResolvedValue({ data: { status: true }, error: null });
    const { result } = renderHook(() =>
      useVerifyEmail({ callbackUrl: '/lobehub/onboarding', email: 'member@example.test' }),
    );

    await act(async () => {
      await result.current.handleResendEmail();
    });

    expect(mocks.sendVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackURL: `${window.location.origin}/lobehub/verify-email?callbackUrl=%2Flobehub%2Fonboarding&status=success&email=member%40example.test`,
        email: 'member@example.test',
        fetchOptions: { signal: expect.any(AbortSignal) },
      }),
    );
    expect(mocks.success).toHaveBeenCalledWith('betterAuth.verifyEmail.resend.success');
  });

  it('does not send without an account email', async () => {
    const { result } = renderHook(() =>
      useVerifyEmail({ callbackUrl: '/lobehub/onboarding', email: '' }),
    );

    await act(async () => {
      await result.current.handleResendEmail();
    });

    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith('betterAuth.verifyEmail.resend.noEmail');
  });

  it('keeps a visible error when the resend endpoint rate-limits the request', async () => {
    mocks.sendVerificationEmail.mockResolvedValue({
      data: null,
      error: { message: 'Too many requests. Please try again later.', status: 429 },
    });
    const { result } = renderHook(() =>
      useVerifyEmail({ callbackUrl: '/lobehub/onboarding', email: 'member@example.test' }),
    );

    await act(async () => {
      await result.current.handleResendEmail();
    });

    expect(mocks.error).toHaveBeenCalledWith('betterAuth.verifyEmail.resend.rateLimited');
    expect(result.current.resending).toBe(false);
  });

  it('coalesces rapid resend clicks into one email request', async () => {
    let finishRequest: ((value: { data: { status: boolean }; error: null }) => void) | undefined;
    mocks.sendVerificationEmail.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRequest = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useVerifyEmail({ callbackUrl: '/lobehub/onboarding', email: 'member@example.test' }),
    );

    let firstRequest: Promise<void>;
    let secondRequest: Promise<void>;
    act(() => {
      firstRequest = result.current.handleResendEmail();
      secondRequest = result.current.handleResendEmail();
    });

    expect(mocks.sendVerificationEmail).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishRequest?.({ data: { status: true }, error: null });
      await Promise.all([firstRequest!, secondRequest!]);
    });
    expect(result.current.resending).toBe(false);
  });

  it('waits 60 seconds before sending another verification link', async () => {
    vi.useFakeTimers();
    try {
      mocks.sendVerificationEmail.mockResolvedValue({ data: { status: true }, error: null });
      const { result } = renderHook(() =>
        useVerifyEmail({ callbackUrl: '/lobehub/', email: 'member@example.test' }),
      );

      await act(async () => {
        await result.current.handleResendEmail();
        await result.current.handleResendEmail();
      });
      expect(mocks.sendVerificationEmail).toHaveBeenCalledTimes(1);
      expect(result.current.emailResendSeconds).toBe(60);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(result.current.emailResendSeconds).toBe(0);

      await act(async () => {
        await result.current.handleResendEmail();
      });
      expect(mocks.sendVerificationEmail).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('releases the resend action when the email request never responds', async () => {
    vi.useFakeTimers();
    try {
      mocks.sendVerificationEmail.mockImplementation(() => new Promise(() => {}));
      const { result } = renderHook(() =>
        useVerifyEmail({ callbackUrl: '/lobehub/onboarding', email: 'member@example.test' }),
      );
      let requestSettled = false;
      let request: Promise<void>;

      act(() => {
        request = result.current.handleResendEmail();
        void request.finally(() => {
          requestSettled = true;
        });
      });
      expect(result.current.resending).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });

      expect(requestSettled).toBe(true);
      await act(async () => request!);
      expect(result.current.resending).toBe(false);
      expect(mocks.error).toHaveBeenCalledWith('betterAuth.verifyEmail.resend.error');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows an understandable state when the mailbox is already verified', async () => {
    mocks.sendVerificationEmail.mockResolvedValue({
      data: null,
      error: {
        code: 'EMAIL_ALREADY_VERIFIED',
        message: 'Email already verified',
        status: 400,
      },
    });
    const { result } = renderHook(() =>
      useVerifyEmail({ callbackUrl: '/lobehub/onboarding', email: 'member@example.test' }),
    );

    await act(async () => {
      await result.current.handleResendEmail();
    });

    expect(mocks.success).toHaveBeenCalledWith('betterAuth.verifyEmail.resend.alreadyVerified');
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each(['https://evil.example/callback', '//evil.example', 'javascript:alert(1)'])(
    'does not forward an unsafe callback to the verification endpoint: %s',
    async (callbackUrl) => {
      mocks.sendVerificationEmail.mockResolvedValue({ data: { status: true }, error: null });
      const { result } = renderHook(() =>
        useVerifyEmail({ callbackUrl, email: 'member@example.test' }),
      );

      await act(async () => {
        await result.current.handleResendEmail();
      });

      expect(mocks.sendVerificationEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          callbackURL: `${window.location.origin}/lobehub/verify-email?callbackUrl=%2Flobehub%2Fgroup%2Fdefault&status=success&email=member%40example.test`,
          email: 'member@example.test',
          fetchOptions: { signal: expect.any(AbortSignal) },
        }),
      );
    },
  );

  it('requests a six-digit OTP for a QQ mailbox without revealing account existence', async () => {
    mocks.sendVerificationOtp.mockResolvedValue({ data: { success: true }, error: null });
    const { result } = renderHook(() =>
      useVerifyEmail({ callbackUrl: '/lobehub/onboarding', email: '123456789@qq.com' }),
    );

    await act(async () => {
      await result.current.handleRequestOtp();
    });

    expect(mocks.sendVerificationOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: '123456789@qq.com',
        fetchOptions: { signal: expect.any(AbortSignal) },
        type: 'email-verification',
      }),
    );
    expect(result.current.mode).toBe('otp');
    expect(result.current.otpResendSeconds).toBe(60);
    expect(mocks.success).toHaveBeenCalledWith('betterAuth.verifyEmail.otp.sent');
  });

  it('uses the same sent response when the OTP endpoint cannot find the account', async () => {
    mocks.sendVerificationOtp.mockResolvedValue({
      data: null,
      error: { code: 'USER_NOT_FOUND', message: 'User not found', status: 400 },
    });
    const { result } = renderHook(() =>
      useVerifyEmail({ callbackUrl: '/lobehub/', email: 'unknown@qq.com' }),
    );

    await act(async () => {
      await result.current.handleRequestOtp();
    });

    expect(result.current.mode).toBe('otp');
    expect(mocks.success).toHaveBeenCalledWith('betterAuth.verifyEmail.otp.sent');
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('rejects a non-six-digit OTP without submitting it', async () => {
    const { result } = renderHook(() =>
      useVerifyEmail({ callbackUrl: '/lobehub/onboarding', email: 'member@example.test' }),
    );

    await act(async () => {
      await result.current.handleVerifyOtp('12ab');
    });

    expect(mocks.verifyEmailOtp).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith('betterAuth.verifyEmail.otp.invalid');
  });

  it('verifies a valid OTP once and continues only inside the mounted app', async () => {
    mocks.verifyEmailOtp.mockResolvedValue({ data: { status: true }, error: null });
    const onVerified = vi.fn();
    const { result } = renderHook(() =>
      useVerifyEmail({
        callbackUrl: 'https://evil.example/callback',
        email: 'member@example.test',
        onVerified,
      }),
    );

    await act(async () => {
      await result.current.handleVerifyOtp('123456');
    });

    expect(mocks.verifyEmailOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'member@example.test',
        fetchOptions: { signal: expect.any(AbortSignal) },
        otp: '123456',
      }),
    );
    expect(onVerified).toHaveBeenCalledWith('/lobehub/group/default');
  });

  it('coalesces rapid OTP submissions and recovers after an invalid or expired code', async () => {
    let finishRequest: ((value: { data: null; error: { code: string } }) => void) | undefined;
    mocks.verifyEmailOtp.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRequest = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useVerifyEmail({ callbackUrl: '/lobehub/', email: 'member@example.test' }),
    );

    let firstRequest: Promise<void>;
    let secondRequest: Promise<void>;
    act(() => {
      firstRequest = result.current.handleVerifyOtp('123456');
      secondRequest = result.current.handleVerifyOtp('123456');
    });
    expect(mocks.verifyEmailOtp).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishRequest?.({ data: null, error: { code: 'INVALID_OTP' } });
      await Promise.all([firstRequest!, secondRequest!]);
    });

    expect(result.current.verifyingOtp).toBe(false);
    expect(mocks.error).toHaveBeenCalledWith('betterAuth.verifyEmail.otp.error');
  });

  it('counts down before allowing another OTP send and guards rapid resend clicks', async () => {
    vi.useFakeTimers();
    try {
      mocks.sendVerificationOtp.mockResolvedValue({ data: { success: true }, error: null });
      const { result } = renderHook(() =>
        useVerifyEmail({ callbackUrl: '/lobehub/', email: 'member@example.test' }),
      );

      await act(async () => {
        await result.current.handleRequestOtp();
        await result.current.handleRequestOtp();
      });
      expect(mocks.sendVerificationOtp).toHaveBeenCalledTimes(1);
      expect(result.current.otpResendSeconds).toBe(60);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(result.current.otpResendSeconds).toBe(0);

      await act(async () => {
        await result.current.handleRequestOtp();
      });
      expect(mocks.sendVerificationOtp).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts a timed-out OTP send before allowing a retry', async () => {
    vi.useFakeTimers();
    try {
      let requestSignal: AbortSignal | undefined;
      mocks.sendVerificationOtp.mockImplementation(
        ({ fetchOptions }: { fetchOptions?: { signal?: AbortSignal } }) => {
          requestSignal = fetchOptions?.signal;
          return new Promise((_resolve, reject) => {
            requestSignal?.addEventListener('abort', () => reject(new Error('aborted')));
          });
        },
      );
      const { result } = renderHook(() =>
        useVerifyEmail({ callbackUrl: '/lobehub/', email: 'member@example.test' }),
      );

      let request: Promise<void>;
      act(() => {
        request = result.current.handleRequestOtp();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
        await request!;
      });

      expect(requestSignal?.aborted).toBe(true);
      expect(result.current.requestingOtp).toBe(false);

      mocks.sendVerificationOtp.mockResolvedValue({ data: { success: true }, error: null });
      await act(async () => {
        await result.current.handleRequestOtp();
      });
      expect(mocks.sendVerificationOtp).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts link resend and suppresses feedback after the page unmounts', async () => {
    let rejectRequest: ((reason: Error) => void) | undefined;
    let requestSignal: AbortSignal | undefined;
    mocks.sendVerificationEmail.mockImplementation(
      ({ fetchOptions }: { fetchOptions?: { signal?: AbortSignal } }) =>
        new Promise((_resolve, reject) => {
          requestSignal = fetchOptions?.signal;
          rejectRequest = reject;
          requestSignal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, unmount } = renderHook(() =>
      useVerifyEmail({ callbackUrl: '/lobehub/', email: 'member@example.test' }),
    );

    let request: Promise<void>;
    act(() => {
      request = result.current.handleResendEmail();
    });
    unmount();
    const abortedOnUnmount = requestSignal?.aborted;
    if (!abortedOnUnmount) rejectRequest?.(new Error('finish legacy request'));
    await act(async () => request!);

    expect(abortedOnUnmount).toBe(true);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('aborts OTP send and suppresses feedback after the page unmounts', async () => {
    let rejectRequest: ((reason: Error) => void) | undefined;
    let requestSignal: AbortSignal | undefined;
    mocks.sendVerificationOtp.mockImplementation(
      ({ fetchOptions }: { fetchOptions?: { signal?: AbortSignal } }) =>
        new Promise((_resolve, reject) => {
          requestSignal = fetchOptions?.signal;
          rejectRequest = reject;
          requestSignal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, unmount } = renderHook(() =>
      useVerifyEmail({ callbackUrl: '/lobehub/', email: 'member@example.test' }),
    );

    let request: Promise<void>;
    act(() => {
      request = result.current.handleRequestOtp();
    });
    unmount();
    const abortedOnUnmount = requestSignal?.aborted;
    if (!abortedOnUnmount) rejectRequest?.(new Error('finish legacy request'));
    await act(async () => request!);

    expect(abortedOnUnmount).toBe(true);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('aborts OTP verification without redirecting after the page unmounts', async () => {
    let finishRequest: ((value: { data: { status: boolean }; error: null }) => void) | undefined;
    let requestSignal: AbortSignal | undefined;
    mocks.verifyEmailOtp.mockImplementation(
      ({ fetchOptions }: { fetchOptions?: { signal?: AbortSignal } }) =>
        new Promise((resolve, reject) => {
          requestSignal = fetchOptions?.signal;
          finishRequest = resolve;
          requestSignal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onVerified = vi.fn();
    const { result, unmount } = renderHook(() =>
      useVerifyEmail({
        callbackUrl: '/lobehub/onboarding',
        email: 'member@example.test',
        onVerified,
      }),
    );

    let request: Promise<void>;
    act(() => {
      request = result.current.handleVerifyOtp('123456');
    });
    unmount();
    const abortedOnUnmount = requestSignal?.aborted;
    finishRequest?.({ data: { status: true }, error: null });
    await act(async () => request!);

    expect(abortedOnUnmount).toBe(true);
    expect(onVerified).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('aborts an old mailbox request and resets verification state when the email changes', async () => {
    mocks.sendVerificationEmail.mockResolvedValue({ data: { status: true }, error: null });
    mocks.sendVerificationOtp.mockResolvedValue({ data: { success: true }, error: null });
    const onVerified = vi.fn();
    const { rerender, result } = renderHook(
      ({ email }) => useVerifyEmail({ callbackUrl: '/lobehub/onboarding', email, onVerified }),
      { initialProps: { email: 'account-a@example.test' } },
    );

    await act(async () => {
      await result.current.handleResendEmail();
      await result.current.handleRequestOtp();
    });
    expect(result.current.emailResendSeconds).toBe(60);
    expect(result.current.mode).toBe('otp');
    expect(result.current.otpResendSeconds).toBe(60);

    let finishOldRequest: ((value: { data: { status: boolean }; error: null }) => void) | undefined;
    let oldRequestSignal: AbortSignal | undefined;
    mocks.verifyEmailOtp.mockImplementationOnce(
      ({ fetchOptions }: { fetchOptions?: { signal?: AbortSignal } }) =>
        new Promise((resolve) => {
          oldRequestSignal = fetchOptions?.signal;
          finishOldRequest = resolve;
        }),
    );
    mocks.error.mockClear();
    mocks.success.mockClear();

    let oldRequest: Promise<void>;
    act(() => {
      oldRequest = result.current.handleVerifyOtp('123456');
    });
    rerender({ email: 'account-b@example.test' });
    const abortedAfterRerender = oldRequestSignal?.aborted;
    finishOldRequest?.({ data: { status: true }, error: null });
    await act(async () => oldRequest!);

    expect(abortedAfterRerender).toBe(true);
    expect(result.current.mode).toBe('link');
    expect(result.current.emailResendSeconds).toBe(0);
    expect(result.current.otpResendSeconds).toBe(0);
    expect(result.current.requestingOtp).toBe(false);
    expect(result.current.verifyingOtp).toBe(false);
    expect(onVerified).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('does not apply an old verification result after the callback changes', async () => {
    let finishOldRequest: ((value: { data: { status: boolean }; error: null }) => void) | undefined;
    let oldRequestSignal: AbortSignal | undefined;
    mocks.verifyEmailOtp.mockImplementationOnce(
      ({ fetchOptions }: { fetchOptions?: { signal?: AbortSignal } }) =>
        new Promise((resolve) => {
          oldRequestSignal = fetchOptions?.signal;
          finishOldRequest = resolve;
        }),
    );
    const onVerified = vi.fn();
    const { rerender, result } = renderHook(
      ({ callbackUrl }) =>
        useVerifyEmail({
          callbackUrl,
          email: 'member@example.test',
          onVerified,
        }),
      { initialProps: { callbackUrl: '/lobehub/account-a' } },
    );

    let oldRequest: Promise<void>;
    act(() => {
      oldRequest = result.current.handleVerifyOtp('123456');
    });
    rerender({ callbackUrl: '/lobehub/account-b' });
    const abortedAfterRerender = oldRequestSignal?.aborted;
    finishOldRequest?.({ data: { status: true }, error: null });
    await act(async () => oldRequest!);

    expect(abortedAfterRerender).toBe(true);
    expect(onVerified).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
