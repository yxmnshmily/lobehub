import { BRANDING_NAME, ORG_NAME } from '@lobechat/business-const';
import { OG_URL } from '@lobechat/const';

import { getServerFeatureFlagsValue } from '@/config/featureFlags';
import { OFFICIAL_URL } from '@/const/url';
import { isCustomORG } from '@/const/version';
import { appEnv } from '@/envs/app';
import { fileEnv } from '@/envs/file';
import { pythonEnv } from '@/envs/python';
import { translation } from '@/libs/i18n/serverTranslation';
import {
  buildAnalyticsConfig,
  fetchViteDevTemplate,
  renderSpaHtml,
  resolveViteBrowserOrigin,
  resolveViteSpaTemplatePath,
} from '@/libs/spaHtml';
import { type Locales } from '@/locales/resources';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { type SPAClientEnv, type SPAServerConfig } from '@/types/spaServerConfig';
import { RouteVariants } from '@/utils/server/routeVariants';

export function generateStaticParams() {
  /* 2026-09-17：移动版整体删除（mobile 路由树 / entry.mobile / mobile 模板已移除），
     用户口径"网页端自适应手机端"——任何设备都渲染 desktop variant。variants 序列化
     结构保留（isMobile 恒 false），RouteVariants 是跨项目通用基建不宜动。 */
  const staticLocales: Locales[] = ['en-US', 'zh-CN'];

  const variants: { variants: string }[] = [];

  for (const locale of staticLocales) {
    variants.push({
      variants: RouteVariants.serializeVariants({ isMobile: false, locale }),
    });
  }

  return variants;
}

const isDev = process.env.NODE_ENV === 'development';

async function getTemplate(request: Request): Promise<string> {
  if (isDev)
    return fetchViteDevTemplate(
      resolveViteSpaTemplatePath(),
      resolveViteBrowserOrigin(request.url, undefined, request.headers.get('x-forwarded-host')),
    );

  const { desktopHtmlTemplate } = await import('./spaHtmlTemplates');

  return desktopHtmlTemplate;
}

function buildClientEnv(): SPAClientEnv {
  return {
    marketBaseUrl: appEnv.MARKET_BASE_URL,
    pyodideIndexUrl: pythonEnv.NEXT_PUBLIC_PYODIDE_INDEX_URL,
    pyodidePipIndexUrl: pythonEnv.NEXT_PUBLIC_PYODIDE_PIP_INDEX_URL,
    s3FilePath: fileEnv.NEXT_PUBLIC_S3_FILE_PATH,
  };
}

async function buildSeoMeta(locale: string): Promise<string> {
  const { t } = await translation('metadata', locale);
  const title = t('chat.title', { appName: BRANDING_NAME });
  const description = t('chat.description', { appName: BRANDING_NAME });

  const metas = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${OFFICIAL_URL}" />`,
    `<meta property="og:image" content="${OG_URL}" />`,
    `<meta property="og:site_name" content="${BRANDING_NAME}" />`,
    `<meta property="og:locale" content="${locale}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${OG_URL}" />`,
    `<meta name="twitter:site" content="${isCustomORG ? `@${ORG_NAME}` : '@lobehub'}" />`,
  ];

  return metas.join('\n    ');
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path?: string[]; variants: string }> },
) {
  const { variants } = await params;
  const { locale } = RouteVariants.deserializeVariants(variants);

  const spaConfig: SPAServerConfig = {
    analyticsConfig: buildAnalyticsConfig({ desktop: true }),
    clientEnv: buildClientEnv(),
    config: await getServerGlobalConfig(),
    featureFlags: getServerFeatureFlagsValue(),
    isMobile: false,
  };

  const template = await getTemplate(request);
  const seoMeta = await buildSeoMeta(locale);

  return renderSpaHtml(template, { seoMeta, serverConfig: spaConfig });
}
