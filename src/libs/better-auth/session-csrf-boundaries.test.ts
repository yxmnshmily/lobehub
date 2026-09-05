// @vitest-environment node
import { parseSetCookieHeader } from 'better-auth/cookies';
import { admin } from 'better-auth/plugins';
import { getTestInstance } from 'better-auth/test';
import { describe, expect, it } from 'vitest';

const baseURL = 'https://travel.example.test';
const accounts = {
  admin: { email: 'admin@example.test', name: 'Admin', password: 'Test-only-admin-123!' },
  a: { email: 'session-a@example.test', name: 'Session A', password: 'Test-only-a-123!' },
  b: { email: 'session-b@example.test', name: 'Session B', password: 'Test-only-b-123!' },
} as const;

const createHarness = async () => {
  const instance = await getTestInstance(
    {
      basePath: '/api/auth',
      baseURL,
      advanced: { disableCSRFCheck: false, disableOriginCheck: false },
      emailAndPassword: {
        enabled: true,
        revokeSessionsOnPasswordReset: true,
        sendResetPassword: async () => {},
      },
      plugins: [admin()],
      rateLimit: { enabled: false },
      trustedOrigins: [baseURL],
      user: { changeEmail: { enabled: true } },
    },
    { disableTestUser: true },
  );
  const request = (
    pathname: string,
    body: unknown,
    options?: { headers?: HeadersInit; origin?: string },
  ) => {
    const headers = new Headers(options?.headers);
    headers.set('content-type', 'application/json');
    headers.set('origin', options?.origin ?? baseURL);
    return instance.auth.handler(
      new Request(`${baseURL}${pathname}`, {
        body: JSON.stringify(body),
        headers,
        method: 'POST',
      }),
    );
  };

  const signUp = async (account: (typeof accounts)[keyof typeof accounts]) => {
    const result = await instance.client.signUp.email(account);
    expect(result.error).toBeNull();
    return result.data!.user.id;
  };

  const signInWithCookie = async (email: string, password: string) => {
    const response = await request('/api/auth/sign-in/email', { email, password });
    const cookies = parseSetCookieHeader(response.headers.get('set-cookie') || '');
    let cookieHeader: string | undefined;
    for (const [name, cookie] of cookies) {
      if (name.endsWith('.session_token')) cookieHeader = `${name}=${cookie.value}`;
    }

    expect(response.status).toBe(200);
    expect(Boolean(cookieHeader)).toBe(true);
    return new Headers({ cookie: cookieHeader });
  };

  const hasSession = async (headers: Headers) =>
    Boolean(await instance.auth.api.getSession({ headers }));
  const read = (pathname: string, headers: Headers) =>
    instance.auth.handler(new Request(`${baseURL}${pathname}`, { headers }));

  return { hasSession, instance, read, request, signInWithCookie, signUp };
};

