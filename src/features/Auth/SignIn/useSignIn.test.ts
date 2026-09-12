import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSignIn } from './useSignIn';

const mockNavigate = vi.hoisted(() => vi.fn());
const mockSearchParamsGet = vi.hoisted(() => vi.fn().mockReturnValue(null));
const mockMessageError = vi.hoisted(() => vi.fn());
const mockMessageSuccess = vi.hoisted(() => vi.fn());
const mockSignInSocial = vi.hoisted(() => vi.fn());
const mockSignInOauth2 = vi.hoisted(() => vi.fn());
const mockSignInEmail = vi.hoisted(() => vi.fn());
const mockSignInMagicLink = vi.hoisted(() => vi.fn());
const mockRequestPasswordReset = vi.hoisted(() => vi.fn());
const mockBusinessSignin = vi.hoisted(() => ({
  getAdditionalData: vi.fn(async () => ({})),
  preSocialSigninCheck: vi.fn(async () => true),
  ssoProviders: [] as string[],
}));
const mockLocalStorage = vi.hoisted(() => {
  const store = new Map<string, string>();

  return {
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    removeItem: (key: string) => store.delete(key),
    setItem: (key: string, value: string) => store.set(key, value),
  };
});

vi.mock('react-router', () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [{ get: mockSearchParamsGet }],
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { error: mockMessageError, success: mockMessageSuccess },
}));

vi.mock('@/libs/better-auth/auth-client', () => ({
  requestPasswordReset: mockRequestPasswordReset,
  signIn: {
    email: mockSignInEmail,
    magicLink: mockSignInMagicLink,
    oauth2: mockSignInOauth2,
    social: mockSignInSocial,
  },
}));

vi.mock('@/libs/better-auth/utils/client', () => ({
  isBuiltinProvider: (p: string) => ['google', 'github', 'apple'].includes(p),
  normalizeProviderId: (p: string) => p,
}));

vi.mock('@lobechat/business-const', () => ({
  BRANDING_NAME: 'LobeHub',
  ORG_NAME: 'LobeHub',
}));

vi.mock('@/business/client/hooks/useBusinessSignin', () => ({
  useBusinessSignin: () => ({
    getAdditionalData: mockBusinessSignin.getAdditionalData,
    preSocialSigninCheck: mockBusinessSignin.preSocialSigninCheck,
    ssoProviders: mockBusinessSignin.ssoProviders,
  }),
}));

let mockEnableBusinessFeatures = false;
let mockEnableMagicLink = false;
vi.mock('@/features/AuthShell/AuthServerConfigProvider', () => ({
  useAuthServerConfigStore: (selector: (s: any) => any) =>
    selector({
      serverConfig: {
        disableEmailPassword: false,
        enableBusinessFeatures: mockEnableBusinessFeatures,
        enableMagicLink: mockEnableMagicLink,
        oAuthSSOProviders: ['google', 'github'],
      },
      serverConfigInit: true,
    }),
}));

const mockSetFieldValue = vi.fn();
const mockGetFieldValue = vi.fn();
const mockValidateFields = vi.fn();
const mockSetFields = vi.fn();
const mockResetFields = vi.fn();
const mockSubmit = vi.fn();
vi.mock('antd', async () => {
  const actual: any = await vi.importActual('antd');
  return {
    ...actual,
    Form: {
      ...actual.Form,
      useForm: () => [
        {
          getFieldValue: mockGetFieldValue,
          resetFields: mockResetFields,
          setFields: mockSetFields,
          setFieldValue: mockSetFieldValue,
          submit: mockSubmit,
          validateFields: mockValidateFields,
        },
      ],
    },
  };
});

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);
vi.stubGlobal('localStorage', mockLocalStorage);

const originalLocation = window.location;

