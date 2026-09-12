import { magicLink } from 'better-auth/plugins';
import { getTestInstance } from 'better-auth/test';
import { describe, expect, it, vi } from 'vitest';

import { getMountedAuthEmailUrl } from './email-templates/auth-brand';
import {
  oneTimeEmailVerificationToken,
  registerEmailVerificationToken,
} from './email-verification-token';

const baseURL = 'https://travel.example.test';
const accounts = {
  a: { email: 'security-a@example.test', name: 'Security A', password: 'Test-only-a-123!' },
  b: { email: 'security-b@example.test', name: 'Security B', password: 'Test-only-b-123!' },
} as const;

const createHarness = async (options?: {
  rateLimit?: boolean;
  resetExpiresIn?: number;
  verificationExpiresIn?: number;
}) => {
  const resetLinks = new Map<string, string[]>();
  const verificationLinks = new Map<string, string[]>();
  const remember = (store: Map<string, string[]>, email: string, url: string) => {
    store.set(email, [...(store.get(email) || []), url]);
  };
  const instanceRef: {
    current?: {
      auth: {
        $context: Promise<{
          internalAdapter: Parameters<typeof registerEmailVerificationToken>[0];
        }>;
      };
    };
  } = {};
  const instance = await getTestInstance(
    {
      basePath: '/api/auth',
      baseURL,
      emailAndPassword: {
        enabled: true,
        resetPasswordTokenExpiresIn: options?.resetExpiresIn,
        requireEmailVerification: true,
        revokeSessionsOnPasswordReset: true,
        sendResetPassword: async ({ user, url }) => {
          remember(resetLinks, user.email, getMountedAuthEmailUrl(url, baseURL));
        },
      },
      emailVerification: {
        autoSignInAfterVerification: true,
        expiresIn: options?.verificationExpiresIn ?? 3600,
        sendVerificationEmail: async ({ token, user, url }) => {
          if (!instanceRef.current) throw new Error('Test auth instance is not initialized');
          const context = await instanceRef.current.auth.$context;
          await registerEmailVerificationToken(context.internalAdapter, {
            email: user.email,
            expiresInSeconds: options?.verificationExpiresIn ?? 3600,
            token,
          });
          remember(verificationLinks, user.email, getMountedAuthEmailUrl(url, baseURL));
        },
      },
      plugins: [oneTimeEmailVerificationToken()],
      rateLimit: options?.rateLimit
        ? {
            customRules: { '/send-verification-email': { max: 3, window: 60 } },
            enabled: true,
          }
        : { enabled: false },
      user: { changeEmail: { enabled: true } },
    },
    { disableTestUser: true },
  );
  instanceRef.current = instance;

  const request = (pathname: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    if (!headers.has('origin')) headers.set('origin', baseURL);

    return instance.auth.handler(new Request(`${baseURL}${pathname}`, { ...init, headers }));
  };
  const latestVerificationToken = (email: string) => {
    const links = verificationLinks.get(email) || [];
    const url = links.at(-1);
    return url ? new URL(url).searchParams.get('token') : null;
  };
  const latestResetToken = (email: string) => {
    const url = resetLinks.get(email)?.at(-1);
    return url ? new URL(url).pathname.split('/').at(-1) : null;
  };
  const signIn = async (email: string, password: string) => {
    const response = await request('/api/auth/sign-in/email', {
      body: JSON.stringify({ callbackURL: '/lobehub/', email, password }),
      method: 'POST',
    });
    const payload = response.status === 200 ? await response.clone().json() : null;
    const headers = new Headers(
      payload?.token ? { authorization: `Bearer ${payload.token}` } : undefined,
    );
    return { headers, response };
  };

  return {
    instance,
    latestResetToken,
    latestVerificationToken,
    request,
    resetLinks,
    signIn,
    verificationLinks,
  };
};

const signUp = async (
  harness: Awaited<ReturnType<typeof createHarness>>,
  account: (typeof accounts)[keyof typeof accounts],
) => {
  const result = await harness.instance.client.signUp.email({
    ...account,
    callbackURL: '/lobehub/onboarding',
  });
  expect(result.error).toBeNull();
};

