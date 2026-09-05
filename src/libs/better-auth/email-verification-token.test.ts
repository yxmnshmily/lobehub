import { getTestInstance } from 'better-auth/test';
import { describe, expect, it } from 'vitest';

import {
  oneTimeEmailVerificationToken,
  prepareEmailVerificationToken,
  registerEmailVerificationToken,
} from './email-verification-token';

interface RecordValue {
  expiresAt: Date;
  value: string;
}

const createAdapterHarness = () => {
  const records = new Map<string, RecordValue>();
  let failCreate = false;
  let failUpdate = false;

  const adapter = {
    consumeVerificationValue: async (identifier: string) => {
      const value = records.get(identifier) || null;
      records.delete(identifier);
      return value;
    },
    createVerificationValue: async (data: RecordValue & { identifier: string }) => {
      if (failCreate) {
        failCreate = false;
        throw new Error('injected create failure');
      }
      records.set(data.identifier, { expiresAt: data.expiresAt, value: data.value });
    },
    deleteVerificationByIdentifier: async (identifier: string) => {
      records.delete(identifier);
    },
    findVerificationValue: async (identifier: string) => records.get(identifier) || null,
    updateVerificationByIdentifier: async (
      identifier: string,
      data: RecordValue,
    ) => {
      if (failUpdate) {
        failUpdate = false;
        throw new Error('injected pointer update failure');
      }
      records.set(identifier, data);
    },
  };

  const latestPointer = () =>
    [...records.entries()].find(([identifier]) => identifier.includes(':latest:'));
  const hasUsableLatestToken = () => {
    const pointer = latestPointer();
    if (!pointer) return false;
    return records.has(
      [...records.keys()].find((identifier) => identifier.endsWith(`:token:${pointer[1].value}`)) ||
        '',
    );
  };

  return {
    adapter,
    failNextCreate: () => {
      failCreate = true;
    },
    failNextUpdate: () => {
      failUpdate = true;
    },
    hasUsableLatestToken,
    latestPointer,
    records,
  };
};

const register = (adapter: ReturnType<typeof createAdapterHarness>['adapter'], token: string) =>
  registerEmailVerificationToken(adapter, {
    email: 'traveler@example.test',
    expiresInSeconds: 3600,
    token,
  });

const authBaseURL = 'https://travel.example.test';
const createVerificationHandlerHarness = async (expiresIn = 3600) => {
  let verificationToken: string | undefined;
  let failVerificationWrite = false;
  const instanceRef: { current?: Awaited<ReturnType<typeof getTestInstance>> } = {};
  const instance = await getTestInstance(
    {
      basePath: '/api/auth',
      baseURL: authBaseURL,
      emailAndPassword: { enabled: true, requireEmailVerification: true },
      emailVerification: {
        autoSignInAfterVerification: true,
        expiresIn,
        sendVerificationEmail: async ({ token, user }) => {
          if (!instanceRef.current) throw new Error('Test auth instance is not initialized');
          verificationToken = token;
          const context = await instanceRef.current.auth.$context;
          await registerEmailVerificationToken(context.internalAdapter, {
            email: user.email,
            expiresInSeconds: expiresIn,
            token,
          });
        },
      },
      plugins: [oneTimeEmailVerificationToken()],
      rateLimit: { enabled: false },
    },
    { disableTestUser: true },
  );
  instanceRef.current = instance;
  const context = await instance.auth.$context;
  const updateUserByEmail = context.internalAdapter.updateUserByEmail.bind(context.internalAdapter);
  context.internalAdapter.updateUserByEmail = async (...args) => {
    if (failVerificationWrite && args[1]?.emailVerified === true) {
      failVerificationWrite = false;
      throw new Error('injected verification write failure');
    }

    return updateUserByEmail(...args);
  };
  const result = await instance.client.signUp.email({
    callbackURL: '/lobehub/onboarding',
    email: 'recovery@example.test',
    name: '验证恢复测试',
    password: 'Test-only-recovery-123!',
  });
  expect(result.error).toBeNull();
  expect(verificationToken).toBeTruthy();

  const verify = (callbackURL: string, token = verificationToken!) =>
    instance.auth.handler(
      new Request(
        `${authBaseURL}/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent(callbackURL)}`,
        { headers: { origin: authBaseURL }, method: 'GET', redirect: 'manual' },
      ),
    );

  return {
    failNextVerificationWrite: () => {
      failVerificationWrite = true;
    },
    token: verificationToken!,
    verify,
  };
};

