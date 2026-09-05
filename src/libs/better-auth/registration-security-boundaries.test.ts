import { getTestInstance } from 'better-auth/test';
import { describe, expect, it } from 'vitest';

import { accountInputHardening } from './plugins/account-input-hardening';

const baseURL = 'https://registration.example.test';
const password = 'Test-only-registration-123!';

const createHarness = async (options?: {
  rateLimit?: boolean;
  requireEmailVerification?: boolean;
}) => {
  const requireEmailVerification = options?.requireEmailVerification ?? true;
  const instance = await getTestInstance(
    {
      basePath: '/api/auth',
      baseURL,
      emailAndPassword: {
        autoSignIn: !requireEmailVerification,
        enabled: true,
        maxPasswordLength: 64,
        minPasswordLength: 8,
        requireEmailVerification,
      },
      plugins: [accountInputHardening()],
      rateLimit: { enabled: options?.rateLimit ?? false },
    },
    { disableTestUser: true },
  );

  const request = (
    pathname: string,
    body: unknown,
    source = '198.51.100.10',
    authorization?: string,
  ) =>
    instance.auth.handler(
      new Request(`${baseURL}${pathname}`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
          'origin': baseURL,
          'x-forwarded-for': source,
          ...(authorization && { authorization }),
        },
        method: 'POST',
      }),
    );

  return { instance, request };
};

const signUpBody = (email: string, overrides?: Record<string, unknown>) => ({
  email,
  name: 'Traveler',
  password,
  ...overrides,
});

describe('Better Auth registration security boundaries', () => {
  it('stores one lowercase identity and rejects padded or compatibility-mutated variants', async () => {
    const { instance, request } = await createHarness();
    const created = await request('/api/auth/sign-up/email', signUpBody('Traveler@Example.Test'));
    expect(created.status).toBe(200);

    const caseVariant = await request(
      '/api/auth/sign-up/email',
      signUpBody('traveler@example.test'),
      '198.51.100.11',
    );
    expect(caseVariant.status).toBe(200);

    const padded = await request(
      '/api/auth/sign-up/email',
      signUpBody(' traveler@example.test '),
      '198.51.100.12',
    );
    const compatibilityVariant = await request(
      '/api/auth/sign-up/email',
      signUpBody('Ｔraveler@example.test'),
      '198.51.100.13',
    );
    expect(padded.status).toBe(400);
    expect(compatibilityVariant.status).toBe(400);

    const context = await instance.auth.$context;
    const users = await context.adapter.findMany<{ email: string }>({ model: 'user' });
    expect(users.map((user) => user.email)).toEqual(['traveler@example.test']);
  });

  it('returns a generic successful shape for both new and duplicate email sign-up', async () => {
    const { request } = await createHarness();
    const first = await request('/api/auth/sign-up/email', signUpBody('same@example.test'));
    const duplicate = await request(
      '/api/auth/sign-up/email',
      signUpBody('SAME@example.test'),
      '198.51.100.11',
    );

    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    const firstBody = await first.json();
    const duplicateBody = await duplicate.json();
    expect(Object.keys(firstBody).sort()).toEqual(Object.keys(duplicateBody).sort());
    expect(firstBody.token).toBeNull();
    expect(duplicateBody.token).toBeNull();
  });

  it.each([
    ['', 400],
    ['short', 400],
    ['a'.repeat(65), 400],
    [null, 400],
    [12345678, 400],
  ])('rejects an invalid password at the service boundary', async (invalidPassword, status) => {
    const { request } = await createHarness();
    const response = await request(
      '/api/auth/sign-up/email',
      signUpBody(`password-${String(invalidPassword).length}@example.test`, {
        password: invalidPassword,
      }),
    );
    expect(response.status).toBe(status);
    expect(response.headers.has('set-cookie')).toBe(false);
  });

  it('rate-limits repeated sign-up and sign-in from one source without affecting another source', async () => {
    const { request } = await createHarness({ rateLimit: true });
    const abusiveSource = '203.0.113.20';
    for (let index = 0; index < 3; index++) {
      const response = await request(
        '/api/auth/sign-in/email',
        { email: 'missing@example.test', password },
        abusiveSource,
      );
      expect(response.status).toBe(401);
    }
    const limitedSignIn = await request(
      '/api/auth/sign-in/email',
      { email: 'other@example.test', password },
      abusiveSource,
    );
    expect(limitedSignIn.status).toBe(429);

    const otherSource = await request(
      '/api/auth/sign-in/email',
      { email: 'other@example.test', password },
      '203.0.113.21',
    );
    expect(otherSource.status).toBe(401);

    for (let index = 0; index < 3; index++) {
      const response = await request(
        '/api/auth/sign-up/email',
        signUpBody(`rate-${index}@example.test`),
        abusiveSource,
      );
      expect(response.status).toBe(200);
    }
    const limitedSignUp = await request(
      '/api/auth/sign-up/email',
      signUpBody('rate-limited@example.test'),
      abusiveSource,
    );
    expect(limitedSignUp.status).toBe(429);
    const independentSignUp = await request(
      '/api/auth/sign-up/email',
      signUpBody('independent@example.test'),
      '203.0.113.22',
    );
    expect(independentSignUp.status).toBe(200);
  });

  it('rejects unsafe display names and avatar URLs before persistence', async () => {
    const { instance, request } = await createHarness();
    const unsafeName = await request(
      '/api/auth/sign-up/email',
      signUpBody('name@example.test', { name: 'Traveler\nAdmin' }),
    );
    const unsafeImage = await request(
      '/api/auth/sign-up/email',
      signUpBody('image@example.test', { image: 'javascript:alert(1)' }),
      '198.51.100.11',
    );
    expect(unsafeName.status).toBe(400);
    expect(unsafeImage.status).toBe(400);

    const context = await instance.auth.$context;
    const users = await context.adapter.findMany<{ email: string }>({ model: 'user' });
    expect(users).toHaveLength(0);
  });

  it('rejects unsafe profile updates without changing the stored user', async () => {
    const { instance, request } = await createHarness({ requireEmailVerification: false });
    const created = await request('/api/auth/sign-up/email', signUpBody('update@example.test'));
    expect(created.status).toBe(200);
    const createdBody = await created.json();
    expect(Boolean(createdBody.token)).toBe(true);
    const authorization = `Bearer ${createdBody.token}`;

    const unsafeName = await request(
      '/api/auth/update-user',
      { name: 'Traveler\nAdmin' },
      '198.51.100.20',
      authorization,
    );
    const unsafeImage = await request(
      '/api/auth/update-user',
      { image: 'data:text/html,unsafe' },
      '198.51.100.21',
      authorization,
    );
    expect(unsafeName.status).toBe(400);
    expect(unsafeImage.status).toBe(400);

    const session = await instance.auth.api.getSession({
      headers: new Headers({ authorization }),
    });
    expect(session?.user.name).toBe('Traveler');
    expect(session?.user.image).toBeNull();
  });
});
