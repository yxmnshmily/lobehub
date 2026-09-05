/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import MobileMainLayout from './index';

const mocks = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('react-router', () => ({
  Outlet: () => <main />,
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
  it.each(['/agents', '/apps'])('does not show the personal bottom navigation on %s', (pathname) => {
    mocks.pathname = pathname;

    render(<MobileMainLayout />);

    expect(screen.queryByRole('navigation', { name: 'mobile-primary' })).not.toBeInTheDocument();
  });

  it('shows the primary navigation on a workspace home route', () => {
    mocks.pathname = '/travel-team';

    render(<MobileMainLayout />);

    expect(screen.getByRole('navigation', { name: 'mobile-primary' })).toBeInTheDocument();
  });
});
