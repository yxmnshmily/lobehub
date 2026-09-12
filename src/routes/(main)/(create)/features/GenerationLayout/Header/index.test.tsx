/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import Header from './index';

const mocks = vi.hoisted(() => ({
  closeMobilePanel: vi.fn(),
  navigate: vi.fn(),
  openNewGenerationTopic: vi.fn(),
  toggleCommandMenu: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/config/routes', () => ({
  getRouteById: () => ({ icon: () => null }),
}));

vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({ onClick, title }: { onClick?: () => void; title: string }) => (
    <button type="button" onClick={onClick}>
      {title}
    </button>
  ),
}));

vi.mock('@/features/NavPanel/SideBarHeaderLayout', () => ({ default: () => null }));
vi.mock('@/features/NavPanel/MobileNavPanel', () => ({
  useMobileNavPanelController: () => ({
    close: mocks.closeMobilePanel,
    open: true,
    toggle: vi.fn(),
  }),
}));
vi.mock('@/features/Workspace/WorkspaceLink', () => ({
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));
vi.mock('@/hooks/useActiveLocation', () => ({
  useActiveLocation: () => ({ pathname: '/image' }),
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: (
    selector: (state: { toggleCommandMenu: typeof mocks.toggleCommandMenu }) => any,
  ) => selector({ toggleCommandMenu: mocks.toggleCommandMenu }),
}));

describe('GenerationLayoutHeader', () => {
  it('closes the mobile navigation drawer before opening search', () => {
    const storeHook = (selector: (state: { openNewGenerationTopic: () => void }) => unknown) =>
      selector({ openNewGenerationTopic: mocks.openNewGenerationTopic });

    render(
      <Header
        breadcrumb={[]}
        generationTopicsSelector={() => []}
        namespace="image"
        navKey="image"
        useStore={storeHook}
        viewModeStatusKey="imageTopicViewMode"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'tab.search' }));

    expect(mocks.closeMobilePanel).toHaveBeenCalledOnce();
    expect(mocks.toggleCommandMenu).toHaveBeenCalledWith(true);
    expect(mocks.closeMobilePanel.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.toggleCommandMenu.mock.invocationCallOrder[0],
    );
  });
});
