import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  changePassword: vi.fn(),
  createAuthClient: vi.fn(() => ({
    changePassword: mocks.changePassword,
    emailOtp: { sendVerificationOtp: vi.fn(), verifyEmail: vi.fn() },
    phoneNumber: { sendOtp: vi.fn(), verify: vi.fn() },
  })),
  emailOTPClient: vi.fn(() => ({ id: 'email-otp-client' })),
  phoneNumberClient: vi.fn(() => ({ id: 'phone-number-client' })),
}));

vi.mock('better-auth/client/plugins', () => ({
  adminClient: vi.fn(() => ({ id: 'admin-client' })),
  emailOTPClient: mocks.emailOTPClient,
  genericOAuthClient: vi.fn(() => ({ id: 'generic-oauth-client' })),
  inferAdditionalFields: vi.fn(() => ({ id: 'additional-fields-client' })),
  magicLinkClient: vi.fn(() => ({ id: 'magic-link-client' })),
  phoneNumberClient: mocks.phoneNumberClient,
}));

vi.mock('better-auth/react', () => ({ createAuthClient: mocks.createAuthClient }));

describe('Better Auth web client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('registers the existing email OTP client plugin', async () => {
    const client = await import('./auth-client');

    expect(mocks.emailOTPClient).toHaveBeenCalledTimes(1);
    expect(mocks.createAuthClient).toHaveBeenCalledWith(
      expect.objectContaining({
        plugins: expect.arrayContaining([expect.objectContaining({ id: 'email-otp-client' })]),
      }),
    );
    expect(client.changePassword).toBe(mocks.changePassword);
  });

  it('registers phone OTP support and exposes the phone client', async () => {
    const client = await import('./auth-client');

    expect(mocks.phoneNumberClient).toHaveBeenCalledTimes(1);
    expect(mocks.createAuthClient).toHaveBeenCalledWith(
      expect.objectContaining({
        plugins: expect.arrayContaining([expect.objectContaining({ id: 'phone-number-client' })]),
      }),
    );
    expect(client.phoneNumber).toEqual(
      expect.objectContaining({ sendOtp: expect.any(Function), verify: expect.any(Function) }),
    );
  });
});
