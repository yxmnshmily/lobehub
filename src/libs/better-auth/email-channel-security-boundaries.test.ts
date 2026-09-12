// @vitest-environment node
import { emailOTP, magicLink } from 'better-auth/plugins';
import { getTestInstance } from 'better-auth/test';
import { describe, expect, it, vi } from 'vitest';

const baseURL = 'https://mail-security.example.test';
const account = {
  email: 'qq-fixture@qq.com',
  name: 'Mail Fixture',
  password: 'Test-only-mail-123!',
};

const createRequest =
  (instance: { auth: { handler: (request: Request) => Promise<Response> } }) =>
  (pathname: string, body: unknown) =>
    instance.auth.handler(
      new Request(`${baseURL}/api/auth${pathname}`, {
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json', 'origin': baseURL },
        method: 'POST',
      }),
    );

describe('enabled Better Auth email channel boundaries', () => {
  it('keeps verification OTP resend responses identical for known and unknown accounts', async () => {
    const sendVerificationOTP = vi.fn();
    const instance = await getTestInstance(
      {
        baseURL,
        plugins: [
          emailOTP({
            generateOTP: () => 'otp-fixture',
            sendVerificationOnSignUp: false,
            sendVerificationOTP,
          }),
        ],
        rateLimit: { enabled: false },
      },
      { disableTestUser: true },
    );
    await instance.client.signUp.email(account);
    const request = createRequest(instance);

    const known = await request('/email-otp/send-verification-otp', {
      email: account.email,
      type: 'email-verification',
    });
    const unknown = await request('/email-otp/send-verification-otp', {
      email: 'unknown-fixture@example.test',
      type: 'email-verification',
    });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    await expect(known.json()).resolves.toEqual({ success: true });
    await expect(unknown.json()).resolves.toEqual({ success: true });
    expect(sendVerificationOTP).toHaveBeenCalledTimes(1);
  });

  it('keeps OTP password-reset responses identical for known and unknown accounts', async () => {
    const sendVerificationOTP = vi.fn();
    const instance = await getTestInstance(
      {
        baseURL,
        plugins: [
          emailOTP({
            generateOTP: () => 'otp-fixture',
            sendVerificationOnSignUp: false,
            sendVerificationOTP,
          }),
        ],
        rateLimit: { enabled: false },
      },
      { disableTestUser: true },
    );
    await instance.client.signUp.email(account);
    const request = createRequest(instance);

    const known = await request('/email-otp/request-password-reset', { email: account.email });
    const unknown = await request('/email-otp/request-password-reset', {
      email: 'unknown-fixture@example.test',
    });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    await expect(known.json()).resolves.toEqual({ success: true });
    await expect(unknown.json()).resolves.toEqual({ success: true });
    expect(sendVerificationOTP).toHaveBeenCalledTimes(1);
  });

  it('stops repeated OTP guesses at the configured attempt boundary', async () => {
    const instance = await getTestInstance(
      {
        baseURL,
        plugins: [
          emailOTP({
            allowedAttempts: 3,
            generateOTP: () => 'otp-fixture',
            sendVerificationOnSignUp: false,
            sendVerificationOTP: vi.fn(),
          }),
        ],
        rateLimit: { enabled: false },
      },
      { disableTestUser: true },
    );
    await instance.client.signUp.email(account);
    const request = createRequest(instance);
    await request('/email-otp/send-verification-otp', {
      email: account.email,
      type: 'email-verification',
    });

    for (let index = 0; index < 3; index++) {
      const response = await request('/email-otp/check-verification-otp', {
        email: account.email,
        otp: 'wrong-fixture',
        type: 'email-verification',
      });
      expect(response.status).toBe(400);
    }
    const exhausted = await request('/email-otp/check-verification-otp', {
      email: account.email,
      otp: 'wrong-fixture',
      type: 'email-verification',
    });
    expect(exhausted.status).toBe(403);
  });

  it('uses the same magic-link response shape for known and unknown accounts', async () => {
    const sendMagicLink = vi.fn();
    const instance = await getTestInstance(
      {
        baseURL,
        plugins: [magicLink({ sendMagicLink })],
        rateLimit: { enabled: false },
      },
      { disableTestUser: true },
    );
    await instance.client.signUp.email(account);
    const request = createRequest(instance);

    const known = await request('/sign-in/magic-link', { email: account.email });
    const unknown = await request('/sign-in/magic-link', {
      email: 'unknown-fixture@example.test',
    });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(Object.keys(await known.json()).sort()).toEqual(
      Object.keys(await unknown.json()).sort(),
    );
    expect(sendMagicLink).toHaveBeenCalledTimes(2);
  });
});
