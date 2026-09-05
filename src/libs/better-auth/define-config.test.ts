import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const authHandler = vi.fn(async () => new Response(null));
  const internalAdapter = {
    createVerificationValue: vi.fn(),
    deleteVerificationByIdentifier: vi.fn(),
    findVerificationValue: vi.fn().mockResolvedValue(null),
    updateVerificationByIdentifier: vi.fn(),
  };

  return {
    appEnv: { APP_URL: 'https://example.com' },
    authEnv: {
      AUTH_DISABLE_EMAIL_PASSWORD: false,
      AUTH_EMAIL_VERIFICATION: true,
      AUTH_ENABLE_MAGIC_LINK: false,
      AUTH_SECRET: 'test-secret',
      AUTH_SSO_PROVIDERS: '',
    },
    authHandler,
    betterAuth: vi.fn((options) => ({
      ...options,
      $context: Promise.resolve({ internalAdapter }),
      handler: authHandler,
    })),
    clearMismatchedOIDCSession: vi.fn(),
    ensureTravelServiceReady: vi.fn(),
    emailOTP: vi.fn((options) => ({ id: 'email-otp', options })),
    EnvHttpProxyAgent: vi.fn((options) => ({ options })),
    getChangeEmailVerificationTemplate: vi.fn(() => ({ subject: 'change-email' })),
    getAuthEmailSender: vi.fn(() => '旅游群网 <mailer@example.test>'),
    getMagicLinkEmailTemplate: vi.fn(() => ({ subject: 'magic-link' })),
    getMountedAuthEmailUrl: vi.fn((url: string) => `mounted:${url}`),
    getResetPasswordEmailTemplate: vi.fn(() => ({ subject: 'reset-password' })),
    getVerificationEmailTemplate: vi.fn(() => ({ subject: 'verification' })),
    magicLink: vi.fn((options) => ({ id: 'magic-link', options })),
    passkey: vi.fn((options) => ({ id: 'passkey', options })),
    phoneNumber: vi.fn((options) => ({ id: 'phone-number', options })),
    internalAdapter,
    sendMail: vi.fn(),
    serverDB: {},
    setGlobalDispatcher: vi.fn(),
  };
});

vi.mock('@better-auth/expo', () => ({
  expo: vi.fn(() => ({ id: 'expo' })),
}));

vi.mock('@better-auth/passkey', () => ({
  passkey: mocks.passkey,
}));

vi.mock('@lobechat/database', () => ({
  createNanoId: vi.fn(() => vi.fn(() => 'generated-id')),
  idGenerator: vi.fn(() => 'generated-user-id'),
  serverDB: mocks.serverDB,
}));

vi.mock('@lobechat/database/schemas', () => ({}));

vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(),
  },
}));

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: vi.fn(() => ({ id: 'drizzle-adapter' })),
}));

vi.mock('better-auth/crypto', () => ({
  verifyPassword: vi.fn(),
}));

vi.mock('better-auth/minimal', () => ({
  betterAuth: mocks.betterAuth,
}));

vi.mock('better-auth/plugins', () => ({
  admin: vi.fn(() => ({ id: 'admin' })),
  emailOTP: mocks.emailOTP,
  genericOAuth: vi.fn(() => ({ id: 'generic-oauth' })),
  magicLink: mocks.magicLink,
  phoneNumber: mocks.phoneNumber,
}));

vi.mock('undici', () => ({
  EnvHttpProxyAgent: mocks.EnvHttpProxyAgent,
  setGlobalDispatcher: mocks.setGlobalDispatcher,
}));

vi.mock('@/envs/app', () => ({
  appEnv: mocks.appEnv,
}));

vi.mock('@/envs/auth', () => ({
  authEnv: mocks.authEnv,
}));

vi.mock('@/envs/email', () => ({
  emailEnv: { RESEND_FROM: 'LobeHub <mailer@example.test>' },
}));

