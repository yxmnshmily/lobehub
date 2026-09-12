import { createHash, randomInt } from 'node:crypto';

import { expo } from '@better-auth/expo';
import { passkey } from '@better-auth/passkey';
import { BRANDING_NAME } from '@lobechat/business-const';
import { createNanoId, idGenerator, serverDB } from '@lobechat/database';
import * as schema from '@lobechat/database/schemas';
import bcrypt from 'bcryptjs';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { verifyPassword as defaultVerifyPassword } from 'better-auth/crypto';
import { type BetterAuthOptions } from 'better-auth/minimal';
import { betterAuth } from 'better-auth/minimal';
import { admin, emailOTP, genericOAuth, magicLink, phoneNumber } from 'better-auth/plugins';
import { type BetterAuthPlugin } from 'better-auth/types';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import { emailEnv } from '@/envs/email';
import { createBetterAuthRateLimitStorage } from '@/libs/better-auth/auth-abuse-control';
import {
  getAuthEmailSender,
  getChangeEmailVerificationTemplate,
  getMagicLinkEmailTemplate,
  getMountedAuthEmailUrl,
  getResetPasswordEmailTemplate,
  getVerificationEmailTemplate,
  getVerificationOTPEmailTemplate,
} from '@/libs/better-auth/email-templates';
import {
  oneTimeEmailVerificationToken,
  prepareEmailVerificationToken,
} from '@/libs/better-auth/email-verification-token';
import { accountInputHardening } from '@/libs/better-auth/plugins/account-input-hardening';
import { emailWhitelist } from '@/libs/better-auth/plugins/email-whitelist';
import { initBetterAuthSSOProviders } from '@/libs/better-auth/sso';
import { createSecondaryStorage, getTrustedOrigins } from '@/libs/better-auth/utils/config';
import { expireLegacyHostOnlyCookies } from '@/libs/better-auth/utils/host-only-cookies';
import { parseSSOProviders } from '@/libs/better-auth/utils/server';
import { clearMismatchedOIDCSession } from '@/libs/oidc-provider/session-cleanup';
import { EmailService } from '@/server/services/email';
import {
  isSmsAuthenticationEnabled,
  sendAuthenticationCode,
  validateChinesePhoneNumber,
} from '@/server/services/sms';
import { UserService } from '@/server/services/user';

const LOCAL_NO_PROXY_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const UNKNOWN_PASSWORD_RESET_LOG = 'Reset Password: User not found';
const phoneAccountAlias = (phone: string) =>
  createHash('sha256').update(phone).digest('hex').slice(0, 24);

const redactAuthLogArgument = (value: unknown): unknown => {
  if (!value || typeof value !== 'object' || value instanceof Error) return value;
  if (Array.isArray(value)) return value.map(redactAuthLogArgument);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      /phone|otp|code/i.test(key) ? '[REDACTED]' : redactAuthLogArgument(entry),
    ]),
  );
};

const authLogger = {
  log(level, message, ...args) {
    // Better Auth already returns the same neutral 200 response for unknown accounts.
    // Treat this expected branch as a no-op so the submitted address is not retained in logs.
    if (level === 'error' && message === UNKNOWN_PASSWORD_RESET_LOG) return;

    const formattedMessage = `${new Date().toISOString()} ${level.toUpperCase()} [Better Auth]: ${message}`;
    const safeArgs = args.map(redactAuthLogArgument);
    if (level === 'error') return console.error(formattedMessage, ...safeArgs);
    if (level === 'warn') return console.warn(formattedMessage, ...safeArgs);
    console.info(formattedMessage, ...safeArgs);
  },
} satisfies NonNullable<BetterAuthOptions['logger']>;

