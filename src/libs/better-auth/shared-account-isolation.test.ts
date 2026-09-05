import { getCookies } from 'better-auth/cookies';
import { getTestInstance } from 'better-auth/test';
import { describe, expect, it } from 'vitest';

const callbackURL = '/onboarding?callbackUrl=%2Findex.html';
const authOrigins = ['http://localhost:3010', 'https://travel.example.test'] as const;
const updatedAccount = {
  image: 'https://assets.example.test/avatar-a.png',
  name: 'Account A Updated',
  password: 'Test-only-a-updated-456!',
};
const accounts = [
  { email: 'account-a@example.test', name: 'Account A', password: 'Test-only-a-123!' },
  { email: 'account-b@example.test', name: 'Account B', password: 'Test-only-b-123!' },
] as const;

describe('shared website and LobeHub account isolation', () => {
  it.each(authOrigins)(
    'keeps verification, root cookies, sessions, account data, and sign-out isolated at %s',
    async (baseURL) => {
      const verificationLinks = new Map<string, string>();
      const instance = await getTestInstance(
        {
          basePath: '/api/auth',
          baseURL,
          emailAndPassword: {
            enabled: true,
            requireEmailVerification: true,
          },
          emailVerification: {
            autoSignInAfterVerification: false,
            sendVerificationEmail: async ({ user, url }) => {
              verificationLinks.set(user.email, url);
            },
          },
          user: {
            changeEmail: { enabled: true },
            fields: { image: 'avatar', name: 'fullName' },
            modelName: 'users',
          },
        },
        { disableTestUser: true },
      );

      const signIn = async (email: string, password: string) => {
        const response = await instance.auth.handler(
          new Request(`${baseURL}/api/auth/sign-in/email`, {
            body: JSON.stringify({ callbackURL: '/index.html', email, password }),
            headers: { 'content-type': 'application/json', 'origin': baseURL },
            method: 'POST',
          }),
        );
        const payload = response.status === 200 ? await response.clone().json() : null;
        const headers = new Headers(
          payload?.token ? { authorization: `Bearer ${payload.token}` } : undefined,
        );

        return { headers, payload, response };
      };

      for (const account of accounts) {
        const result = await instance.client.signUp.email({ ...account, callbackURL });
        expect(result.error).toBeNull();

        const verificationLink = verificationLinks.get(account.email);
        expect(verificationLink).toBeDefined();
        const verificationUrl = new URL(verificationLink!);
        expect(verificationUrl.origin).toBe(baseURL);
        expect(verificationUrl.pathname).toBe('/api/auth/verify-email');
        expect(verificationUrl.searchParams.get('callbackURL')).toBe(callbackURL);

        const token = verificationUrl.searchParams.get('token');
        expect(token).toBeTruthy();
        const verification = await instance.auth.api.verifyEmail({ query: { token: token! } });
        expect(verification.status).toBe(true);
      }

      const sessions = await Promise.all(
        accounts.map(({ email, password }) => signIn(email, password)),
      );

      for (const [index, current] of sessions.entries()) {
        expect(current.response.status).toBe(200);
        expect(current.response.headers.get('location')).toBe('/index.html');
        expect(current.payload?.user?.email).toBe(accounts[index].email);
      }

      for (const [index, current] of sessions.entries()) {
        const session = await instance.auth.api.getSession({ headers: current.headers });
        expect(session?.user.email).toBe(accounts[index].email);
        expect(session?.user.name).toBe(accounts[index].name);
        expect(session?.user.email).not.toBe(accounts[1 - index].email);
      }

      const updateResponse = await instance.auth.handler(
        new Request(`${baseURL}/api/auth/update-user`, {
          body: JSON.stringify({ image: updatedAccount.image, name: updatedAccount.name }),
          headers: {
            'authorization': sessions[0].headers.get('authorization') || '',
            'content-type': 'application/json',
            'origin': baseURL,
          },
          method: 'POST',
        }),
      );
      expect(updateResponse.status).toBe(200);

      const updatedSession = await instance.auth.api.getSession({ headers: sessions[0].headers });
      expect(updatedSession?.user.name).toBe(updatedAccount.name);
      expect(updatedSession?.user.image).toBe(updatedAccount.image);

      const untouchedSession = await instance.auth.api.getSession({ headers: sessions[1].headers });
      expect(untouchedSession?.user.name).toBe(accounts[1].name);
      expect(untouchedSession?.user.image).toBeNull();

      const changePasswordResponse = await instance.auth.handler(
        new Request(`${baseURL}/api/auth/change-password`, {
          body: JSON.stringify({
            currentPassword: accounts[0].password,
            newPassword: updatedAccount.password,
            revokeOtherSessions: false,
          }),
          headers: {
            'authorization': sessions[0].headers.get('authorization') || '',
            'content-type': 'application/json',
            'origin': baseURL,
          },
          method: 'POST',
        }),
      );
      expect(changePasswordResponse.status).toBe(200);

      expect((await signIn(accounts[0].email, accounts[0].password)).response.status).not.toBe(200);

      const updatedLogin = await signIn(accounts[0].email, updatedAccount.password);
      expect(updatedLogin.response.status).toBe(200);
      expect(updatedLogin.payload?.user).toMatchObject({
        email: accounts[0].email,
        image: updatedAccount.image,
        name: updatedAccount.name,
      });

      const untouchedLogin = await signIn(accounts[1].email, accounts[1].password);
      expect(untouchedLogin.response.status).toBe(200);
      expect(untouchedLogin.payload?.user).toMatchObject({
        email: accounts[1].email,
        image: null,
        name: accounts[1].name,
      });

      const sessionCookie = getCookies(instance.auth.options).sessionToken;
      expect(sessionCookie.attributes.path).toBe('/');
      expect(sessionCookie.attributes.httpOnly).toBe(true);
      expect(sessionCookie.attributes.sameSite).toBe('lax');
      expect(sessionCookie.attributes.secure).toBe(baseURL.startsWith('https://'));

      const signOutResponse = await instance.auth.handler(
        new Request(`${baseURL}/api/auth/sign-out`, {
          body: '{}',
          headers: {
            'authorization': sessions[0].headers.get('authorization') || '',
            'content-type': 'application/json',
            'origin': baseURL,
          },
          method: 'POST',
        }),
      );
      expect(signOutResponse.status).toBe(200);
      expect(Boolean(await instance.auth.api.getSession({ headers: sessions[0].headers }))).toBe(
        false,
      );
      expect(
        (await instance.auth.api.getSession({ headers: sessions[1].headers }))?.user.email,
      ).toBe(accounts[1].email);
    },
  );
});
