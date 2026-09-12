import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CompactNavPanel, NavPanelDraggable } from './NavPanelDraggable';

const state = vi.hoisted(() => ({ expanded: false, initialized: true, width: 280 }));
vi.mock('@/store/global', () => ({
  useGlobalStore: Object.assign(
    (selector: (value: unknown) => unknown) => selector({ toggleLeftPanel: vi.fn() }),
    { getState: () => ({}) },
  ),
}));
vi.mock('@/store/global/selectors', () => ({
  NAV_PANEL_MAX_WIDTH: 400,
  NAV_PANEL_MIN_WIDTH: 240,
  systemStatusSelectors: {
    isStatusInit: () => state.initialized,
    leftPanelWidth: () => state.width,
    showLeftPanel: () => state.expanded,
  },
}));
vi.mock('../hooks/useNavPanel', () => ({ useNavPanelSizeChangeHandler: () => vi.fn() }));
vi.mock('../AccountHeader', () => ({
  default: ({ compact }: { compact: boolean }) => (
    <button>{compact ? 'Account compact' : 'Account full'}</button>
  ),
}));
vi.mock('@/features/HomeSidebar/Footer', () => ({ default: () => null }));
vi.mock('@/business/client/features/NavPanelUpgradeEntry', () => ({ default: () => null }));
vi.mock('@/features/NavPanel/ToggleLeftPanelButton', () => ({ TOGGLE_BUTTON_ID: 'toggle' }));
vi.mock('./BackButton', () => ({ BACK_BUTTON_ID: 'back' }));
// The resize widget is the browser boundary; assert the dimensions/visibility we give it.
vi.mock('@lobehub/ui', () => ({
  DraggablePanel: ({
    children,
    expand,
    size,
  }: {
    children: ReactNode;
    expand: boolean;
    size?: { width: number };
  }) => (
    <aside hidden={!expand} style={{ width: size?.width }}>
      {children}
    </aside>
  ),
}));

describe('shared navigation rail', () => {
  it('includes the account entry in the mobile navigation host', () => {
    render(
      <CompactNavPanel>
        <button>Mobile menu</button>
      </CompactNavPanel>,
    );
    expect(screen.getAllByRole('button', { name: 'Account compact' })).toHaveLength(1);
  });
  it.each([
    'home',
    'agent',
    'group',
    'image',
    'video',
    'resource',
    'settings',
    'memory',
    'discover',
    'tasks',
    'data-center',
    'apps',
  ])('keeps %s menus visible in the same narrow rail and restores the saved width', (navKey) => {
    state.expanded = false;
    const { rerender } = render(
      <NavPanelDraggable
        activeContent={{ key: navKey, node: <button>Menu</button> }}
        navKey={navKey}
      />,
    );
    expect(screen.getByRole('complementary')).toHaveStyle({ width: '64px' });
    expect(screen.getByRole('button', { name: 'Menu' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Account compact' })).toHaveLength(1);
    state.expanded = true;
    rerender(
      <NavPanelDraggable
        activeContent={{ key: navKey, node: <button>Menu</button> }}
        navKey={navKey}
      />,
    );
    expect(screen.getByRole('complementary')).toHaveStyle({ width: '280px' });
    expect(screen.getAllByRole('button', { name: 'Account full' })).toHaveLength(1);
  });
});