vi.mock('@/libs/better-auth/email-templates', () => ({
  getChangeEmailVerificationTemplate: mocks.getChangeEmailVerificationTemplate,
  getAuthEmailSender: mocks.getAuthEmailSender,
  getMagicLinkEmailTemplate: mocks.getMagicLinkEmailTemplate,
  getMountedAuthEmailUrl: mocks.getMountedAuthEmailUrl,
  getResetPasswordEmailTemplate: mocks.getResetPasswordEmailTemplate,
  getVerificationEmailTemplate: mocks.getVerificationEmailTemplate,
  getVerificationOTPEmailTemplate: vi.fn(() => ({})),
}));

vi.mock('@/libs/better-auth/plugins/email-whitelist', () => ({
  emailWhitelist: vi.fn(() => ({ id: 'email-whitelist' })),
}));

vi.mock('@/libs/better-auth/sso', () => ({
  initBetterAuthSSOProviders: vi.fn(() => ({
    genericOAuthProviders: [],
    socialProviders: {},
  })),
}));

vi.mock('@/libs/better-auth/utils/config', () => ({
  createSecondaryStorage: vi.fn(() => ({ id: 'secondary-storage' })),
  getTrustedOrigins: vi.fn(() => ['https://example.com']),
}));

vi.mock('@/libs/better-auth/utils/server', () => ({
  parseSSOProviders: vi.fn(() => []),
}));

vi.mock('@/libs/oidc-provider/session-cleanup', () => ({
  clearMismatchedOIDCSession: mocks.clearMismatchedOIDCSession,
}));

vi.mock('@/server/services/email', () => ({
  EmailService: vi.fn(() => ({ sendMail: mocks.sendMail })),
}));

vi.mock('@/server/services/user', () => ({
  UserService: vi.fn(() => ({ ensureTravelServiceReady: mocks.ensureTravelServiceReady })),
}));

vi.mock('@/server/services/sms', () => ({
  isSmsAuthenticationEnabled: vi.fn(() => true),
  sendAuthenticationCode: vi.fn(),
  validateChinesePhoneNumber: vi.fn(() => true),
}));

const createResponseWithCookie = (cookie: string) => {
  const response = new Response(null);
  response.headers.append('set-cookie', cookie);

  return response;
};

