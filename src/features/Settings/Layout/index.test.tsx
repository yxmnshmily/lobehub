// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import Layout from './index';

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, ...props }: React.ComponentProps<'div'>) => (
    <div {...props}>{children}</div>
  ),
}));
vi.mock('react-router', () => ({ Outlet: () => <main>设置内容</main> }));
vi.mock('swr', () => ({ SWRConfig: ({ children }: { children?: React.ReactNode }) => children }));
vi.mock('@/components/SuspenseRouteBoundary', () => ({
  default: ({ children }: { children?: React.ReactNode }) => children,
}));
vi.mock('@/features/NavPanel/useActiveNavKey', () => ({ useActiveNavKey: () => 'settings' }));
vi.mock('@/spa/router/routeSkeletonChrome', () => ({
  RouteSkeletonChromeProvider: ({ children }: { children?: React.ReactNode }) => children,
}));
vi.mock('./ContextProvider', () => ({
  default: ({ children }: { children?: React.ReactNode }) => children,
}));
vi.mock('./SideBar', () => ({ default: () => <aside>设置导航</aside> }));

describe('desktop settings layout', () => {
  it('uses the A layout with a flat settings content surface instead of a framed card', () => {
    const { container } = render(<Layout />);

    expect(container.querySelector('[data-settings-desktop-layout="a"]')).toBeInTheDocument();
    const surface = container.querySelector('[data-settings-content-surface]');
    expect(surface).toHaveAttribute('data-settings-surface', 'flat');
    expect(surface).toContainElement(screen.getByRole('main'));
  });
});