describe('useSignIn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.clear();
    mockSearchParamsGet.mockReturnValue(null);
    mockEnableBusinessFeatures = false;
    mockEnableMagicLink = false;
    mockBusinessSignin.ssoProviders = [];
    mockBusinessSignin.getAdditionalData.mockResolvedValue({});
    mockBusinessSignin.preSocialSigninCheck.mockResolvedValue(true);
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        href: '',
        origin: originalLocation.origin,
        pathname: '/lobehub/signin',
      },
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should return initial values', () => {
      const { result } = renderHook(() => useSignIn());

      expect(result.current.step).toBe('email');
      expect(result.current.authMode).toBe('phone');
      expect(result.current.email).toBe('');
      expect(result.current.loading).toBe(false);
      expect(result.current.socialLoading).toBeNull();
      expect(result.current.isSocialOnly).toBe(false);
      expect(result.current.disableEmailPassword).toBe(false);
    });
  });

  describe('handleCheckUser', () => {
    it('should give unknown and existing emails the same password step', async () => {
      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'new@example.com' });
      });

      expect(result.current.step).toBe('password');
      expect(result.current.authMode).toBe('email');
      expect(result.current.email).toBe('new@example.com');
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('should go to the same password step without probing account state', async () => {
      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'user@example.com' });
      });

      expect(result.current.step).toBe('password');
      expect(result.current.email).toBe('user@example.com');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should defer username resolution until password submission', async () => {
      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'myusername' });
      });

      expect(result.current.step).toBe('password');
      expect(result.current.email).toBe('myusername');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should not reveal whether a username is registered', async () => {
      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'unknownuser' });
      });

      expect(mockMessageError).not.toHaveBeenCalled();
      expect(result.current.step).toBe('password');
      expect(result.current.email).toBe('unknownuser');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should show error for invalid identifier', async () => {
      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'invalid email!@#' });
      });

      expect(mockMessageError).toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('handleSignIn', () => {
    it('should call signIn.email and redirect on success', async () => {
      mockSignInEmail.mockImplementation(async (_data: any, opts: any) => {
        opts.onSuccess();
        return { error: null };
      });

      const { result } = renderHook(() => useSignIn());

      // Set email first via handleCheckUser
      await act(async () => {
        await result.current.handleCheckUser({ email: 'user@example.com' });
      });

      await act(async () => {
        await result.current.handleSignIn({ password: 'password123' });
      });

      expect(mockSignInEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          callbackURL: `${originalLocation.origin}/lobehub/group/default`,
          email: 'user@example.com',
          password: 'password123',
        }),
        expect.any(Object),
      );
      expect(window.location.href).toBe('/lobehub/group/default');
    });

    it('should sign in a username without exposing its resolved email to the client', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ authenticated: true }),
        ok: true,
        status: 200,
      });
      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'myusername' });
      });
      await act(async () => {
        await result.current.handleSignIn({ password: 'password123' });
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/auth/resolve-username', {
        body: JSON.stringify({
          callbackURL: '/lobehub/group/default',
          password: 'password123',
          username: 'myusername',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      expect(mockSignInEmail).not.toHaveBeenCalled();
      expect(window.location.href).toBe('/lobehub/group/default');
    });

    it('should show the same generic field error for a failed username login', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ code: 'INVALID_CREDENTIALS' }),
        ok: false,
        status: 401,
      });
      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'unknownuser' });
      });
      await act(async () => {
        await result.current.handleSignIn({ password: 'wrong-password' });
      });

      expect(mockSetFields).toHaveBeenCalledWith([
        { errors: [expect.any(String)], name: 'password' },
      ]);
      expect(mockMessageError).not.toHaveBeenCalled();
    });

    it.each(['javascript:alert(1)', 'https://evil.com', '//evil.com'])(
      'should fall back to the default group instead of a hostile callbackUrl %s',
      async (hostileUrl) => {
        mockSearchParamsGet.mockImplementation((key: string) =>
          key === 'callbackUrl' ? hostileUrl : null,
        );
        mockSignInEmail.mockImplementation(async (_data: any, opts: any) => {
          opts.onSuccess();
          return { error: null };
        });
        mockFetch.mockResolvedValueOnce({
          json: async () => ({ exists: true, hasPassword: true }),
          ok: true,
        });

        const { result } = renderHook(() => useSignIn());

        await act(async () => {
          await result.current.handleCheckUser({ email: 'user@example.com' });
        });

        await act(async () => {
          await result.current.handleSignIn({ password: 'password123' });
        });

        expect(mockSignInEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            callbackURL: `${originalLocation.origin}/lobehub/group/default`,
          }),
          expect.any(Object),
        );
        expect(window.location.href).toBe('/lobehub/group/default');
      },
    );

    it('should surface sign in failure as an inline password error', async () => {
      mockSignInEmail.mockResolvedValue({
        error: { message: 'Invalid credentials', status: 401 },
      });

      mockFetch.mockResolvedValueOnce({
        json: async () => ({ exists: true, hasPassword: true }),
        ok: true,
      });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'user@example.com' });
      });

      await act(async () => {
        await result.current.handleSignIn({ password: 'wrong' });
      });

      // Error is pinned inline on the password field, not shown as a toast
      expect(mockSetFields).toHaveBeenCalledWith([
        { errors: ['betterAuth.signin.error'], name: 'password' },
      ]);
      expect(mockSetFields).not.toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ errors: ['Invalid credentials'] })]),
      );
      expect(mockMessageError).not.toHaveBeenCalled();
    });

    it('should redirect to verify-email only for an explicit unverified-email error', async () => {
      mockSignInEmail.mockImplementation(async (_data: any, opts: any) => {
        opts.onError({ error: { code: 'EMAIL_NOT_VERIFIED', status: 403 } });
        return {
          error: { code: 'EMAIL_NOT_VERIFIED', message: 'Email not verified', status: 403 },
        };
      });

      mockFetch.mockResolvedValueOnce({
        json: async () => ({ exists: true, hasPassword: true }),
        ok: true,
      });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'user@example.com' });
      });

      await act(async () => {
        await result.current.handleSignIn({ password: 'password' });
      });

      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('/verify-email?email=user%40example.com'),
      );
    });

    it('should keep a non-verification 403 on the password step', async () => {
      mockSignInEmail.mockImplementation(async (_data: any, opts: any) => {
        opts.onError({ error: { code: 'INVALID_ORIGIN', status: 403 } });
        return { error: { code: 'INVALID_ORIGIN', message: 'Forbidden', status: 403 } };
      });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'user@example.com' });
      });
      await act(async () => {
        await result.current.handleSignIn({ password: 'password' });
      });

      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockSetFields).toHaveBeenCalledWith([
        { errors: ['betterAuth.signin.error'], name: 'password' },
      ]);
    });

    it('should coalesce rapid password sign-in submissions into one request', async () => {
      let resolveSignIn: ((value: { error: null }) => void) | undefined;
      mockSignInEmail.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSignIn = resolve;
          }),
      );
      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'user@example.com' });
      });

      let firstRequest: Promise<void>;
      let secondRequest: Promise<void>;
      act(() => {
        firstRequest = result.current.handleSignIn({ password: 'password123' });
        secondRequest = result.current.handleSignIn({ password: 'password123' });
      });

      await vi.waitFor(() => expect(mockSignInEmail).toHaveBeenCalled());
      expect(mockSignInEmail).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveSignIn?.({ error: null });
        await Promise.all([firstRequest!, secondRequest!]);
      });
      expect(result.current.loading).toBe(false);
    });
  });

  describe('handleSocialSignIn', () => {
    it('does not reopen the WeChat dialog after it was closed while authorization was loading', async () => {
      let resolveWechat: ((value: any) => void) | undefined;
      mockSignInOauth2.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveWechat = resolve;
          }),
      );

      const { result } = renderHook(() => useSignIn());
      let request: Promise<void> | undefined;

      act(() => {
        request = result.current.handleSocialSignIn('wechat');
      });
      await vi.waitFor(() => expect(resolveWechat).toBeTypeOf('function'));

      act(() => result.current.closeWechatAuth());
      await act(async () => {
        resolveWechat?.({
          data: {
            redirect: false,
            url: 'https://open.weixin.qq.com/connect/qrconnect?scope=snsapi_login',
          },
          error: null,
        });
        await request;
      });

      expect(result.current.wechatAuthUrl).toBeNull();
    });

    it.each([
      'http://127.0.0.1:3010/lobehub/api/auth/callback/wechat',
      'https://lvyouqun.com/lobehub/api/auth/callback/wechat',
    ])('preserves the server-configured WeChat callback: %s', async (callbackUrl) => {
      const authorizationUrl = new URL('https://open.weixin.qq.com/connect/qrconnect');
      authorizationUrl.searchParams.set('redirect_uri', callbackUrl);
      mockSignInOauth2.mockResolvedValue({
        data: { redirect: false, url: authorizationUrl.toString() },
        error: null,
      });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleSocialSignIn('wechat');
      });

      const mobileAuthorizationUrl = new URL(result.current.wechatAuthUrl!);
      expect(mobileAuthorizationUrl.searchParams.get('redirect_uri')).toBe(callbackUrl);
    });

    it('returns the WeChat authorization URL for an in-page dialog', async () => {
      const open = vi.spyOn(window, 'open');
      mockSignInOauth2.mockResolvedValue({
        data: {
          redirect: false,
          url: 'https://open.weixin.qq.com/connect/qrconnect?scope=snsapi_login',
        },
        error: null,
      });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleSocialSignIn('wechat');
      });

      expect(mockSignInOauth2).toHaveBeenCalledWith(
        expect.objectContaining({ disableRedirect: true, providerId: 'wechat' }),
      );
      expect(result.current.wechatAuthUrl).toContain('open.weixin.qq.com/connect/qrconnect');
      expect(open).not.toHaveBeenCalled();
    });

    it('should bind relative OAuth callbacks to the current auth origin', async () => {
      const authOrigin = 'https://auth.example.com';
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: {
          ...originalLocation,
          href: `${authOrigin}/signin`,
          origin: authOrigin,
          pathname: '/signin',
        },
        writable: true,
      });
      mockSearchParamsGet.mockImplementation((key: string) =>
        key === 'callbackUrl' ? '/workspace?tab=members' : null,
      );
      mockSignInSocial.mockResolvedValue({ url: 'https://google.com/auth' });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleSocialSignIn('google');
      });

      expect(mockSignInSocial).toHaveBeenCalledWith(
        expect.objectContaining({
          callbackURL: `${authOrigin}/workspace?tab=members`,
          newUserCallbackURL: `${authOrigin}/onboarding?callbackUrl=%2Fworkspace%3Ftab%3Dmembers`,
        }),
      );
    });

    it('should call signIn.social for builtin providers', async () => {
      mockSignInSocial.mockResolvedValue({ url: 'https://google.com/auth' });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleSocialSignIn('google');
      });

      expect(mockSignInSocial).toHaveBeenCalledWith(
        expect.objectContaining({
          newUserCallbackURL: `${originalLocation.origin}/lobehub/onboarding?callbackUrl=%2Flobehub%2Fgroup%2Fdefault`,
          provider: 'google',
        }),
      );
      expect(mockMessageError).not.toHaveBeenCalled();
    });

    it('should call signIn.oauth2 for custom providers', async () => {
      mockSignInOauth2.mockResolvedValue({ url: 'https://custom.com/auth' });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleSocialSignIn('custom-oidc');
      });

      expect(mockSignInOauth2).toHaveBeenCalledWith(
        expect.objectContaining({
          newUserCallbackURL: `${originalLocation.origin}/lobehub/onboarding?callbackUrl=%2Flobehub%2Fgroup%2Fdefault`,
          providerId: 'custom-oidc',
        }),
      );
    });

    it('should NOT throw when result has error: null (redirect case)', async () => {
      mockSignInSocial.mockResolvedValue({
        error: null,
        redirect: true,
        url: 'https://google.com/auth',
      });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleSocialSignIn('google');
      });

      // Should not show error toast — this is the critical regression test
      expect(mockMessageError).not.toHaveBeenCalled();
    });

    it('should show error when result has a real error', async () => {
      mockSignInSocial.mockResolvedValue({
        error: { message: 'OAuth failed', status: 500 },
      });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleSocialSignIn('google');
      });

      expect(mockMessageError).toHaveBeenCalled();
    });

    it('should not retry social sign in when captcha is returned unexpectedly', async () => {
      mockSignInSocial.mockResolvedValue({
        error: { code: 'CAPTCHA_REQUIRED', message: 'Missing CAPTCHA response', status: 400 },
      });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleSocialSignIn('google');
      });

      expect(mockSignInSocial).toHaveBeenCalledTimes(1);
      expect(mockMessageError).toHaveBeenCalled();
    });

    it('should save last auth provider to localStorage', async () => {
      mockSignInSocial.mockResolvedValue({ url: 'https://google.com/auth' });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleSocialSignIn('google');
      });

      expect(localStorage.getItem('lobehub:auth:last-provider:v1')).toBe('google');
    });

    it('should stop social sign in when business pre-check rejects', async () => {
      mockEnableBusinessFeatures = true;
      mockBusinessSignin.preSocialSigninCheck.mockResolvedValue(false);

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleSocialSignIn('google');
      });

      expect(mockBusinessSignin.preSocialSigninCheck).toHaveBeenCalled();
      expect(mockSignInSocial).not.toHaveBeenCalled();
    });
  });

  describe('handleBackToEmail', () => {
    it('should reset to email step', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ exists: true, hasPassword: true }),
        ok: true,
      });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'user@example.com' });
      });

      expect(result.current.step).toBe('password');

      act(() => {
        result.current.handleBackToEmail();
      });

      expect(result.current.step).toBe('email');
      expect(result.current.authMode).toBe('email');
      expect(result.current.email).toBe('');
      expect(result.current.isSocialOnly).toBe(false);
      // The shared form's password (+ any inline error) must be cleared so the
      // next email doesn't remount pre-filled with the previous account's value.
      expect(mockResetFields).toHaveBeenCalledWith(['password']);
    });
  });

  describe('handleForgotPassword', () => {
    it('should call requestPasswordReset and land on the email-sent state', async () => {
      mockRequestPasswordReset.mockResolvedValue({ data: { status: true }, error: null });

      mockFetch.mockResolvedValueOnce({
        json: async () => ({ exists: true, hasPassword: true }),
        ok: true,
      });

      const { result } = renderHook(() => useSignIn());

      // Set email first
      await act(async () => {
        await result.current.handleCheckUser({ email: 'user@example.com' });
      });

      await act(async () => {
        await result.current.handleForgotPassword();
      });

      expect(mockRequestPasswordReset).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'user@example.com',
          redirectTo: `${originalLocation.origin}/lobehub/reset-password?email=user%40example.com`,
        }),
      );
      // Success is a persistent landing state, not a fleeting toast
      expect(result.current.step).toBe('emailSent');
      expect(result.current.sentInfo).toEqual(
        expect.objectContaining({ email: 'user@example.com', type: 'resetPassword' }),
      );
    });

    it('keeps a username opaque while requesting a reset and shows the same sent state', async () => {
      mockRequestPasswordReset.mockResolvedValue({ data: { status: true }, error: null });
      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'traveler_name' });
      });
      await act(async () => {
        await result.current.handleForgotPassword();
      });

      expect(mockRequestPasswordReset).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'traveler_name',
          redirectTo: `${originalLocation.origin}/lobehub/reset-password?email=traveler_name`,
        }),
      );
      expect(result.current.step).toBe('emailSent');
      expect(result.current.sentInfo).toEqual({ email: 'traveler_name', type: 'resetPassword' });
    });

    it('should no-op when no email has been resolved yet', async () => {
      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleForgotPassword();
      });

      expect(mockRequestPasswordReset).not.toHaveBeenCalled();
      expect(result.current.step).toBe('email');
    });

    // The better-auth client resolves with `{ data, error }` rather than
    // throwing, so a rejected-promise test alone leaves the failure branch
    // unreachable and a failed send lands on the "email sent" screen.
    it('should show error and stay put when the client resolves with an error', async () => {
      mockRequestPasswordReset.mockResolvedValue({
        data: null,
        error: { message: 'Email provider rejected the request', status: 503 },
      });

      mockFetch.mockResolvedValueOnce({
        json: async () => ({ exists: true, hasPassword: true }),
        ok: true,
      });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'user@example.com' });
      });

      await act(async () => {
        await result.current.handleForgotPassword();
      });

      expect(mockMessageError).toHaveBeenCalled();
      expect(result.current.step).toBe('password');
      expect(result.current.sentInfo).toBeNull();
    });

    it('should show error on failure', async () => {
      mockRequestPasswordReset.mockRejectedValue(new Error('fail'));

      mockFetch.mockResolvedValueOnce({
        json: async () => ({ exists: true, hasPassword: true }),
        ok: true,
      });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'user@example.com' });
      });

      await act(async () => {
        await result.current.handleForgotPassword();
      });

      expect(mockMessageError).toHaveBeenCalled();
      expect(result.current.step).toBe('password');
    });
  });

  describe('magic link', () => {
    it('should land on email-sent state when a passwordless user triggers magic link', async () => {
      mockEnableMagicLink = true;
      mockSignInMagicLink.mockResolvedValue({ error: null });
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ exists: true, hasPassword: false }),
        ok: true,
      });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'user@example.com' });
      });

      expect(mockSignInMagicLink).toHaveBeenCalledTimes(1);
      expect(mockSignInMagicLink).toHaveBeenCalledWith(
        expect.objectContaining({
          callbackURL: `${originalLocation.origin}/lobehub/group/default`,
          newUserCallbackURL: `${originalLocation.origin}/lobehub/onboarding?callbackUrl=%2Flobehub%2Fgroup%2Fdefault`,
        }),
      );
      expect(result.current.step).toBe('emailSent');
      expect(result.current.sentInfo).toEqual(
        expect.objectContaining({ email: 'user@example.com', type: 'magicLink' }),
      );
    });
  });

  describe('handleResendEmail', () => {
    it('should resend the password reset email and confirm', async () => {
      mockRequestPasswordReset.mockResolvedValue({ data: { status: true }, error: null });
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ exists: true, hasPassword: true }),
        ok: true,
      });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'user@example.com' });
      });
      await act(async () => {
        await result.current.handleForgotPassword();
      });

      mockRequestPasswordReset.mockClear();

      await act(async () => {
        await result.current.handleResendEmail();
      });

      expect(mockRequestPasswordReset).toHaveBeenCalledTimes(1);
      expect(mockMessageSuccess).toHaveBeenCalled();
      expect(result.current.step).toBe('emailSent');
    });
  });

  describe('handleBackFromSent', () => {
    it('should return to the email entry (not the password step) after a reset email', async () => {
      mockRequestPasswordReset.mockResolvedValue({ data: { status: true }, error: null });
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ exists: true, hasPassword: true }),
        ok: true,
      });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'user@example.com' });
      });
      await act(async () => {
        await result.current.handleForgotPassword();
      });

      expect(result.current.step).toBe('emailSent');

      act(() => {
        result.current.handleBackFromSent();
      });

      // "Use a different email" must land on the email entry so the label
      // matches the action, and reset the shared password field.
      expect(result.current.step).toBe('email');
      expect(result.current.email).toBe('');
      expect(result.current.sentInfo).toBeNull();
      expect(mockResetFields).toHaveBeenCalledWith(['password']);
    });
  });

  describe('provider sorting', () => {
    it('should sort last used provider first', () => {
      localStorage.setItem('lobehub:auth:last-provider:v1', 'github');

      const { result } = renderHook(() => useSignIn());

      expect(result.current.oAuthSSOProviders[0]).toBe('github');

      localStorage.removeItem('lobehub:auth:last-provider:v1');
    });

    it('should use business SSO providers when business features are enabled by server config', () => {
      mockEnableBusinessFeatures = true;
      mockBusinessSignin.ssoProviders = ['saml'];

      const { result } = renderHook(() => useSignIn());

      expect(result.current.oAuthSSOProviders).toEqual(['saml']);
    });
  });
});
