import { APPLE_APP_STORE_ID, BRANDING_NAME, ORG_NAME } from '@lobechat/business-const';
import { OG_URL } from '@lobechat/const';
import urlJoin from 'url-join';

import { OFFICIAL_URL } from '@/const/url';
import { isCustomORG } from '@/const/version';
import { translation } from '@/libs/i18n/serverTranslation';
import { normalizeLocale } from '@/locales/resources';

interface AuthSeoEntry {
  canonicalPath?: string;
  description: string;
  title: string;
}

export async function buildAuthSeoEntry(locale: string, pathname: string): Promise<AuthSeoEntry> {
  const { t } = await translation('auth', normalizeLocale(locale));
  const normalizedPath =
    pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const withBrand = (title: string) => `${title} · ${BRANDING_NAME}`;

  switch (normalizedPath) {
    case '/signin': {
      return {
        canonicalPath: '/signin',
        description: t('signin.subtitle', { appName: BRANDING_NAME }),
        title: withBrand(t('betterAuth.signin.emailStep.title')),
      };
    }
    case '/signup': {
      return {
        canonicalPath: '/signup',
        description: t('betterAuth.signup.subtitle'),
        title: withBrand(t('betterAuth.signup.title')),
      };
    }
    case '/verify-email': {
      return {
        description: t('betterAuth.verifyEmail.description', { email: '' }),
        title: withBrand(t('betterAuth.verifyEmail.title')),
      };
    }
    case '/reset-password': {
      return {
        description: t('betterAuth.resetPassword.description'),
        title: withBrand(t('betterAuth.resetPassword.title')),
      };
    }
    case '/auth-error': {
      const { t: translateError } = await translation('authError', normalizeLocale(locale));
      return {
        description: translateError('codes.UNKNOWN'),
        title: withBrand(translateError('title')),
      };
    }
    default: {
      return {
        description: t('signin.subtitle', { appName: BRANDING_NAME }),
        title: BRANDING_NAME,
      };
    }
  }
}

export async function buildSeoMeta(locale: string, pathname: string): Promise<string> {
  const lng = normalizeLocale(locale);
  const { title, description, canonicalPath } = await buildAuthSeoEntry(lng, pathname);
  const ogUrl = canonicalPath ? urlJoin(OFFICIAL_URL, canonicalPath) : OFFICIAL_URL;

  const metas = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${ogUrl}" />`,
    `<meta property="og:image" content="${OG_URL}" />`,
    `<meta property="og:site_name" content="${BRANDING_NAME}" />`,
    `<meta property="og:locale" content="${lng}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${OG_URL}" />`,
    `<meta name="twitter:site" content="${isCustomORG ? `@${ORG_NAME}` : '@lobehub'}" />`,
  ];

  if (APPLE_APP_STORE_ID) {
    metas.push(`<meta name="apple-itunes-app" content="app-id=${APPLE_APP_STORE_ID}" />`);
  }

  return metas.join('\n    ');
}
