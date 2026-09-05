import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useResetPassword } from './useResetPassword';

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  resetPassword: vi.fn(),
  success: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('antd', () => ({ Form: { useForm: () => [{}] } }));
vi.mock('@lobehub/ui/base-ui', () => ({
  toast: { error: mocks.error, success: mocks.success },
}));
vi.mock('@/libs/better-auth/auth-client', () => ({ resetPassword: mocks.resetPassword }));

describe('useResetPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates the password and returns to the matching sign-in account', async () => {
    mocks.resetPassword.mockResolvedValue({ data: { status: true }, error: null });
    const onSuccessRedirect = vi.fn();
    const { result } = renderHook(() =>
      useResetPassword({
        email: 'member@example.test',
        onSuccessRedirect,
        token: 'fake-reset-token',
      }),
    );

    await act(async () => {
      await result.current.handleResetPassword({
        confirmPassword: 'Updated-test-password-123!',
        newPassword: 'Updated-test-password-123!',
      });
    });

    expect(mocks.resetPassword).toHaveBeenCalledWith(
      expect.objectContaining({
        fetchOptions: { signal: expect.any(AbortSignal) },
        newPassword: 'Updated-test-password-123!',
        token: 'fake-reset-token',
      }),
    );
    expect(onSuccessRedirect).toHaveBeenCalledWith('/signin?email=member%40example.test');
    expect(mocks.success).toHaveBeenCalledWith('betterAuth.resetPassword.success');
  });

  it('does not submit or redirect without a reset token', async () => {
    const onSuccessRedirect = vi.fn();
    const { result } = renderHook(() =>
      useResetPassword({ email: 'member@example.test', onSuccessRedirect, token: null }),
    );

    await act(async () => {
      await result.current.handleResetPassword({
        confirmPassword: 'Updated-test-password-123!',
        newPassword: 'Updated-test-password-123!',
      });
    });

    expect(mocks.resetPassword).not.toHaveBeenCalled();
    expect(onSuccessRedirect).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith('betterAuth.resetPassword.invalidToken');
  });

  it('does not expose backend details when reset fails', async () => {
    mocks.resetPassword.mockResolvedValue({
      data: null,
      error: {
        code: 'INVALID_TOKEN',
        message: 'token=secret-fixture failed at http://internal-auth/reset',
        status: 400,
      },
    });
    const onSuccessRedirect = vi.fn();
    const { result } = renderHook(() =>
      useResetPassword({
        email: 'member@example.test',
        onSuccessRedirect,
        token: 'fake-reset-token',
      }),
    );

    await act(async () => {
      await result.current.handleResetPassword({
        confirmPassword: 'Updated-test-password-123!',
        newPassword: 'Updated-test-password-123!',
      });
    });

    expect(mocks.error).toHaveBeenCalledWith('betterAuth.resetPassword.invalidToken');
    expect(mocks.error).not.toHaveBeenCalledWith(expect.stringContaining('secret-fixture'));
    expect(onSuccessRedirect).not.toHaveBeenCalled();
  });

  it('coalesces rapid password reset submissions into one request', async () => {
    let finishRequest: ((value: { data: { status: boolean }; error: null }) => void) | undefined;
    mocks.resetPassword.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRequest = resolve;
        }),
    );
    const onSuccessRedirect = vi.fn();
    const { result } = renderHook(() =>
      useResetPassword({
        email: 'member@example.test',
        onSuccessRedirect,
        token: 'fake-reset-token',
      }),
    );
    const values = {
      confirmPassword: 'Updated-test-password-123!',
      newPassword: 'Updated-test-password-123!',
    };
    let firstRequest: Promise<void>;
    let secondRequest: Promise<void>;

    act(() => {
      firstRequest = result.current.handleResetPassword(values);
      secondRequest = result.current.handleResetPassword(values);
    });

    expect(mocks.resetPassword).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishRequest?.({ data: { status: true }, error: null });
      await Promise.all([firstRequest!, secondRequest!]);
    });
    expect(result.current.loading).toBe(false);
    expect(onSuccessRedirect).toHaveBeenCalledTimes(1);
  });

  it('releases the reset action when the password request never responds', async () => {
    vi.useFakeTimers();
    try {
      mocks.resetPassword.mockImplementation(() => new Promise(() => {}));
      const onSuccessRedirect = vi.fn();
      const { result } = renderHook(() =>
        useResetPassword({
          email: 'member@example.test',
          onSuccessRedirect,
          token: 'fake-reset-token',
        }),
      );
      let requestSettled = false;
      let request: Promise<void>;

      act(() => {
        request = result.current.handleResetPassword({
          confirmPassword: 'Updated-test-password-123!',
          newPassword: 'Updated-test-password-123!',
        });
        void request.finally(() => {
          requestSettled = true;
        });
      });
      expect(result.current.loading).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });

      expect(requestSettled).toBe(true);
      await act(async () => request!);
      expect(result.current.loading).toBe(false);
      expect(mocks.error).toHaveBeenCalledWith('betterAuth.resetPassword.error');
      expect(onSuccessRedirect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