describe('defineConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.appEnv.APP_URL = 'https://example.com';
    mocks.authEnv.AUTH_ENABLE_MAGIC_LINK = false;
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    delete process.env.HTTP_PROXY;
    delete process.env.http_proxy;
    delete process.env.HTTPS_PROXY;
    delete process.env.https_proxy;
    delete process.env.NO_PROXY;
    delete process.env.no_proxy;
  });

  it('does not require email verification again for password sign-in', async () => {
    const { defineConfig } = await import('./define-config');

    defineConfig({ plugins: [] });
    const [options] = mocks.betterAuth.mock.lastCall!;

    expect(options.emailAndPassword.requireEmailVerification).toBe(false);
  });

  it('disables client session snapshots so account revocation reaches native auth endpoints', async () => {
    const { defineConfig } = await import('./define-config');

    defineConfig({ plugins: [] });
    const [options] = mocks.betterAuth.mock.lastCall!;

    expect(options.session).toMatchObject({
      cookieCache: { enabled: false },
      storeSessionInDatabase: true,
    });
  });

  it('uses the customer-facing brand in passkey prompts', async () => {
    const { defineConfig } = await import('./define-config');

    defineConfig({ plugins: [] });

    expect(mocks.passkey).toHaveBeenCalledWith(
      expect.objectContaining({
        rpName: '旅游群网',
      }),
    );
  });

  it('registers verified phone signup against the existing phone column', async () => {
    const { defineConfig } = await import('./define-config');

    defineConfig({ plugins: [] });

    expect(mocks.phoneNumber).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedAttempts: 3,
        expiresIn: 300,
        otpLength: 6,
        requireVerification: true,
        schema: {
          user: {
            fields: {
              phoneNumber: 'phone',
            },
          },
        },
        signUpOnVerification: expect.objectContaining({
          getTempEmail: expect.any(Function),
          getTempName: expect.any(Function),
        }),
      }),
    );
  });

  it('does not log the submitted email when password reset targets an unknown account', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { defineConfig } = await import('./define-config');

    defineConfig({ plugins: [] });
    const [options] = mocks.betterAuth.mock.lastCall!;

    expect(options.logger).toBeDefined();
    options.logger.log('error', 'Reset Password: User not found', {
      email: 'private-customer@example.test',
    });

    expect(consoleError).not.toHaveBeenCalled();
  });

  it('keeps unexpected authentication errors visible to operators', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { defineConfig } = await import('./define-config');

    defineConfig({ plugins: [] });
    const [options] = mocks.betterAuth.mock.lastCall!;
    const databaseError = new Error('database unavailable');

    expect(options.logger).toBeDefined();
    options.logger.log('error', 'Session lookup failed', databaseError);

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z ERROR \[Better Auth\]: Session lookup failed$/,
      ),
      databaseError,
    );
  });

  it('redacts phone numbers from authentication logs', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { defineConfig } = await import('./define-config');

    defineConfig({ plugins: [] });
    const [options] = mocks.betterAuth.mock.lastCall!;
    options.logger.log('error', 'Credential account not found', {
      phoneNumber: '+8613812345678',
    });

    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('13812345678');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it('should revoke existing sessions after password reset by default', async () => {
    const { defineConfig } = await import('./define-config');

    defineConfig({ plugins: [] });

    expect(mocks.betterAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        emailAndPassword: expect.objectContaining({
          revokeSessionsOnPasswordReset: true,
        }),
      }),
    );
  });

  it('delegates account abuse paths to the route limiter and avoids default memory storage', async () => {
    const { defineConfig } = await import('./define-config');

    defineConfig({ plugins: [] });
    const [options] = mocks.betterAuth.mock.lastCall!;
    expect(options.rateLimit.customStorage).toEqual(
      expect.objectContaining({ get: expect.any(Function), set: expect.any(Function) }),
    );

    for (const path of [
      '/change-email',
      '/email-otp/change-email',
      '/email-otp/check-verification-otp',
      '/email-otp/request-email-change',
      '/email-otp/request-password-reset',
      '/email-otp/reset-password',
      '/email-otp/send-verification-otp',
      '/email-otp/verify-email',
      '/forget-password/email-otp',
      '/sign-up/email',
      '/sign-in/email',
      '/sign-in/email-otp',
      '/sign-in/magic-link',
      '/request-password-reset',
      '/send-verification-email',
      '/verify-email',
    ]) {
      expect(
        await options.rateLimit.customRules[path](
          new Request(`https://example.com/api/auth${path}`),
          { max: 3, window: 60 },
        ),
      ).toBe(false);
    }
  });

  it('mounts password reset and email verification links before rendering or sending', async () => {
    const { defineConfig } = await import('./define-config');
    const rawUrl = 'http://internal.example.test/api/auth/action?state=fixture';
    const qqMailbox = '123456789@qq.com';
    const verificationToken = 'verification-token-fixture';

    defineConfig({ plugins: [] });
    const [options] = mocks.betterAuth.mock.lastCall!;
    await options.emailAndPassword.sendResetPassword({
      url: rawUrl,
      user: { email: qqMailbox },
    });
    await options.emailVerification.sendVerificationEmail(
      { token: verificationToken, url: rawUrl, user: { email: qqMailbox, name: '旅行顾问' } },
      new Request('https://example.com/api/auth/send-verification-email'),
    );
    // Better Auth uses the same verified template boundary when the customer requests a resend.
    await options.emailVerification.sendVerificationEmail(
      { token: verificationToken, url: rawUrl, user: { email: qqMailbox, name: '旅行顾问' } },
      new Request('https://example.com/api/auth/send-verification-email'),
    );
    await options.emailVerification.sendVerificationEmail(
      { token: verificationToken, url: rawUrl, user: { email: qqMailbox, name: '旅行顾问' } },
      new Request('https://example.com/api/auth/change-email'),
    );

    expect(mocks.getMountedAuthEmailUrl).toHaveBeenCalledTimes(4);
    expect(mocks.getMountedAuthEmailUrl).toHaveBeenCalledWith(rawUrl, mocks.appEnv.APP_URL);
    expect(mocks.getResetPasswordEmailTemplate).toHaveBeenCalledWith({
      url: `mounted:${rawUrl}`,
    });
    expect(mocks.getVerificationEmailTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ url: `mounted:${rawUrl}` }),
    );
    expect(mocks.getChangeEmailVerificationTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ url: `mounted:${rawUrl}` }),
    );
    expect(mocks.sendMail).toHaveBeenCalledTimes(4);
    expect(mocks.sendMail.mock.calls.map(([payload]) => payload.to)).toEqual([
      qqMailbox,
      qqMailbox,
      qqMailbox,
      qqMailbox,
    ]);
    expect(mocks.getAuthEmailSender).toHaveBeenCalledWith('LobeHub <mailer@example.test>');
    for (const [payload] of mocks.sendMail.mock.calls) {
      expect(payload.from).toBe('旅游群网 <mailer@example.test>');
    }
  });

  it('keeps the previous verification token active when email delivery fails', async () => {
    mocks.internalAdapter.findVerificationValue.mockResolvedValueOnce({
      expiresAt: new Date(Date.now() + 60_000),
      value: 'previous-token-fingerprint',
    });
    mocks.sendMail.mockRejectedValueOnce(new Error('injected delivery failure'));
    const { defineConfig } = await import('./define-config');

    defineConfig({ plugins: [] });
    const [options] = mocks.betterAuth.mock.lastCall!;
    await expect(
      options.emailVerification.sendVerificationEmail(
        {
          token: 'replacement-token-fixture',
          url: 'https://example.com/api/auth/verify-email?token=fixture',
          user: { email: 'traveler@example.test', name: '旅行顾问' },
        },
        new Request('https://example.com/api/auth/send-verification-email'),
      ),
    ).rejects.toThrow('injected delivery failure');

    const preparedTokenIdentifier =
      mocks.internalAdapter.createVerificationValue.mock.calls[0][0].identifier;
    expect(mocks.internalAdapter.updateVerificationByIdentifier).not.toHaveBeenCalled();
    expect(mocks.internalAdapter.deleteVerificationByIdentifier).toHaveBeenCalledTimes(1);
    expect(mocks.internalAdapter.deleteVerificationByIdentifier).toHaveBeenCalledWith(
      preparedTokenIdentifier,
    );
  });

  it('mounts magic-link URLs before rendering or sending', async () => {
    mocks.authEnv.AUTH_ENABLE_MAGIC_LINK = true;
    const { defineConfig } = await import('./define-config');
    const rawUrl = 'http://internal.example.test/api/auth/magic-link/verify?state=fixture';

    defineConfig({ plugins: [] });
    const [options] = mocks.betterAuth.mock.lastCall!;
    const magicLinkPlugin = options.plugins.find(
      (plugin: { id: string }) => plugin.id === 'magic-link',
    );
    await magicLinkPlugin.options.sendMagicLink({
      email: '123456789@qq.com',
      url: rawUrl,
    });

    expect(mocks.getMountedAuthEmailUrl).toHaveBeenCalledWith(rawUrl, mocks.appEnv.APP_URL);
    expect(mocks.getMagicLinkEmailTemplate).toHaveBeenCalledWith({
      expiresInSeconds: expect.any(Number),
      url: `mounted:${rawUrl}`,
    });
    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '旅游群网 <mailer@example.test>',
        subject: 'magic-link',
        to: '123456789@qq.com',
      }),
    );
  });

  it('silently skips verification OTP mail for an already verified account', async () => {
    const { defineConfig } = await import('./define-config');
    const findUserByEmail = vi.fn().mockResolvedValue({ user: { emailVerified: true } });

    defineConfig({ plugins: [] });
    const otpOptions = mocks.emailOTP.mock.lastCall![0];
    await otpOptions.sendVerificationOTP(
      { email: 'verified-fixture', otp: 'otp-fixture', type: 'email-verification' },
      { context: { internalAdapter: { findUserByEmail } } },
    );

    expect(findUserByEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it('keeps normal QQ mailbox OTP delivery available for an unverified account', async () => {
    const { defineConfig } = await import('./define-config');
    const findUserByEmail = vi.fn().mockResolvedValue({ user: { emailVerified: false } });

    defineConfig({ plugins: [] });
    const otpOptions = mocks.emailOTP.mock.lastCall![0];
    await otpOptions.sendVerificationOTP(
      { email: 'qq-fixture@qq.com', otp: 'otp-fixture', type: 'email-verification' },
      { context: { internalAdapter: { findUserByEmail } } },
    );

    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
  });

  it('stores verification OTPs as hashes and keeps link verification as the default', async () => {
    const { defineConfig } = await import('./define-config');

    defineConfig({ plugins: [] });

    expect(mocks.emailOTP.mock.lastCall![0]).toEqual(
      expect.objectContaining({
        overrideDefaultEmailVerification: false,
        sendVerificationOnSignUp: false,
        storeOTP: 'hashed',
      }),
    );
  });

  it('does not accept a server-only mode switch that would desynchronize the link-first UI', async () => {
    const { defineConfig } = await import('./define-config');
    const optionsWithUnsupportedMode = { emailVerificationMode: 'otp', plugins: [] };

    defineConfig(optionsWithUnsupportedMode);

    expect(mocks.emailOTP.mock.lastCall![0]).toEqual(
      expect.objectContaining({
        overrideDefaultEmailVerification: false,
        sendVerificationOnSignUp: false,
      }),
    );
  });

  it('installs account input hardening for every Better Auth user write', async () => {
    const { defineConfig } = await import('./define-config');

    defineConfig({ plugins: [] });
    const [options] = mocks.betterAuth.mock.lastCall!;

    expect(options.plugins).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'account-input-hardening' })]),
    );
  });

  it('should clear a mismatched OIDC session before creating a Better Auth session', async () => {
    const { defineConfig } = await import('./define-config');
    const context = { getCookie: vi.fn(), setCookie: vi.fn() };

    defineConfig({ plugins: [] });
    const [options] = mocks.betterAuth.mock.lastCall!;
    await options.databaseHooks.session.create.before({ userId: 'user-b' }, context);

    expect(mocks.clearMismatchedOIDCSession).toHaveBeenCalledWith(
      mocks.serverDB,
      'user-b',
      context,
    );
    expect(mocks.ensureTravelServiceReady).toHaveBeenCalledWith('user-b');
  });

  it('should continue creating the Better Auth session when OIDC cleanup fails', async () => {
    const cleanupError = new Error('OIDC database unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.clearMismatchedOIDCSession.mockRejectedValueOnce(cleanupError);
    const { defineConfig } = await import('./define-config');

    defineConfig({ plugins: [] });
    const [options] = mocks.betterAuth.mock.lastCall!;

    await expect(
      options.databaseHooks.session.create.before({ userId: 'user-b' }, null),
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      '[Better Auth] Failed to clear a stale OIDC session:',
      cleanupError,
    );
    expect(mocks.ensureTravelServiceReady).toHaveBeenCalledWith('user-b');
  });

  it('keeps session creation available when travel service repair fails', async () => {
    const repairError = new Error('temporary bootstrap failure');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.ensureTravelServiceReady.mockRejectedValueOnce(repairError);
    const { defineConfig } = await import('./define-config');

    defineConfig({ plugins: [] });
    const [options] = mocks.betterAuth.mock.lastCall!;

    await expect(
      options.databaseHooks.session.create.before({ userId: 'user-b' }, null),
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      '[Better Auth] Failed to repair travel service bootstrap:',
      repairError,
    );
  });

  it('should respect NO_PROXY when configuring the development proxy dispatcher', async () => {
    process.env = {
      ...process.env,
      HTTP_PROXY: 'http://127.0.0.1:7890',
      HTTPS_PROXY: 'http://127.0.0.1:7890',
      NODE_ENV: 'development',
      NO_PROXY: 'example.com,localhost',
    };

    await import('./define-config');

    expect(mocks.EnvHttpProxyAgent).toHaveBeenCalledWith({
      httpProxy: 'http://127.0.0.1:7890',
      httpsProxy: 'http://127.0.0.1:7890',
      noProxy: 'example.com,localhost,127.0.0.1,[::1]',
    });
    expect(mocks.setGlobalDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          noProxy: 'example.com,localhost,127.0.0.1,[::1]',
        }),
      }),
    );
  });

  it('should preserve NO_PROXY wildcard semantics', async () => {
    const { mergeLocalNoProxy } = await import('./define-config');

    expect(mergeLocalNoProxy('*')).toBe('*');
  });

  it('should keep auth cookies host-only when no cookie domain is given', async () => {
    const { defineConfig } = await import('./define-config');

    defineConfig({ plugins: [] });
    const [options] = mocks.betterAuth.mock.lastCall!;

    expect(options.advanced.crossSubDomainCookies).toBeUndefined();
  });

  it('should namespace every Better Auth cookie with the configured prefix', async () => {
    const { defineConfig } = await import('./define-config');

    defineConfig({ cookiePrefix: 'example-app', plugins: [] });
    const [options] = mocks.betterAuth.mock.lastCall!;

    expect(options.advanced.cookiePrefix).toBe('example-app');
  });

  it.each([['https://app.example.com'], ['https://example.com']])(
    'should share auth cookies across subdomains when APP_URL %s is under the cookie domain',
    async (appUrl) => {
      mocks.appEnv.APP_URL = appUrl;
      const { defineConfig } = await import('./define-config');

      defineConfig({ cookieDomain: '.example.com', plugins: [] });
      const [options] = mocks.betterAuth.mock.lastCall!;

      expect(options.advanced.crossSubDomainCookies).toEqual({
        domain: '.example.com',
        enabled: true,
      });
    },
  );

  it.each([['https://preview-branch.vercel.app'], ['http://localhost:3010']])(
    'should ignore a cookie domain that APP_URL %s does not belong to',
    async (appUrl) => {
      mocks.appEnv.APP_URL = appUrl;
      const { defineConfig } = await import('./define-config');

      defineConfig({ cookieDomain: '.example.com', plugins: [] });
      const [options] = mocks.betterAuth.mock.lastCall!;

      expect(options.advanced.crossSubDomainCookies).toBeUndefined();
    },
  );

  it('should expire the legacy host-only twin of every domain-scoped cookie', async () => {
    mocks.appEnv.APP_URL = 'https://app.example.com';
    mocks.authHandler.mockResolvedValueOnce(
      createResponseWithCookie(
        '__Secure-better-auth.session_token=token; Path=/; Domain=.example.com; HttpOnly; Secure; SameSite=Lax',
      ),
    );
    const { defineConfig } = await import('./define-config');

    const auth = defineConfig({ cookieDomain: '.example.com', plugins: [] });
    const response = await auth.handler(
      new Request('https://app.example.com/api/auth/get-session'),
    );

    expect(response.headers.getSetCookie()).toEqual([
      '__Secure-better-auth.session_token=token; Path=/; Domain=.example.com; HttpOnly; Secure; SameSite=Lax',
      '__Secure-better-auth.session_token=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax; HttpOnly; Secure',
    ]);
  });

  it('should leave cookies alone when no cookie domain is configured', async () => {
    mocks.authHandler.mockResolvedValueOnce(
      createResponseWithCookie('__Secure-better-auth.session_token=token; Path=/; Secure'),
    );
    const { defineConfig } = await import('./define-config');

    const auth = defineConfig({ plugins: [] });
    const response = await auth.handler(
      new Request('https://app.example.com/api/auth/get-session'),
    );

    expect(response.headers.getSetCookie()).toEqual([
      '__Secure-better-auth.session_token=token; Path=/; Secure',
    ]);
  });
});
