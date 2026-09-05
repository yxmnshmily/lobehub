import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChangePassword } from './useChangePassword';

const mocks = vi.hoisted(() => ({
  changePassword: vi.fn(),
  success: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@lobehub/ui/base-ui', () => ({ toast: { success: mocks.success } }));
vi.mock('@/libs/better-auth/auth-client', () => ({ changePassword: mocks.changePassword }));

describe('useChangePassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires the current password and a valid matching new password before calling auth', async () => {
    const { result } = renderHook(() => useChangePassword());

    await act(async () => {
      await result.current.submit({
        confirmPassword: 'short',
        currentPassword: '',
        newPassword: 'short',
      });
    });

    expect(result.current.error).toBe('profile.currentPasswordRequired');
    expect(mocks.changePassword).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.submit({
        confirmPassword: 'short',
        currentPassword: 'Old-password-123!',
        newPassword: 'short',
      });
    });

    expect(result.current.error).toBe('betterAuth.errors.passwordMinLength');

    await act(async () => {
      await result.current.submit({
        confirmPassword: 'a'.repeat(65),
        currentPassword: 'Old-password-123!',
        newPassword: 'a'.repeat(65),
      });
    });

    expect(result.current.error).toBe('betterAuth.errors.passwordMaxLength');

    await act(async () => {
      await result.current.submit({
        confirmPassword: '',
        currentPassword: 'Old-password-123!',
        newPassword: 'Updated-password-123!',
      });
    });

    expect(result.current.error).toBe('betterAuth.resetPassword.confirmPasswordRequired');

    await act(async () => {
      await result.current.submit({
        confirmPassword: 'different-password',
        currentPassword: 'Old-password-123!',
        newPassword: 'Updated-password-123!',
      });
    });

    expect(result.current.error).toBe('betterAuth.errors.passwordMismatch');
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });

  it('changes the password and explicitly revokes other sessions', async () => {
    mocks.changePassword.mockResolvedValue({ data: { status: true }, error: null });
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useChangePassword(onSuccess));

    await act(async () => {
      await result.current.submit({
        confirmPassword: 'Updated-password-123!',
        currentPassword: 'Old-password-123!',
        newPassword: 'Updated-password-123!',
      });
    });

    expect(mocks.changePassword).toHaveBeenCalledWith({
      currentPassword: 'Old-password-123!',
      newPassword: 'Updated-password-123!',
      revokeOtherSessions: true,
    });
    expect(mocks.success).toHaveBeenCalledWith('profile.changePasswordSuccess');
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('shows a neutral error without exposing backend details', async () => {
    mocks.changePassword.mockResolvedValue({
      data: null,
      error: { message: 'postgres://internal-host?token=secret-fixture', status: 500 },
    });
    const { result } = renderHook(() => useChangePassword());

    await act(async () => {
      await result.current.submit({
        confirmPassword: 'Updated-password-123!',
        currentPassword: 'Wrong-password-123!',
        newPassword: 'Updated-password-123!',
      });
    });

    expect(result.current.error).toBe('profile.changePasswordError');
    expect(result.current.error).not.toContain('internal-host');
    expect(result.current.error).not.toContain('secret-fixture');
  });

  it('coalesces rapid submissions into one password change', async () => {
    let finishRequest: ((value: { data: { status: boolean }; error: null }) => void) | undefined;
    mocks.changePassword.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRequest = resolve;
        }),
    );
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useChangePassword(onSuccess));
    const values = {
      confirmPassword: 'Updated-password-123!',
      currentPassword: 'Old-password-123!',
      newPassword: 'Updated-password-123!',
    };

    let firstRequest: Promise<boolean>;
    let secondRequest: Promise<boolean>;
    act(() => {
      firstRequest = result.current.submit(values);
      secondRequest = result.current.submit(values);
    });

    await waitFor(() => expect(mocks.changePassword).toHaveBeenCalledTimes(1));

    await act(async () => {
      finishRequest?.({ data: { status: true }, error: null });
      await Promise.all([firstRequest!, secondRequest!]);
    });

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(result.current.changing).toBe(false);
  });
});
