import { getServerFeatureFlagsValue } from '@/config/featureFlags';
import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import {
  buildAnalyticsConfig,
  fetchViteDevTemplate,
  renderSpaHtml,
  resolveViteBrowserOrigin,
} from '@/libs/spaHtml';
import { type Locales, normalizeLocale } from '@/locales/resources';
import { getServerAuthConfig } from '@/server/globalConfig/getServerAuthConfig';
import { type AuthSPAServerConfig } from '@/types/spaServerConfig';

import { buildSeoMeta } from './seoMeta';

export function generateStaticParams() {
  const staticLocales: Locales[] = ['en-US', 'zh-CN'];

  return staticLocales.map((locale) => ({ locale }));
}

const isDev = process.env.NODE_ENV === 'development';

async function getTemplate(request: Request): Promise<string> {
  if (isDev)
    return fetchViteDevTemplate(
      '/index.auth.html',
      resolveViteBrowserOrigin(request.url, undefined, request.headers.get('x-forwarded-host')),
    );

  const { authHtmlTemplate } = await import('../../authHtmlTemplate');

  return authHtmlTemplate;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string; path?: string[] }> },
) {
  const { locale: rawLocale, path } = await params;
  const locale = normalizeLocale(rawLocale);

  const authConfig: AuthSPAServerConfig = {
    analyticsConfig: buildAnalyticsConfig(),
    config: getServerAuthConfig(),
    enableOIDC: authEnv.ENABLE_OIDC,
    featureFlags: getServerFeatureFlagsValue(),
    globalCDN: appEnv.CDN_USE_GLOBAL,
  };

  const template = await getTemplate(request);
  const pathname = `/${(path ?? []).join('/')}`;
  const seoMeta = await buildSeoMeta(locale, pathname);

  return renderSpaHtml(template, { seoMeta, serverConfig: authConfig });
}
