'use client';

import { createStaticStyles } from 'antd-style';
import { type FC } from 'react';
import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router';

import WorkspaceContextSlot from '@/business/client/WorkspaceContextSlot';
import Loading from '@/components/Loading/BrandTextLoading';
import { MobileNavPanelProvider } from '@/features/NavPanel/MobileNavPanel';
import { RouteMetaBridge } from '@/features/RouteMeta';
import dynamic from '@/libs/next/dynamic';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

import NavBar from './NavBar';

const styles = createStaticStyles(({ css }) => ({
  touchSurface: css`
    --mobile-page-gutter: 10px;
    --mobile-page-inner-gutter: var(--mobile-page-gutter);

    & > * {
      box-sizing: border-box;
      width: 100%;
      min-height: 0;
      min-width: 0;
      max-width: 100%;
    }

    & img,
    & video {
      max-width: 100%;
      height: auto;
    }

    & canvas {
      max-width: 100%;
    }

    & pre {
      overflow-x: auto;
      max-width: 100%;
    }

    & button:not([role='switch']),
    & [role='button']:not(button) {
      box-sizing: border-box;
      min-block-size: 44px;
      min-inline-size: 44px;
    }

    & input:not([type='range']),
    & textarea,
    & select,
    & [role='combobox'] {
      box-sizing: border-box;
      min-block-size: 44px;
    }

    & button[role='switch'] {
      position: relative;
    }

    & button[role='switch']::after {
      content: '';
      position: absolute;
      inset: -11px -4px;
    }
  `,
}));

const CloudBanner = dynamic(() => import('@/features/AlertBanner/CloudBanner'));
const MOBILE_NAV_ROUTES = new Set([
  '/',
  '/community',
  '/community/agent',
  '/community/mcp',
  '/community/plugin',
  '/community/model',
  '/community/provider',
  '/community/skill',
  '/me',
]);

const RESERVED_ROOT_SEGMENTS = new Set([
  'acceptance',
  'admin',
  'agent',
  'agents',
  'api',
  'apps',
  'auth-error',
  'community',
  'group',
  'image',
  'market-auth-callback',
  'me',
  'oauth',
  'onboarding',
  'page',
  'profile',
  'reset-password',
  'resource',
  'settings',
  'share',
  'signin',
  'signup',
  'task',
  'tasks',
  'verify-email',
  'video',
]);

export const shouldShowMobileNav = (pathname: string) => {
  const normalizedPath = `/${pathname.split('/').filter(Boolean).join('/')}`;
  if (MOBILE_NAV_ROUTES.has(normalizedPath)) return true;

  const segments = normalizedPath.split('/').filter(Boolean);
  if (segments.length === 0 || RESERVED_ROOT_SEGMENTS.has(segments[0])) return false;

  const workspacePath = segments.length === 1 ? '/' : `/${segments.slice(1).join('/')}`;
  return MOBILE_NAV_ROUTES.has(workspacePath);
};

const MobileMainLayout: FC = () => {
  const { showCloudPromotion } = useServerConfigStore(featureFlagsSelectors);
  const location = useLocation();
  const pathname = location.pathname;
  const showNav = shouldShowMobileNav(pathname);
  return (
    <WorkspaceContextSlot>
      <RouteMetaBridge />
      <Suspense fallback={null}>{showCloudPromotion && <CloudBanner mobile />}</Suspense>
      <Suspense fallback={<Loading debugId="MobileMainLayout > Outlet" />}>
        <MobileNavPanelProvider>
          <div className={styles.touchSurface} style={{ display: 'contents' }}>
            <Outlet />
            {showNav && <NavBar />}
          </div>
        </MobileNavPanelProvider>
      </Suspense>
    </WorkspaceContextSlot>
  );
};

export default MobileMainLayout;
