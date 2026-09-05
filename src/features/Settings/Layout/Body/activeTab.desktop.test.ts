/**
 * @vitest-environment happy-dom
 */
import { act, render, screen } from '@testing-library/react';
import { createElement as h, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useElectronStore } from '@/store/electron';

import { isSettingsCategoryItemActive } from './index';

// The settings sidebar is portal'd into the shell (frozen root router on
// desktop). This binds `@/hooks/useActiveLocation` to the real desktop variant,
// which mirrors the active tab's url from the electron store, and asserts the
// sidebar's active-tab highlight follows a store-driven tab switch — the
// Critical-2 regression (raw useLocation would freeze at the boot url).
vi.mock('@/hooks/useActiveLocation', async () => await import('@/hooks/useActiveLocation.desktop'));

vi.mock('../../hooks/useCategory', () => ({
  SettingsGroupKey: { General: 'general' },
  useCategory: () => [
    {
      items: [
        { icon: () => null, key: 'profile', label: 'Profile' },
        { icon: () => null, key: 'appearance', label: 'Appearance' },
      ],
      key: 'general',
      title: 'General',
    },
  ],
}));

vi.mock('@/features/SettingsSearch', () => ({
  getTabUrl: (tab: string) => `/settings/${tab}`,
  SearchSection: ({ children }: { children?: ReactNode }) => h('div', null, children),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({ active, title }: { active?: boolean; title: ReactNode }) =>
    h('button', { 'data-active': String(!!active), 'type': 'button' }, title),
}));

vi.mock('react-router', () => ({
  Link: ({ children }: { children?: ReactNode }) => h('span', null, children),
}));

vi.mock('@lobehub/ui', () => ({
  Accordion: ({
    children,
    defaultExpandedKeys,
  }: {
    children?: ReactNode;
    defaultExpandedKeys?: string[];
  }) => h('div', { 'data-expanded-keys': defaultExpandedKeys?.join(',') }, children),
  AccordionItem: ({ children, title }: { children?: ReactNode; title?: ReactNode }) =>
    h('div', null, title, children),
  Flexbox: ({ children }: { children?: ReactNode }) => h('div', null, children),
  Text: ({ children }: { children?: ReactNode }) => h('span', null, children),
}));

const tab = (id: string, url: string) => ({ id, lastVisited: 0, url });

const activeStateOf = (label: string) =>
  screen.getByText(label).closest('button')?.getAttribute('data-active');

afterEach(() => {
  useElectronStore.setState({ activeTabId: null, tabs: [] });
});

describe('settings sidebar active tab (desktop)', () => {
  it('prefers a matching section link over the shared credits pathname', () => {
    const location = {
      pathname: '/settings/credits',
      search: '?section=my-creations&generationId=task-1',
    };

    expect(
      isSettingsCategoryItemActive({
        activeTab: 'credits',
        currentLocation: location,
        hasCustomHrefMatch: true,
        item: { href: '/settings/credits?section=my-creations', key: 'works' },
      }),
    ).toBe(true);
    expect(
      isSettingsCategoryItemActive({
        activeTab: 'credits',
        currentLocation: location,
        hasCustomHrefMatch: true,
        item: { key: 'credits' },
      }),
    ).toBe(false);
  });

  it('follows the active tab url via the electron store mirror', async () => {
    useElectronStore.setState({
      activeTabId: 't1',
      tabs: [tab('t1', '/settings/profile'), tab('t2', '/settings/appearance')],
    });

    const { default: Body } = await import('./index');
    render(h(Body));

    expect(activeStateOf('Profile')).toBe('true');
    expect(activeStateOf('Appearance')).toBe('false');
    expect(
      screen
        .getByText('General')
        .closest('[data-expanded-keys]')
        ?.getAttribute('data-expanded-keys'),
    ).toBe('general');

    act(() => useElectronStore.setState({ activeTabId: 't2' }));

    expect(activeStateOf('Profile')).toBe('false');
    expect(activeStateOf('Appearance')).toBe('true');
  });
});
