// @vitest-environment happy-dom
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearNavPanelRegistry, getNavPanelRegistrySnapshot } from '@/features/NavPanel/registry';

import MobileSettingsWrapper from './index';

beforeEach(() => {
  vi.clearAllMocks();
  clearNavPanelRegistry();
});

vi.mock('@/features/Settings/Layout/SidebarContent', () => ({
  default: () => <nav aria-label="个人中心侧栏" />,
}));

vi.mock('./Header', () => ({ default: () => <header>设置</header> }));

vi.mock('@/components/server/MobileNavLayout', () => ({
  default: ({ children, header }: { children?: React.ReactNode; header?: React.ReactNode }) => (
    <main>
      {header}
      {children}
    </main>
  ),
}));

vi.mock('@/features/Settings/Layout/ContextProvider', () => ({
  default: ({ children }: { children?: React.ReactNode }) => children,
}));

vi.mock('@/routes/(mobile)/me/settings/features/useCategory', () => ({
  SettingsGroupKey: {
    Agent: 'agent',
    Developer: 'developer',
    General: 'general',
    Operations: 'operations',
    System: 'system',
  },
  useCategory: () => [
    {
      items: [
        { key: 'appearance', label: '外观' },
        { key: 'devices', label: '设备' },
        { key: 'hotkey', label: '快捷键' },
        { key: 'notification', label: '通知' },
      ],
      key: 'general',
      title: '通用设置',
    },
    {
      items: [{ key: 'provider', label: 'AI 服务商' }],
      key: 'agent',
      title: 'AI智能体',
    },
    { items: [{ key: 'about', label: '关于' }], key: 'system', title: '系统' },
    {
      items: [
        { key: 'advanced', label: '高级工具' },
        { href: '/settings/credential', key: 'creds', label: '凭证管理' },
      ],
      key: 'developer',
      title: '高级设置',
    },
    {
      items: [{ key: 'service-operations', label: '账户管理' }],
      key: 'operations',
      title: '用户管理',
    },
  ],
}));

describe('mobile personal settings layout', () => {
  it('registers the existing settings sidebar for the shared mobile drawer', async () => {
    render(
      <MemoryRouter initialEntries={['/settings/profile']}>
        <MobileSettingsWrapper />
      </MemoryRouter>,
    );

    await waitFor(() => expect(getNavPanelRegistrySnapshot().has('settings')).toBe(true));
  });

  it.each([
    '/settings/appearance',
    '/settings/devices',
    '/settings/hotkey',
    '/settings/notification',
    '/settings/profile',
    '/settings/security',
    '/settings/plans',
    '/settings/usage',
    '/settings/credits',
    '/settings/billing',
    '/settings/stats',
  ])('keeps every personal settings detail free of duplicate navigation bars: %s', (pathname) => {
    render(
      <MemoryRouter initialEntries={[pathname]}>
        <MobileSettingsWrapper />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('navigation', { name: '当前设置栏目' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '设置主栏目' })).not.toBeInTheDocument();
  });

  it('leaves workspace settings on their existing mobile layout', () => {
    render(
      <MemoryRouter initialEntries={['/acme/settings/general']}>
        <MobileSettingsWrapper />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('navigation', { name: '当前设置栏目' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '设置主栏目' })).not.toBeInTheDocument();
  });

});
