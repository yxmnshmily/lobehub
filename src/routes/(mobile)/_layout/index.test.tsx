/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import MobileMainLayout, { shouldShowMobileNav } from './index';

const mocks = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('react-router', () => ({
  Outlet: () => <main data-testid="mobile-outlet" />,
  useLocation: () => ({ pathname: mocks.pathname }),
}));
vi.mock('@/business/client/WorkspaceContextSlot', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/Loading/BrandTextLoading', () => ({ default: () => null }));
vi.mock('@/features/RouteMeta', () => ({ RouteMetaBridge: () => null }));
vi.mock('@/libs/next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: vi.fn(),
  useServerConfigStore: () => ({ showCloudPromotion: false }),
}));
vi.mock('./NavBar', () => ({ default: () => <nav aria-label="mobile-primary" /> }));

describe('MobileMainLayout', () => {
  it.each(['/community/skill', '/travel-team/community/skill'])(
    'keeps the shared bottom navigation on the community skill route %s',
    (pathname) => {
      expect(shouldShowMobileNav(pathname)).toBe(true);
    },
  );

  it.each(['/agents', '/apps'])(
    'does not show the personal bottom navigation on %s',
    (pathname) => {
      mocks.pathname = pathname;

      render(<MobileMainLayout />);

      expect(screen.queryByRole('navigation', { name: 'mobile-primary' })).not.toBeInTheDocument();
    },
  );

  it('shows the primary navigation on a workspace home route', () => {
    mocks.pathname = '/travel-team';

    render(<MobileMainLayout />);

    expect(screen.getByRole('navigation', { name: 'mobile-primary' })).toBeInTheDocument();
  });

  it('applies shared shrink and media constraints at the mobile route root', () => {
    mocks.pathname = '/settings/appearance';

    render(<MobileMainLayout />);

    const shell = screen.getByTestId('mobile-outlet').parentElement;
    const stylesheet = [...document.querySelectorAll('style')]
      .map((node) => node.textContent)
      .join('\n');

    expect(shell?.className).toBeTruthy();
    expect(stylesheet).toContain('min-width:0');
    expect(stylesheet).toContain('max-width:100%');
    expect(stylesheet).toContain('pre');
    expect(stylesheet).toContain('overflow-x:auto');
    expect(stylesheet).toContain('--mobile-page-gutter:10px');
  });
});
