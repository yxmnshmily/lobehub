// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import Header from './Header';

const navigate = vi.fn();

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, undefined, children),
}));

vi.mock('@lobehub/ui/mobile', () => {
  const ChatHeader = ({
    center,
    left,
    showBackButton,
  }: {
    center?: React.ReactNode;
    left?: React.ReactNode;
    showBackButton?: boolean;
  }) =>
    React.createElement(
      'header',
      undefined,
      left ?? (showBackButton ? React.createElement('button') : null),
      center,
    );

  ChatHeader.Title = ({ title }: { title?: React.ReactNode }) =>
    React.createElement(React.Fragment, undefined, title);

  return { ChatHeader };
});

vi.mock('@lobehub/ui/base-ui', () => ({
  ActionIcon: ({
    size,
    ...props
  }: React.ComponentProps<'button'> & { size?: { blockSize?: number } }) =>
    React.createElement('button', {
      ...props,
      'data-block-size': size?.blockSize,
      'type': 'button',
    }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));

vi.mock('@/hooks/useShowMobileWorkspace', () => ({ useShowMobileWorkspace: () => false }));

vi.mock('@/store/session', () => ({
  useSessionStore: (selector: (state: { activeId?: string }) => unknown) => selector({}),
}));

const renderHeader = (tab: string) => {
  const router = createMemoryRouter(
    [{ element: <Header />, path: '/:workspaceSlug/settings/:workspaceTab/*' }],
    { initialEntries: [`/acme/settings/${tab}`] },
  );

  return render(<RouterProvider router={router} />);
};

describe('mobile settings Header', () => {
  it('uses the literal personal settings path when the route has no tab param', () => {
    const router = createMemoryRouter(
      [{ element: <Header />, handle: { settingsTab: 'credits' }, path: '/settings/credits' }],
      { initialEntries: ['/settings/credits'] },
    );
    render(<RouterProvider router={router} />);

    expect(within(screen.getByRole('banner')).getByText('Credits 余额')).toBeInTheDocument();
  });

  it('gives the back button an accessible name', () => {
    renderHeader('credits');

    const button = within(screen.getByRole('banner')).getByRole('button', { name: 'back' });
    expect(button).toHaveAttribute('data-block-size', '44');
  });

  it('returns workspace settings to the same workspace', () => {
    const router = createMemoryRouter(
      [{ element: <Header />, path: '/:workspaceSlug/settings/:workspaceTab/*' }],
      { initialEntries: ['/acme/settings/general'] },
    );
    navigate.mockClear();
    render(<RouterProvider router={router} />);

    fireEvent.click(screen.getByRole('button', { name: 'back' }));
    expect(navigate).toHaveBeenCalledWith('/acme', { escape: true });
  });

  it.each([
    ['general', 'setting:workspaceSetting.tab.general'],
    ['members', 'setting:workspaceSetting.tab.members'],
    ['plans', 'subscription:tab.plans'],
    ['billing', 'Credits 明细与服务订单'],
    ['credits', 'Credits 余额'],
    ['credential', 'setting:tab.creds'],
    ['devices', 'setting:tab.devices'],
    ['oauth-apps', 'auth:tab.oauthApps'],
    ['service-model', 'setting:tab.serviceModel'],
    ['service-operations', '平台用户运营'],
  ])('resolves the workspace %s title', (tab, title) => {
    renderHeader(tab);

    expect(within(screen.getByRole('banner')).getByText(title)).toBeInTheDocument();
  });

  it('recognizes a query-selected workspace provider and titles it', () => {
    const router = createMemoryRouter(
      [{ element: <Header />, path: '/:workspaceSlug/settings/:workspaceTab/*' }],
      { initialEntries: ['/acme/settings/provider?active=provider&provider=openai'] },
    );
    render(<RouterProvider router={router} />);

    expect(within(screen.getByRole('banner')).getByText('openai')).toBeInTheDocument();
  });

  it('goes back to the workspace provider list from a query-selected provider', () => {
    const router = createMemoryRouter(
      [{ element: <Header />, path: '/:workspaceSlug/settings/:workspaceTab/*' }],
      { initialEntries: ['/acme/settings/provider?active=provider&provider=openai'] },
    );
    navigate.mockClear();
    render(<RouterProvider router={router} />);

    fireEvent.click(within(screen.getByRole('banner')).getByRole('button'));

    // Workspace-aware navigate without `escape` keeps the `/acme` prefix, so the
    // user lands on the workspace provider list instead of personal settings.
    expect(navigate).toHaveBeenCalledWith('/settings/provider');
  });
});