describe('registerEmailVerificationToken', () => {
  it('keeps the previous token usable when creating its replacement fails', async () => {
    const harness = createAdapterHarness();
    await register(harness.adapter, 'previous-token');
    const previousPointer = harness.latestPointer()?.[1].value;
    harness.failNextCreate();

    await expect(register(harness.adapter, 'replacement-token')).rejects.toThrow(
      'injected create failure',
    );

    expect(harness.latestPointer()?.[1].value).toBe(previousPointer);
    expect(harness.hasUsableLatestToken()).toBe(true);
  });

  it('keeps the previous token usable when switching the latest pointer fails', async () => {
    const harness = createAdapterHarness();
    await register(harness.adapter, 'previous-token');
    const previousPointer = harness.latestPointer()?.[1].value;
    harness.failNextUpdate();

    await expect(register(harness.adapter, 'replacement-token')).rejects.toThrow(
      'injected pointer update failure',
    );

    expect(harness.latestPointer()?.[1].value).toBe(previousPointer);
    expect(harness.hasUsableLatestToken()).toBe(true);
  });

  it('makes only the replacement token current after a successful rotation', async () => {
    const harness = createAdapterHarness();
    await register(harness.adapter, 'previous-token');
    const previousPointer = harness.latestPointer()?.[1].value;

    await register(harness.adapter, 'replacement-token');

    const latestPointer = harness.latestPointer()?.[1].value;
    expect(latestPointer).not.toBe(previousPointer);
    expect(harness.hasUsableLatestToken()).toBe(true);
    expect(
      [...harness.records.keys()].some((identifier) =>
        identifier.endsWith(`:token:${previousPointer}`),
      ),
    ).toBe(false);
  });

  it('keeps one authoritative latest token across concurrent rotations', async () => {
    const harness = createAdapterHarness();
    await register(harness.adapter, 'previous-token');
    const previousPointer = harness.latestPointer()?.[1].value;

    await Promise.all([
      register(harness.adapter, 'concurrent-token-a'),
      register(harness.adapter, 'concurrent-token-b'),
    ]);

    const latestPointer = harness.latestPointer()?.[1].value;
    const currentTokenRecords = [...harness.records.keys()].filter((identifier) =>
      identifier.endsWith(`:token:${latestPointer}`),
    );
    expect(latestPointer).not.toBe(previousPointer);
    expect(currentTokenRecords).toHaveLength(1);
    expect(harness.hasUsableLatestToken()).toBe(true);
  });
});

describe('prepareEmailVerificationToken', () => {
  it('does not switch latest until commit and rolls back only the prepared token', async () => {
    const harness = createAdapterHarness();
    await register(harness.adapter, 'previous-token');
    const previousPointer = harness.latestPointer()?.[1].value;
    const prepared = await prepareEmailVerificationToken(harness.adapter, {
      email: 'traveler@example.test',
      expiresInSeconds: 3600,
      token: 'replacement-token',
    });

    expect(harness.latestPointer()?.[1].value).toBe(previousPointer);
    expect(harness.hasUsableLatestToken()).toBe(true);

    await prepared.rollback();

    expect(harness.latestPointer()?.[1].value).toBe(previousPointer);
    expect(harness.hasUsableLatestToken()).toBe(true);
    expect(harness.records.size).toBe(2);
  });

  it('switches latest and removes the previous token only after commit', async () => {
    const harness = createAdapterHarness();
    await register(harness.adapter, 'previous-token');
    const previousPointer = harness.latestPointer()?.[1].value;
    const prepared = await prepareEmailVerificationToken(harness.adapter, {
      email: 'traveler@example.test',
      expiresInSeconds: 3600,
      token: 'replacement-token',
    });

    await prepared.commit();

    expect(harness.latestPointer()?.[1].value).not.toBe(previousPointer);
    expect(harness.hasUsableLatestToken()).toBe(true);
    expect(
      [...harness.records.keys()].some((identifier) =>
        identifier.endsWith(`:token:${previousPointer}`),
      ),
    ).toBe(false);
  });

  it('does not delete a concurrent winner when its own pointer commit fails', async () => {
    const harness = createAdapterHarness();
    await register(harness.adapter, 'previous-token');
    const prepared = await prepareEmailVerificationToken(harness.adapter, {
      email: 'traveler@example.test',
      expiresInSeconds: 3600,
      token: 'replacement-token',
    });
    await register(harness.adapter, 'concurrent-winner-token');
    const concurrentPointer = harness.latestPointer()?.[1].value;

    await expect(prepared.commit()).rejects.toThrow('Verification token rotation was superseded');
    await prepared.rollback();

    expect(harness.latestPointer()?.[1].value).toBe(concurrentPointer);
    expect(harness.hasUsableLatestToken()).toBe(true);
  });
});