export const mergeLocalNoProxy = (noProxy?: string): string => {
  const entries = new Set(
    (noProxy || '')
      .split(/[,\s]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

  if (entries.has('*')) return '*';

  for (const host of LOCAL_NO_PROXY_HOSTS) {
    entries.add(host);
  }

  return [...entries].join(',');
};

// Configure HTTP proxy for OAuth provider requests in development (e.g., Google token exchange).
// Node.js native fetch doesn't respect system proxy settings. Keep localhost direct so Next can
// fetch local Vite templates such as /index.auth.html without depending on the system proxy.
// Ref: https://github.com/better-auth/better-auth/issues/7396
if (process.env.NODE_ENV === 'development') {
  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy || httpProxy;

  if (httpProxy || httpsProxy) {
    const proxyAgent = new EnvHttpProxyAgent({
      ...(httpProxy && { httpProxy }),
      ...(httpsProxy && { httpsProxy }),
      noProxy: mergeLocalNoProxy(process.env.NO_PROXY || process.env.no_proxy),
    });
    setGlobalDispatcher(proxyAgent);
  }
}

// Email verification link expiration time (in seconds)
// Default is 1 hour (3600 seconds) as per Better Auth documentation
const VERIFICATION_LINK_EXPIRES_IN = 3600;

/**
 * Safely extract hostname from APP_URL for passkey rpID.
 * Returns undefined if APP_URL is not set (e.g., in e2e tests).
 */
const getPasskeyRpID = (): string | undefined => {
  if (!appEnv.APP_URL) return undefined;
  try {
    return new URL(appEnv.APP_URL).hostname;
  } catch {
    return undefined;
  }
};

/**
 * Get passkey origins array.
 * Returns undefined if APP_URL is not set (e.g., in e2e tests).
 */
const getPasskeyOrigins = (): string[] | undefined => {
  if (!appEnv.APP_URL) return undefined;
  try {
    return [new URL(appEnv.APP_URL).origin];
  } catch {
    return undefined;
  }
};
/**
 * Browsers silently drop a cookie whose `Domain` the current host is not a member of.
 * Applying a production domain on a preview deployment (`*.vercel.app`) or localhost would
 * therefore erase every auth cookie instead of widening it, so fall back to host-only there.
 */
const resolveCookieDomain = (cookieDomain?: string): string | undefined => {
  if (!cookieDomain) return undefined;

  const base = cookieDomain.replace(/^\./, '');
  try {
    const { hostname } = new URL(appEnv.APP_URL);
    if (hostname !== base && !hostname.endsWith(`.${base}`)) return undefined;
  } catch {
    return undefined;
  }

  return cookieDomain;
};

const MAGIC_LINK_EXPIRES_IN = 900;
// OTP expiration time (in seconds) - 5 minutes for mobile OTP verification
const OTP_EXPIRES_IN = 300;
const enableMagicLink = authEnv.AUTH_ENABLE_MAGIC_LINK;
const enabledSSOProviders = parseSSOProviders(authEnv.AUTH_SSO_PROVIDERS);

const { socialProviders, genericOAuthProviders } = initBetterAuthSSOProviders();

interface CustomBetterAuthOptions {
  /**
   * Share auth cookies across every subdomain of this domain (e.g. `.example.com`).
   * Omit to keep cookies host-only.
   */
  cookieDomain?: string;
  /** Namespace every Better Auth cookie so colocated deployments cannot overwrite each other. */
  cookiePrefix?: string;
  plugins: BetterAuthPlugin[];
}

export function defineConfig(customOptions: CustomBetterAuthOptions) {
  const cookieDomain = resolveCookieDomain(customOptions.cookieDomain);
  const authEmailSender = getAuthEmailSender(
    emailEnv.RESEND_FROM || emailEnv.SMTP_FROM || emailEnv.SMTP_USER,
  );
  const instanceRef: {
    current?: {
      $context: Promise<{ internalAdapter: Parameters<typeof prepareEmailVerificationToken>[0] }>;
    };
  } = {};
  const prepareVerificationToken = async (email: string, token: string) => {
    if (!instanceRef.current) throw new Error('Better Auth is not initialized');
    const context = await instanceRef.current.$context;
    return prepareEmailVerificationToken(context.internalAdapter, {
      email,
      expiresInSeconds: VERIFICATION_LINK_EXPIRES_IN,
      token,
    });
  };

  const options = {
    account: {
      accountLinking: {
        allowDifferentEmails: true,
        enabled: true,
        trustedProviders: enabledSSOProviders,
      },
    },

    basePath: '/api/auth',
    baseURL: new URL(appEnv.APP_URL).origin,
    secret: authEnv.AUTH_SECRET,
    trustedOrigins: getTrustedOrigins(enabledSSOProviders),
    logger: authLogger,

    emailAndPassword: {
      autoSignIn: true,
      disableSignUp: authEnv.AUTH_DISABLE_EMAIL_PASSWORD,
      enabled: !authEnv.AUTH_DISABLE_EMAIL_PASSWORD,
      maxPasswordLength: 64,
      minPasswordLength: 8,
      // Email ownership is verified once at registration when enabled. Better
      // Auth then accepts the password for later sign-ins without re-sending a
      // verification email.
      requireEmailVerification: authEnv.AUTH_EMAIL_VERIFICATION,
      revokeSessionsOnPasswordReset: true,

      // Compatible with bcrypt password hashes migrated from Clerk; after login, you can re-hash in the backend using BetterAuth's default scrypt.
      password: {
        // New passwords continue to use BetterAuth's default hash to stay consistent with the official configuration.
        async verify({ hash, password }: { hash: string; password: string }): Promise<boolean> {
          if (!hash) return false;

          // Compatible with bcrypt hashes exported from Clerk (starting with $2a$ or $2b$)
          if (hash.startsWith('$2a$') || hash.startsWith('$2b$')) {
            return bcrypt.compare(password, hash);
          }

          // For all other cases, use BetterAuth's default verification
          return defaultVerifyPassword({ hash, password });
        },
      },

      sendResetPassword: async ({ user, url }) => {
        const template = getResetPasswordEmailTemplate({
          url: getMountedAuthEmailUrl(url, appEnv.APP_URL),
        });

        const emailService = new EmailService();
        await emailService.sendMail({
          ...(authEmailSender && { from: authEmailSender }),
          to: user.email,
          ...template,
        });
      },
    },
    emailVerification: {
      autoSignInAfterVerification: true,
      expiresIn: VERIFICATION_LINK_EXPIRES_IN,
      sendVerificationEmail: async ({ token, user, url }, request) => {
        // Skip sending verification link email for mobile clients (Expo/React Native)
        // Mobile clients use OTP verification instead, triggered manually via emailOTP plugin
        if (request?.headers?.get?.('x-client-type') === 'mobile') {
          return;
        }

        // Use different template for change-email vs signup verification
        const isChangeEmail = request?.url?.includes('/change-email');
        const mountedUrl = getMountedAuthEmailUrl(url, appEnv.APP_URL);
        const preparedToken = await prepareVerificationToken(user.email, token);
        const template = isChangeEmail
          ? getChangeEmailVerificationTemplate({
              expiresInSeconds: VERIFICATION_LINK_EXPIRES_IN,
              url: mountedUrl,
              userName: user.name,
            })
          : getVerificationEmailTemplate({
              expiresInSeconds: VERIFICATION_LINK_EXPIRES_IN,
              url: mountedUrl,
              userName: user.name,
            });

        const emailService = new EmailService();
        try {
          await emailService.sendMail({
            ...(authEmailSender && { from: authEmailSender }),
            to: user.email,
            ...template,
          });
          await preparedToken.commit();
        } catch (error) {
          try {
            await preparedToken.rollback();
          } catch {
            // Preserve the delivery/commit error; unreferenced rows expire naturally.
          }
          throw error;
        }
      },
    },
    onAPIError: {
      errorURL: '/auth-error',
    },
    session: {
      // Account bans and canonical session revocation must take effect on the
      // next request. A signed session_data snapshot can otherwise bypass the
      // current database state for its cache lifetime.
      cookieCache: {
        enabled: false,
      },
      // Keep a DB-backed fallback when Redis secondary storage entries are unexpectedly missing.
      storeSessionInDatabase: true,
    },
    database: drizzleAdapter(serverDB, {
      provider: 'pg',
      // experimental joins feature needs schema to pass full relation
      schema,
    }),
    secondaryStorage: createSecondaryStorage(),
    /**
     * Database joins is useful when Better-Auth needs to fetch related data from multiple tables in a single query.
     * Endpoints like /get-session, /get-full-organization and many others benefit greatly from this feature,
     * seeing upwards of 2x to 3x performance improvements depending on database latency.
     * Ref: https://www.better-auth.com/docs/adapters/drizzle#joins-experimental
     */
    experimental: { joins: true },
    /**
     * Run user bootstrap for every newly created account (email, magic link, OAuth/social, etc.).
     * Using Better Auth database hooks ensures we catch social flows that bypass /sign-up/* routes.
     * Ref: https://www.better-auth.com/docs/reference/options#databasehooks
     */
    databaseHooks: {
      session: {
        create: {
          before: async (session, context) => {
            try {
              await clearMismatchedOIDCSession(serverDB, session.userId, context);
            } catch (error) {
              /**
               * OIDC cleanup is a provider-specific recovery guard. Its failure must not prevent
               * Better Auth from creating the primary application session.
               */
              console.error('[Better Auth] Failed to clear a stale OIDC session:', error);
            }
            try {
              await new UserService(serverDB).ensureTravelServiceReady(session.userId);
            } catch (error) {
              // Session creation is also the retry boundary for accounts whose initial
              // registration bootstrap was interrupted. Keep login available so a later
              // session can retry the same idempotent repair.
              console.error('[Better Auth] Failed to repair travel service bootstrap:', error);
            }
          },
        },
      },
      user: {
        create: {
          before: async (user) => ({
            data: {
              ...user,
              // Persist once on creation; never replace an OAuth or uploaded avatar.
              image: user.image?.trim()
                ? user.image
                : new URL(
                    `avatars/landscape-${randomInt(1, 31)}.svg`,
                    `${appEnv.APP_URL.replace(/\/$/, '')}/`,
                  ).href,
            },
          }),
          after: async (user) => {
            const userService = new UserService(serverDB);
            await userService.initUser({
              email: user.email,
              id: user.id,
              phone: (user.phoneNumber as string | null | undefined) ?? null,
              username: user.username as string | null,
              createdAt: user.createdAt,
            });
          },
        },
      },
    },
    user: {
      changeEmail: {
        enabled: true,
      },
      additionalFields: {
        username: {
          required: false,
          type: 'string',
        },
      },
      fields: {
        image: 'avatar',
        // NOTE: use drizzle filed instead of db field, so use fullName instead of full_name
        name: 'fullName',
      },
      modelName: 'users',
    },

    socialProviders,
    advanced: {
      ...(cookieDomain && {
        crossSubDomainCookies: { domain: cookieDomain, enabled: true },
      }),
      ...(customOptions.cookiePrefix && { cookiePrefix: customOptions.cookiePrefix }),
      database: {
        /**
         * Align Better Auth user IDs with our shared idGenerator for consistency.
         * Other models use the shared nanoid generator (12 chars) to keep IDs consistent project-wide.
         */
        generateId: ({ model }) => {
          // Better Auth passes the model name; handle both singular and plural for safety.
          if (model === 'user' || model === 'users') {
            // clerk id length is 32
            return idGenerator('user', 32 - 'user_'.length);
          }

          // Other models: use shared nanoid generator (12 chars) to keep consistency.
          return createNanoId(12)();
        },
      },
    },
    rateLimit: {
      customStorage: createBetterAuthRateLimitStorage(),
      customRules: {
        // The auth route applies an atomic IP + normalized-email limiter for these paths.
        '/change-email': () => false,
        '/email-otp/change-email': () => false,
        '/email-otp/check-verification-otp': () => false,
        '/email-otp/request-email-change': () => false,
        '/email-otp/request-password-reset': () => false,
        '/email-otp/reset-password': () => false,
        '/email-otp/send-verification-otp': () => false,
        '/email-otp/verify-email': () => false,
        '/forget-password/email-otp': () => false,
        '/phone-number/request-password-reset': () => false,
        '/phone-number/reset-password': () => false,
        '/phone-number/send-otp': () => false,
        '/phone-number/verify': () => false,
        '/request-password-reset': () => false,
        '/send-verification-email': () => false,
        '/sign-in/email': () => false,
        '/sign-in/email-otp': () => false,
        '/sign-in/magic-link': () => false,
        '/sign-in/phone-number': () => false,
        '/sign-up/email': () => false,
        '/verify-email': () => false,
      },
    },
    plugins: [
      ...customOptions.plugins,
      oneTimeEmailVerificationToken(),
      accountInputHardening(),
      emailWhitelist(),
      expo(),
      admin(),
      // Email OTP plugin for mobile verification
      emailOTP({
        expiresIn: OTP_EXPIRES_IN,
        otpLength: 6,
        allowedAttempts: 3,
        // Keep signup link-first until the selected mode is also available to the Web UI.
        overrideDefaultEmailVerification: false,
        // The verification page requests OTP explicitly when the user switches modes.
        sendVerificationOnSignUp: false,
        storeOTP: 'hashed',
        async sendVerificationOTP({ email, otp, type }, context) {
          if (type === 'email-verification') {
            if (!context) throw new Error('Email verification context is unavailable');
            const user = await context.context.internalAdapter.findUserByEmail(email);
            if (user?.user.emailVerified) return;
          }

          const emailService = new EmailService();

          // For all OTP types, use the same template
          // userName is optional and will be null since we don't have user context here
          const template = getVerificationOTPEmailTemplate({
            expiresInSeconds: OTP_EXPIRES_IN,
            otp,
            userName: null,
          });

          await emailService.sendMail({
            ...(authEmailSender && { from: authEmailSender }),
            to: email,
            ...template,
          });
        },
      }),
      ...(isSmsAuthenticationEnabled()
        ? [
            phoneNumber({
              allowedAttempts: 3,
              expiresIn: 300,
              otpLength: 6,
              phoneNumberValidator: validateChinesePhoneNumber,
              requireVerification: true,
              schema: {
                user: {
                  fields: {
                    phoneNumber: 'phone',
                  },
                },
              },
              sendOTP: ({ code, phoneNumber: targetPhone }) =>
                sendAuthenticationCode(targetPhone, code),
              signUpOnVerification: {
                getTempEmail: (targetPhone) => `${phoneAccountAlias(targetPhone)}@phone.invalid`,
                getTempName: (targetPhone) => targetPhone.replace(/^\+86/, ''),
              },
            }),
          ]
        : []),
      passkey({
        rpName: BRANDING_NAME,
        // Extract rpID from auth URL (e.g., 'lobehub.com' from 'https://lobehub.com')
        // Returns undefined if AUTH_URL is not set (e.g., in e2e tests)
        rpID: getPasskeyRpID(),
        // Support multiple origins: web + Android APK key hashes
        // Android origin format: android:apk-key-hash:<base64url-sha256-fingerprint>
        // Returns undefined if AUTH_URL is not set (e.g., in e2e tests)
        origin: getPasskeyOrigins(),
      }),
      ...(genericOAuthProviders.length > 0
        ? [
            genericOAuth({
              config: genericOAuthProviders,
            }),
          ]
        : []),
      ...(enableMagicLink
        ? [
            magicLink({
              expiresIn: MAGIC_LINK_EXPIRES_IN,
              sendMagicLink: async ({ email, url }) => {
                const template = getMagicLinkEmailTemplate({
                  expiresInSeconds: MAGIC_LINK_EXPIRES_IN,
                  url: getMountedAuthEmailUrl(url, appEnv.APP_URL),
                });

                const emailService = new EmailService();
                await emailService.sendMail({
                  ...(authEmailSender && { from: authEmailSender }),
                  to: email,
                  ...template,
                });
              },
            }),
          ]
        : []),
    ],
  } satisfies BetterAuthOptions;

  const instance = betterAuth(options);
  instanceRef.current = instance;
  if (!cookieDomain) return instance;

  const handleRequest = instance.handler;
  instance.handler = async (request) =>
    expireLegacyHostOnlyCookies(request, await handleRequest(request), cookieDomain);

  return instance;
}