describe('Better Auth CSRF and cookie session boundaries', () => {
  it('signs out only the current cookie session and leaves other users untouched', async () => {
    const harness = await createHarness();
    await harness.signUp(accounts.a);
    await harness.signUp(accounts.b);
    const [sessionA1, sessionA2, sessionB] = await Promise.all([
      harness.signInWithCookie(accounts.a.email, accounts.a.password),
      harness.signInWithCookie(accounts.a.email, accounts.a.password),
      harness.signInWithCookie(accounts.b.email, accounts.b.password),
    ]);

    const response = await harness.request('/api/auth/sign-out', {}, { headers: sessionA1 });

    expect(response.status).toBe(200);
    expect(await harness.hasSession(sessionA1)).toBe(false);
    expect(await harness.hasSession(sessionA2)).toBe(true);
    expect(await harness.hasSession(sessionB)).toBe(true);
  });

  it('explicitly revokes all current-user devices without affecting another user', async () => {
    const harness = await createHarness();
    await harness.signUp(accounts.a);
    await harness.signUp(accounts.b);
    const [sessionA1, sessionA2, sessionB] = await Promise.all([
      harness.signInWithCookie(accounts.a.email, accounts.a.password),
      harness.signInWithCookie(accounts.a.email, accounts.a.password),
      harness.signInWithCookie(accounts.b.email, accounts.b.password),
    ]);

    const response = await harness.request('/api/auth/revoke-sessions', {}, { headers: sessionA1 });

    expect(response.status).toBe(200);
    expect(await harness.hasSession(sessionA1)).toBe(false);
    expect(await harness.hasSession(sessionA2)).toBe(false);
    expect(await harness.hasSession(sessionB)).toBe(true);
  });

  it('rotates sessions and rejects the old password after an authenticated password change', async () => {
    const harness = await createHarness();
    await harness.signUp(accounts.a);
    const [sessionA1, sessionA2] = await Promise.all([
      harness.signInWithCookie(accounts.a.email, accounts.a.password),
      harness.signInWithCookie(accounts.a.email, accounts.a.password),
    ]);
    const nextPassword = 'Test-only-a-changed-456!';

    const changed = await harness.request(
      '/api/auth/change-password',
      {
        currentPassword: accounts.a.password,
        newPassword: nextPassword,
        revokeOtherSessions: true,
      },
      { headers: sessionA1 },
    );
    expect(changed.status).toBe(200);
    expect(await harness.hasSession(sessionA1)).toBe(false);
    expect(await harness.hasSession(sessionA2)).toBe(false);

    const stalePassword = await harness.request('/api/auth/sign-in/email', {
      email: accounts.a.email,
      password: accounts.a.password,
    });
    expect(stalePassword.status).toBe(401);
    expect(stalePassword.headers.has('set-cookie')).toBe(false);

    const refreshed = await harness.signInWithCookie(accounts.a.email, nextPassword);
    expect(await harness.hasSession(refreshed)).toBe(true);
  });

  it('rejects a cross-origin cookie write without revoking the active session', async () => {
    const harness = await createHarness();
    await harness.signUp(accounts.a);
    const session = await harness.signInWithCookie(accounts.a.email, accounts.a.password);

    const rejected = await harness.request(
      '/api/auth/sign-out',
      {},
      { headers: session, origin: 'https://attacker.example.test' },
    );

    expect(rejected.status).toBe(403);
    expect(await harness.hasSession(session)).toBe(true);
  });

  it('invalidates stored cookies immediately after admin ban and account deletion', async () => {
    const harness = await createHarness();
    const [adminId, userAId, userBId] = await Promise.all([
      harness.signUp(accounts.admin),
      harness.signUp(accounts.a),
      harness.signUp(accounts.b),
    ]);
    const context = await harness.instance.auth.$context;
    await context.internalAdapter.updateUser(adminId, { role: 'admin' });
    const [adminSession, sessionA1, sessionA2, sessionB1, sessionB2] = await Promise.all([
      harness.signInWithCookie(accounts.admin.email, accounts.admin.password),
      harness.signInWithCookie(accounts.a.email, accounts.a.password),
      harness.signInWithCookie(accounts.a.email, accounts.a.password),
      harness.signInWithCookie(accounts.b.email, accounts.b.password),
      harness.signInWithCookie(accounts.b.email, accounts.b.password),
    ]);

    const banned = await harness.request(
      '/api/auth/admin/ban-user',
      { userId: userAId },
      { headers: adminSession },
    );
    const deleted = await harness.request(
      '/api/auth/admin/remove-user',
      { userId: userBId },
      { headers: adminSession },
    );

    expect(banned.status).toBe(200);
    expect(deleted.status).toBe(200);
    expect(await harness.hasSession(sessionA1)).toBe(false);
    expect(await harness.hasSession(sessionA2)).toBe(false);
    expect(await harness.hasSession(sessionB1)).toBe(false);
    expect(await harness.hasSession(sessionB2)).toBe(false);
    expect(await harness.hasSession(adminSession)).toBe(true);
    expect((await harness.read('/api/auth/list-sessions', sessionA1)).status).toBe(401);
    expect((await harness.read('/api/auth/list-sessions', sessionA2)).status).toBe(401);
    expect((await harness.read('/api/auth/list-sessions', sessionB1)).status).toBe(401);
    expect((await harness.read('/api/auth/list-sessions', sessionB2)).status).toBe(401);
    expect((await harness.read('/api/auth/list-sessions', adminSession)).status).toBe(200);
  });
});
