// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import MeSettingsPage from './index';
import Layout from './layout';

const openAppearance = vi.hoisted(() => vi.fn());

vi.mock('./features/Header', () => ({ default: () => <header>设置</header> }));
vi.mock('./features/useCategory', () => ({
  SettingsGroupKey: { Developer: 'developer', General: 'general' },
  useCategory: () => [
    {
      items: [{ key: 'appearance', label: '外观', onClick: openAppearance }],
      key: 'general',
      title: '通用',
    },
    {
      items: [{ key: 'advanced', label: '高级工具', onClick: vi.fn() }],
      key: 'developer',
      title: '高级设置',
    },
  ],
}));
vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, onClick, onKeyDown, role, tabIndex }: any) => (
    <div role={role} tabIndex={tabIndex} onClick={onClick} onKeyDown={onKeyDown}>
      {children}
    </div>
  ),
  Icon: () => <svg aria-hidden="true" />,
}));

describe('mobile settings entry layout', () => {
  it('uses the grouped settings list as the navigation home without duplicate bars', () => {
    const router = createMemoryRouter(
      [
        {
          children: [{ element: <MeSettingsPage />, index: true }],
          element: <Layout />,
          path: '/me/settings',
        },
      ],
      { initialEntries: ['/me/settings'] },
    );
    const { container } = render(<RouterProvider router={router} />);

    expect(container.querySelector('[data-mobile-settings-layout="b"]')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '当前设置栏目' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '设置主栏目' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '高级工具' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '外观' }));
    expect(openAppearance).toHaveBeenCalledOnce();
  });
});