describe('oneTimeEmailVerificationToken recovery redirect', () => {
  it('releases a reserved token when the verified-state write fails so it can be retried', async () => {
    const harness = await createVerificationHandlerHarness();
    harness.failNextVerificationWrite();

    const failed = await harness.verify('/lobehub/onboarding');
    expect(failed.status).toBe(500);

    const retried = await harness.verify('/lobehub/onboarding');
    expect(retried.status).toBe(302);
    expect(retried.headers.get('location')).toBe('/lobehub/onboarding');
  });

  it('allows only one concurrent verification request to commit the same token', async () => {
    const harness = await createVerificationHandlerHarness();

    const responses = await Promise.all([
      harness.verify('/lobehub/onboarding'),
      harness.verify('/lobehub/onboarding'),
    ]);

    expect(responses.map((response) => response.status)).toEqual([302, 302]);
    expect(responses.map((response) => response.headers.get('location')).sort()).toEqual(
      [
        '/lobehub/onboarding',
        '/lobehub/verify-email?error=INVALID_VERIFICATION_TOKEN',
      ].sort(),
    );
  });

  it('does not mistake a caller-owned error query parameter for a failed verification', async () => {
    const harness = await createVerificationHandlerHarness();
    const callbackURL = '/lobehub/onboarding?error=caller-state';

    const verified = await harness.verify(callbackURL);
    expect(verified.status).toBe(302);
    expect(verified.headers.get('location')).toBe(callbackURL);

    const replayed = await harness.verify(callbackURL);
    expect(replayed.headers.get('location')).toBe(
      '/lobehub/verify-email?error=INVALID_VERIFICATION_TOKEN',
    );
  });

  it('redirects an invalid token only when its callback is an allowed mounted path', async () => {
    const harness = await createVerificationHandlerHarness();

    const invalid = await harness.verify('/lobehub/onboarding', `${harness.token}tampered`);

    expect(invalid.status).toBe(302);
    expect(invalid.headers.get('location')).toBe(
      '/lobehub/verify-email?error=INVALID_VERIFICATION_TOKEN',
    );
    const safeRetry = await harness.verify('/lobehub/onboarding');
    expect(safeRetry.status).toBe(302);
    expect(safeRetry.headers.get('location')).toBe('/lobehub/onboarding');
  });

  it('redirects an expired token with an allowed mounted callback to the branded recovery page', async () => {
    const harness = await createVerificationHandlerHarness(-1);

    const response = await harness.verify('/lobehub/onboarding');

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      '/lobehub/verify-email?error=INVALID_VERIFICATION_TOKEN',
    );
    expect(response.headers.has('set-cookie')).toBe(false);
  });

  it('redirects a replay with an allowed mounted callback without creating another session', async () => {
    const harness = await createVerificationHandlerHarness();
    const verified = await harness.verify('/lobehub/onboarding');
    expect(verified.status).toBe(302);
    expect(verified.headers.get('location')).toBe('/lobehub/onboarding');

    const replayed = await harness.verify('/lobehub/onboarding');

    expect(replayed.status).toBe(302);
    expect(replayed.headers.get('location')).toBe(
      '/lobehub/verify-email?error=INVALID_VERIFICATION_TOKEN',
    );
    expect(replayed.headers.has('set-cookie')).toBe(false);
  });

  it('fails closed on unsafe callbacks without consuming the valid token', async () => {
    const harness = await createVerificationHandlerHarness();
    const unsafeCallbacks = [
      'https://attacker.example.test/steal',
      String.raw`/lobehub/\attacker`,
      '/lobehub/%252e%252e/outside',
    ];

    for (const callbackURL of unsafeCallbacks) {
      const rejected = await harness.verify(callbackURL);
      expect(rejected.status).toBe(401);
      expect(rejected.headers.has('location')).toBe(false);
      expect(rejected.headers.has('set-cookie')).toBe(false);
    }

    const safeRetry = await harness.verify('/lobehub/onboarding');
    expect(safeRetry.status).toBe(302);
    expect(safeRetry.headers.get('location')).toBe('/lobehub/onboarding');
  });
});
