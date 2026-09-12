// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MobileNavPanelProvider } from './MobileNavPanel';
import { NavPanelPortal } from './NavPanelPortal';
import { clearNavPanelRegistry } from './registry';
import SideBarHeaderLayout from './SideBarHeaderLayout';
import ToggleLeftPanelButton from './ToggleLeftPanelButton';

vi.mock('@lobehub/ui/base-ui', () => ({
  ActionIcon: ({
    active: _active,
    'aria-label': ariaLabel,
    icon: _icon,
    size: _size,
    title,
    tooltipProps: _tooltipProps,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    active?: boolean;
    icon?: unknown;
    size?: unknown;
    tooltipProps?: unknown;
  }) => <button {...props} aria-label={ariaLabel || String(title)} type="button" />,
  Drawer: ({
    children,
    noHeader,
    open,
    width,
  }: {
    children?: ReactNode;
    noHeader?: boolean;
    open?: boolean;
    width?: number;
  }) => (
    <aside
      aria-label="手机侧栏"
      data-no-header={String(noHeader)}
      data-width={width}
      hidden={!open}
    >
      {children}
    </aside>
  ),
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('antd-style', () => ({
  createStaticStyles: (factory: (input: Record<string, unknown>) => unknown) =>
    factory({
      css: () => 'mock-style',
      cssVar: {
        colorText: '#111',
        colorTextDescription: '#666',
      },
    }),
  cssVar: {
    colorBgContainer: '#fff',
    colorBorderSecondary: '#ddd',
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/const/version', () => ({ isDesktop: false }));
vi.mock('@/utils/platform', () => ({ isMacOS: () => false }));
vi.mock('@/features/NavPanel/useActiveNavKey', () => ({ useActiveNavKey: () => 'resource' }));
vi.mock('@/hooks/useActiveLocation', () => ({
  useActiveLocation: () => ({ pathname: '/resource', search: '' }),
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: unknown) => unknown) =>
    selector({ status: { showLeftPanel: false }, toggleLeftPanel: vi.fn() }),
}));
vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    showLeftPanel: (state: { status: { showLeftPanel: boolean } }) => state.status.showLeftPanel,
  },
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/user/selectors', () => ({
  settingsSelectors: { getHotkeyById: () => () => [] },
}));

describe('MobileNavPanelProvider', () => {
  beforeEach(() => clearNavPanelRegistry());

  it('opens the registered route sidebar as the same narrow left drawer used by mobile home', async () => {
    render(
      <MobileNavPanelProvider>
        <NavPanelPortal navKey="resource">
          <div>
            <SideBarHeaderLayout left="文件管理" />
            <nav aria-label="文件管理侧栏">资源库</nav>
          </div>
        </NavPanelPortal>
        <ToggleLeftPanelButton id={null} />
      </MobileNavPanelProvider>,
    );

    const drawer = await screen.findByLabelText('手机侧栏');
    expect(drawer).not.toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'toggleLeftPanel.title' }));

    await waitFor(() => expect(drawer).toBeVisible());
    expect(drawer).toHaveAttribute('data-no-header', 'true');
    expect(drawer).toHaveAttribute('data-width', '260');
    expect(screen.getByRole('navigation', { name: '文件管理侧栏' })).toBeVisible();
  });

  it('offers a visible close action and closes the shared mobile drawer', async () => {
    render(
      <MobileNavPanelProvider>
        <NavPanelPortal navKey="resource">
          <div>
            <SideBarHeaderLayout left="文件管理" />
            <nav aria-label="文件管理侧栏">资源库</nav>
          </div>
        </NavPanelPortal>
        <ToggleLeftPanelButton id={null} />
      </MobileNavPanelProvider>,
    );

    const drawer = await screen.findByLabelText('手机侧栏');
    fireEvent.click(screen.getByRole('button', { name: 'toggleLeftPanel.title' }));
    await waitFor(() => expect(drawer).toBeVisible());

    const closeButton = screen.getByRole('button', { name: 'close' });
    expect(closeButton).toHaveAttribute('data-mobile-nav-close');
    expect(closeButton.closest('[data-nav-header]')).toBeNull();
    expect(closeButton).toHaveStyle({
      insetBlockStart: 'max(8px, env(safe-area-inset-top))',
      insetInlineEnd: '8px',
      position: 'absolute',
    });
    expect(closeButton).toHaveTextContent('');

    fireEvent.click(closeButton);

    await waitFor(() => expect(drawer).not.toBeVisible());
  });
});