const verifyLatest = async (harness: Awaited<ReturnType<typeof createHarness>>, email: string) => {
  const token = harness.latestVerificationToken(email);
  expect(token).toBeTruthy();
  return harness.request(`/api/auth/verify-email?token=${encodeURIComponent(token!)}`, {
    method: 'GET',
  });
};

describe('Better Auth verification security boundaries', () => {
  it('denies unverified sign-in and does not create a session for tampered or replayed tokens', async () => {
    const harness = await createHarness();
    await signUp(harness, accounts.a);

    const unverifiedLogin = await harness.signIn(accounts.a.email, accounts.a.password);
    expect(unverifiedLogin.response.status).toBe(403);
    expect(
      Boolean(await harness.instance.auth.api.getSession({ headers: unverifiedLogin.headers })),
    ).toBe(false);

    const token = harness.latestVerificationToken(accounts.a.email);
    expect(token).toBeTruthy();
    const tampered = await harness.request(
      `/api/auth/verify-email?token=${encodeURIComponent(`${token!}tampered`)}`,
      { method: 'GET' },
    );
    expect(tampered.status).toBe(401);
    expect(tampered.headers.has('set-cookie')).toBe(false);

    const verified = await verifyLatest(harness, accounts.a.email);
    expect(verified.status).toBe(200);

    const deliveredVerificationCount = harness.verificationLinks.get(accounts.a.email)?.length;
    const verifiedLogin = await harness.signIn(accounts.a.email, accounts.a.password);
    expect(verifiedLogin.response.status).toBe(200);
    expect(
      Boolean(await harness.instance.auth.api.getSession({ headers: verifiedLogin.headers })),
    ).toBe(true);
    expect(harness.verificationLinks.get(accounts.a.email)?.length).toBe(
      deliveredVerificationCount,
    );

    const replayed = await harness.request(
      `/api/auth/verify-email?token=${encodeURIComponent(token!)}`,
      { method: 'GET' },
    );
    expect(replayed.status).toBe(401);
    expect(replayed.headers.has('set-cookie')).toBe(false);
    expect(Boolean(await harness.instance.auth.api.getSession({ headers: new Headers() }))).toBe(
      false,
    );
  });

  it('rejects expired verification tokens without creating a session', async () => {
    const harness = await createHarness({ verificationExpiresIn: -1 });
    await signUp(harness, accounts.a);

    const expired = await verifyLatest(harness, accounts.a.email);
    expect(expired.status).toBe(401);
    expect(expired.headers.has('set-cookie')).toBe(false);
    expect(Boolean(await harness.instance.auth.api.getSession({ headers: new Headers() }))).toBe(
      false,
    );
  });

  it('rejects an external verification callback without consuming the valid token', async () => {
    const harness = await createHarness();
    await signUp(harness, accounts.a);
    const token = harness.latestVerificationToken(accounts.a.email);
    expect(token).toBeTruthy();

    const externalCallback = await harness.request(
      `/api/auth/verify-email?token=${encodeURIComponent(token!)}&callbackURL=${encodeURIComponent('https://attacker.example.test/steal')}`,
      { method: 'GET' },
    );
    expect(externalCallback.status).not.toBe(200);
    expect(externalCallback.headers.has('set-cookie')).toBe(false);

    const safeRetry = await harness.request(
      `/api/auth/verify-email?token=${encodeURIComponent(token!)}&callbackURL=${encodeURIComponent('/lobehub/onboarding')}`,
      { method: 'GET', redirect: 'manual' },
    );
    expect(safeRetry.status).toBe(302);
    expect(safeRetry.headers.get('location')).toBe('/lobehub/onboarding');
  });

  it('keeps only the newest controlled token valid across concurrent QQ-mailbox resends', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-03T00:00:00.000Z'));

    try {
      const harness = await createHarness();
      const mixedCaseEmail = 'Traveler.QQ@QQ.COM';
      const normalizedEmail = mixedCaseEmail.toLowerCase();
      const result = await harness.instance.client.signUp.email({
        callbackURL: '/lobehub/onboarding',
        email: mixedCaseEmail,
        name: '旅行顾问',
        password: 'Test-only-qq-123!',
      });
      expect(result.error).toBeNull();

      const originalToken = harness.latestVerificationToken(normalizedEmail);
      expect(originalToken).toBeTruthy();
      vi.setSystemTime(new Date('2026-09-03T00:00:02.000Z'));

      const resend = () =>
        harness.request('/api/auth/send-verification-email', {
          body: JSON.stringify({
            callbackURL: '/lobehub/onboarding',
            email: mixedCaseEmail,
          }),
          method: 'POST',
        });
      const responses = await Promise.all([resend(), resend(), resend()]);
      expect(responses.map(({ status }) => status)).toEqual([200, 200, 200]);

      const delivered = harness.verificationLinks.get(normalizedEmail) || [];
      const resendTokens = delivered
        .slice(1)
        .map((url) => new URL(url).searchParams.get('token'))
        .filter((token): token is string => Boolean(token));
      expect(resendTokens).toHaveLength(3);
      expect(new Set(resendTokens)).toHaveLength(1);
      const newestToken = resendTokens[0];
      expect(newestToken).not.toBe(originalToken);

      const stale = await harness.request(
        `/api/auth/verify-email?token=${encodeURIComponent(originalToken!)}`,
        { method: 'GET' },
      );
      expect(stale.status).toBe(401);

      const verified = await harness.request(
        `/api/auth/verify-email?token=${encodeURIComponent(newestToken)}`,
        { method: 'GET' },
      );
      expect(verified.status).toBe(200);

      const replayedConcurrentCopies = await Promise.all(
        resendTokens.map((token) =>
          harness.request(`/api/auth/verify-email?token=${encodeURIComponent(token)}`, {
            method: 'GET',
          }),
        ),
      );
      expect(replayedConcurrentCopies.map(({ status }) => status)).toEqual([401, 401, 401]);
      expect((await harness.signIn(mixedCaseEmail, 'Test-only-qq-123!')).response.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns the same response for unknown addresses and rate-limits repeated resends', async () => {
    const harness = await createHarness({ rateLimit: true });
    await signUp(harness, accounts.a);

    const existing = await harness.request('/api/auth/send-verification-email', {
      body: JSON.stringify({ callbackURL: '/lobehub/onboarding', email: accounts.a.email }),
      method: 'POST',
    });
    const unknown = await harness.request('/api/auth/send-verification-email', {
      body: JSON.stringify({
        callbackURL: '/lobehub/onboarding',
        email: 'unknown@example.test',
      }),
      method: 'POST',
    });
    expect(existing.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await existing.json()).toEqual(await unknown.json());

    const third = await harness.request('/api/auth/send-verification-email', {
      body: JSON.stringify({ callbackURL: '/lobehub/onboarding', email: accounts.a.email }),
      method: 'POST',
    });
    const limited = await harness.request('/api/auth/send-verification-email', {
      body: JSON.stringify({ callbackURL: '/lobehub/onboarding', email: accounts.a.email }),
      method: 'POST',
    });
    expect(third.status).toBe(200);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('x-retry-after'))).toBeGreaterThan(0);
  });

  it('returns the same password-reset response without sending for an unknown account', async () => {
    const harness = await createHarness();
    await signUp(harness, accounts.a);

    const existing = await harness.request('/api/auth/request-password-reset', {
      body: JSON.stringify({ email: accounts.a.email, redirectTo: '/lobehub/reset-password' }),
      method: 'POST',
    });
    const unknownEmail = 'unknown-reset@example.test';
    const unknown = await harness.request('/api/auth/request-password-reset', {
      body: JSON.stringify({ email: unknownEmail, redirectTo: '/lobehub/reset-password' }),
      method: 'POST',
    });

    expect(existing.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await existing.json()).toEqual(await unknown.json());
    expect(harness.resetLinks.get(accounts.a.email)).toHaveLength(1);
    expect(harness.resetLinks.has(unknownEmail)).toBe(false);
  });

  it.each([
    'https://evil.example/reset',
    '//evil.example/reset',
    '/%2F%2Fevil.example/reset',
    '/%255C%255Cevil.example/reset',
  ])(
    'replaces an external password-reset callback without changing the generic response: %s',
    async (redirectTo) => {
      const harness = await createHarness();
      await signUp(harness, accounts.a);

      const response = await harness.request('/api/auth/request-password-reset', {
        body: JSON.stringify({ email: accounts.a.email, redirectTo }),
        method: 'POST',
      });

      expect(response.status).toBe(200);
      const resetUrl = harness.resetLinks.get(accounts.a.email)?.at(-1);
      expect(resetUrl).toBeTruthy();
      const parsed = new URL(resetUrl!);
      expect(parsed.origin).toBe(baseURL);
      expect(parsed.pathname).toMatch(/^\/lobehub\/api\/auth\/reset-password\//);
      expect(parsed.searchParams.get('callbackURL')).toBe('/lobehub/');
    },
  );

  it('returns the same magic-link response for existing and unknown accounts', async () => {
    const deliveredTo: string[] = [];
    const instance = await getTestInstance(
      {
        basePath: '/api/auth',
        baseURL,
        emailAndPassword: { enabled: true },
        plugins: [
          magicLink({
            sendMagicLink: async ({ email }) => {
              deliveredTo.push(email);
            },
          }),
        ],
        rateLimit: { enabled: false },
      },
      { disableTestUser: true },
    );
    await instance.client.signUp.email(accounts.a);
    const requestMagicLink = (email: string) =>
      instance.auth.handler(
        new Request(`${baseURL}/api/auth/sign-in/magic-link`, {
          body: JSON.stringify({ callbackURL: '/lobehub/', email }),
          headers: { 'content-type': 'application/json', 'origin': baseURL },
          method: 'POST',
        }),
      );
    const unknownEmail = 'unknown-magic@example.test';
    const existing = await requestMagicLink(accounts.a.email);
    const unknown = await requestMagicLink(unknownEmail);

    expect(existing.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await existing.json()).toEqual(await unknown.json());
    expect(deliveredTo).toEqual([accounts.a.email, unknownEmail]);
  });
});

