import { useTheme } from 'next-themes';
import type { ComponentType, CSSProperties, ReactElement } from 'react';
import { lazy, Suspense, useEffect, useState } from 'react';
import type { RouteObject } from 'react-router';
import { Outlet, useRouteError } from 'react-router';

import Loading from '@/components/Loading/BrandTextLoading';
import { DEFAULT_LANG, LOBE_LOCALE_COOKIE } from '@/const/locale';
import { withLobeHubMountPath } from '@/features/Auth/utils/mountedPath';
import AuthShell from '@/features/AuthShell';
import defaultAuthError from '@/locales/default/authError';
import defaultError from '@/locales/default/error';
import { normalizeLocale } from '@/locales/resources';
import { isChunkLoadError, notifyChunkError } from '@/utils/chunkError';
import { unwrapESMModule } from '@/utils/esm/unwrapESMModule';
import { loadI18nNamespaceModule } from '@/utils/i18n/loadI18nNamespaceModule';

// Local helper on purpose: @/utils/router's dynamicElement would pull SPAGlobalProvider/global store into the auth bundle
const lazyElement = (importFn: () => Promise<{ default: ComponentType }>): ReactElement => {
  const LazyComponent = lazy(importFn);

  return <LazyComponent />;
};

const buttonStyle: CSSProperties = {
  background: 'transparent',
  border: '1px solid currentcolor',
  borderRadius: 6,
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
  padding: '6px 16px',
};

interface AuthErrorCopy {
  retry: string;
  signIn: string;
  title: string;
}

type LocaleResource = Record<string, string>;

const defaultErrorCopy: AuthErrorCopy = {
  retry: defaultError['error.retry'],
  signIn: defaultAuthError['actions.retry'],
  title: defaultError['error.title'],
};

const readAuthErrorLocale = () => {
  if (typeof document === 'undefined') return DEFAULT_LANG;

  try {
    const cookie = document.cookie
      .split('; ')
      .find((item) => item.startsWith(`${LOBE_LOCALE_COOKIE}=`));
    if (cookie) {
      return normalizeLocale(decodeURIComponent(cookie.slice(LOBE_LOCALE_COOKIE.length + 1)));
    }
  } catch {
    // Fall through to the other persisted locale sources.
  }

  try {
    const persisted = JSON.parse(localStorage.getItem('LOBE_SYSTEM_STATUS') || '{}');
    if (typeof persisted.language === 'string') return normalizeLocale(persisted.language);
  } catch {
    // Ignore a malformed preference and use the document locale.
  }

  return normalizeLocale(document.documentElement.lang || navigator.language);
};

const loadAuthErrorCopy = async (locale: string): Promise<AuthErrorCopy> => {
  if (locale === DEFAULT_LANG) return defaultErrorCopy;

  const [errorModule, authErrorModule] = await Promise.all([
    loadI18nNamespaceModule({
      defaultLang: DEFAULT_LANG,
      lng: locale,
      normalizeLocale,
      ns: 'error',
    }),
    loadI18nNamespaceModule({
      defaultLang: DEFAULT_LANG,
      lng: locale,
      normalizeLocale,
      ns: 'authError',
    }),
  ]);
  const errorResource = unwrapESMModule<LocaleResource>(errorModule);
  const authErrorResource = unwrapESMModule<LocaleResource>(authErrorModule);

  return {
    retry: errorResource['error.retry'] || defaultErrorCopy.retry,
    signIn: authErrorResource['actions.retry'] || defaultErrorCopy.signIn,
    title: errorResource['error.title'] || defaultErrorCopy.title,
  };
};

export const useAuthErrorCopy = () => {
  const [locale] = useState(readAuthErrorLocale);
  const [copy, setCopy] = useState<AuthErrorCopy | undefined>(() =>
    locale === DEFAULT_LANG ? defaultErrorCopy : undefined,
  );

  useEffect(() => {
    let active = true;

    void loadAuthErrorCopy(locale)
      .then((nextCopy) => {
        if (active) setCopy(nextCopy);
      })
      .catch(() => {
        if (active) setCopy(defaultErrorCopy);
      });

    return () => {
      active = false;
    };
  }, [locale]);

  return copy;
};

// This boundary renders outside AuthShell, so it loads the selected locale directly.
const AuthErrorBoundary = () => {
  const error = useRouteError() as Error;
  const { resolvedTheme } = useTheme();
  const copy = useAuthErrorCopy();

  if (typeof window !== 'undefined' && isChunkLoadError(error)) {
    notifyChunkError(error);
  }

  // index.auth.html paints the body black in dark mode before React mounts
  const isDark = resolvedTheme === 'dark';

  return (
    <div
      style={{
        alignItems: 'center',
        background: isDark ? '#000' : '#f8f8f8',
        color: isDark ? '#e6e6e6' : '#1a1a1a',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'sans-serif',
        gap: 16,
        justifyContent: 'center',
        minHeight: '100dvh',
        padding: 16,
      }}
    >
      {copy && (
        <>
          <h2 style={{ margin: 0 }}>{copy.title}</h2>
          <div style={{ display: 'flex', gap: 12 }}>
            <button style={buttonStyle} type={'button'} onClick={() => window.location.reload()}>
              {copy.retry}
            </button>
            <a
              href={withLobeHubMountPath('/signin')}
              style={{ ...buttonStyle, textDecoration: 'none' }}
            >
              {copy.signIn}
            </a>
          </div>
        </>
      )}
    </div>
  );
};

export const authRoutes: RouteObject[] = [
  {
    children: [
      {
        element: lazyElement(() => import('@/routes/auth/signin')),
        path: 'signin',
      },
      {
        element: lazyElement(() => import('@/routes/auth/signup')),
        path: 'signup',
      },
      {
        element: lazyElement(() => import('@/routes/auth/verify-email')),
        path: 'verify-email',
      },
      {
        element: lazyElement(() => import('@/routes/auth/reset-password')),
        path: 'reset-password',
      },
      {
        element: lazyElement(() => import('@/routes/auth/auth-error')),
        path: 'auth-error',
      },
      {
        element: lazyElement(() => import('@/routes/auth/market-auth-callback')),
        path: 'market-auth-callback',
      },
      {
        element: lazyElement(() => import('@/routes/auth/oauth/consent/[uid]')),
        path: 'oauth/consent/:uid',
      },
      {
        element: lazyElement(() => import('@/routes/auth/oauth/device')),
        path: 'oauth/device',
      },
      {
        element: lazyElement(() => import('@/routes/auth/oauth/device/confirm')),
        path: 'oauth/device/confirm',
      },
      {
        element: lazyElement(() => import('@/routes/auth/oauth/device/success')),
        path: 'oauth/device/success',
      },
      {
        element: lazyElement(() => import('@/routes/auth/oauth/callback/success')),
        path: 'oauth/callback/success',
      },
      {
        element: lazyElement(() => import('@/routes/auth/oauth/callback/social')),
        path: 'oauth/callback/social',
      },
      {
        element: lazyElement(() => import('@/routes/auth/oauth/callback/error')),
        path: 'oauth/callback/error',
      },
    ],
    element: (
      <AuthShell>
        <Suspense fallback={<Loading debugId="AuthRoutes" />}>
          <Outlet />
        </Suspense>
      </AuthShell>
    ),
    errorElement: <AuthErrorBoundary />,
    path: '/',
  },
];