describe('Better Auth account mutation isolation', () => {
  it('invalidates old email tokens and credentials after a verified email change', async () => {
    const harness = await createHarness();
    await signUp(harness, accounts.a);
    const originalToken = harness.latestVerificationToken(accounts.a.email);
    expect((await verifyLatest(harness, accounts.a.email)).status).toBe(200);
    const login = await harness.signIn(accounts.a.email, accounts.a.password);
    expect(login.response.status).toBe(200);

    const nextEmail = 'security-a-updated@example.test';
    const change = await harness.request('/api/auth/change-email', {
      body: JSON.stringify({ callbackURL: '/lobehub/settings/profile', newEmail: nextEmail }),
      headers: login.headers,
      method: 'POST',
    });
    expect(change.status).toBe(200);
    const changeToken = harness.latestVerificationToken(nextEmail);
    expect(changeToken).toBeTruthy();
    expect((await harness.signIn(nextEmail, accounts.a.password)).response.status).not.toBe(200);
    expect((await harness.signIn(accounts.a.email, accounts.a.password)).response.status).toBe(200);

    const confirm = await harness.request(
      `/api/auth/verify-email?token=${encodeURIComponent(changeToken!)}`,
      { headers: login.headers, method: 'GET' },
    );
    expect(confirm.status).toBe(200);
    expect((await harness.signIn(accounts.a.email, accounts.a.password)).response.status).not.toBe(
      200,
    );
    expect((await harness.signIn(nextEmail, accounts.a.password)).response.status).toBe(200);

    for (const staleToken of [originalToken, changeToken]) {
      expect(staleToken).toBeTruthy();
      const replay = await harness.request(
        `/api/auth/verify-email?token=${encodeURIComponent(staleToken!)}`,
        { method: 'GET' },
      );
      expect(replay.status).toBe(401);
      expect(replay.headers.has('set-cookie')).toBe(false);
    }
  });

  it('revokes only the reset account sessions and keeps another account active', async () => {
    const harness = await createHarness();
    for (const account of Object.values(accounts)) {
      await signUp(harness, account);
      expect((await verifyLatest(harness, account.email)).status).toBe(200);
    }

    const [sessionA1, sessionA2, sessionB] = await Promise.all([
      harness.signIn(accounts.a.email, accounts.a.password),
      harness.signIn(accounts.a.email, accounts.a.password),
      harness.signIn(accounts.b.email, accounts.b.password),
    ]);
    expect(sessionA1.response.status).toBe(200);
    expect(sessionA2.response.status).toBe(200);
    expect(sessionB.response.status).toBe(200);

    const resetRequest = await harness.request('/api/auth/request-password-reset', {
      body: JSON.stringify({
        email: accounts.a.email,
        redirectTo: '/lobehub/reset-password',
      }),
      method: 'POST',
    });
    expect(resetRequest.status).toBe(200);
    const resetToken = harness.latestResetToken(accounts.a.email);
    expect(resetToken).toBeTruthy();

    const nextPassword = 'Test-only-a-reset-456!';
    const tampered = await harness.request('/api/auth/reset-password', {
      body: JSON.stringify({ newPassword: nextPassword, token: `${resetToken!}tampered` }),
      method: 'POST',
    });
    expect(tampered.status).toBe(400);
    expect(
      Boolean(await harness.instance.auth.api.getSession({ headers: sessionA1.headers })),
    ).toBe(true);

    const reset = await harness.request('/api/auth/reset-password', {
      body: JSON.stringify({ newPassword: nextPassword, token: resetToken }),
      method: 'POST',
    });
    expect(reset.status).toBe(200);
    expect(
      Boolean(await harness.instance.auth.api.getSession({ headers: sessionA1.headers })),
    ).toBe(false);
    expect(
      Boolean(await harness.instance.auth.api.getSession({ headers: sessionA2.headers })),
    ).toBe(false);
    expect(
      (await harness.instance.auth.api.getSession({ headers: sessionB.headers }))?.user.email,
    ).toBe(accounts.b.email);
    expect((await harness.signIn(accounts.a.email, accounts.a.password)).response.status).not.toBe(
      200,
    );
    expect((await harness.signIn(accounts.b.email, nextPassword)).response.status).not.toBe(200);
    expect((await harness.signIn(accounts.b.email, accounts.b.password)).response.status).toBe(200);

    const replay = await harness.request('/api/auth/reset-password', {
      body: JSON.stringify({ newPassword: nextPassword, token: resetToken }),
      method: 'POST',
    });
    expect(replay.status).toBe(400);

    const refreshedA = await harness.signIn(accounts.a.email, nextPassword);
    expect(refreshedA.response.status).toBe(200);
    const signOutB = await harness.request('/api/auth/sign-out', {
      body: '{}',
      headers: sessionB.headers,
      method: 'POST',
    });
    expect(signOutB.status).toBe(200);
    expect(Boolean(await harness.instance.auth.api.getSession({ headers: sessionB.headers }))).toBe(
      false,
    );
    expect(
      (await harness.instance.auth.api.getSession({ headers: refreshedA.headers }))?.user.email,
    ).toBe(accounts.a.email);
  });

  it('rejects an expired reset token without changing the password or active sessions', async () => {
    const harness = await createHarness({ resetExpiresIn: -1 });
    await signUp(harness, accounts.a);
    expect((await verifyLatest(harness, accounts.a.email)).status).toBe(200);
    const activeSession = await harness.signIn(accounts.a.email, accounts.a.password);
    expect(activeSession.response.status).toBe(200);

    const resetRequest = await harness.request('/api/auth/request-password-reset', {
      body: JSON.stringify({
        email: accounts.a.email,
        redirectTo: '/lobehub/reset-password',
      }),
      method: 'POST',
    });
    expect(resetRequest.status).toBe(200);
    const expiredToken = harness.latestResetToken(accounts.a.email);
    expect(expiredToken).toBeTruthy();

    const nextPassword = 'Test-only-expired-reset-456!';
    const expiredReset = await harness.request('/api/auth/reset-password', {
      body: JSON.stringify({ newPassword: nextPassword, token: expiredToken }),
      method: 'POST',
    });
    expect(expiredReset.status).toBe(400);
    expect(
      (await harness.instance.auth.api.getSession({ headers: activeSession.headers }))?.user.email,
    ).toBe(accounts.a.email);
    expect((await harness.signIn(accounts.a.email, accounts.a.password)).response.status).toBe(200);
    expect((await harness.signIn(accounts.a.email, nextPassword)).response.status).not.toBe(200);
  });
});
