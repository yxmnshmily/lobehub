import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { CustomerCenterMobileMenu } from '@/features/CustomerCenter/Navigation';
import MemorySidebarContent from '@/routes/(main)/memory/_layout/Sidebar/Content';

import SidebarContent from './SidebarContent';

vi.mock('@/utils/i18n/travel', () => ({
  translateTravel: (text: string) => text,
  useTravelTranslation: () => (text: string) => text,
}));

vi.mock('./Body', () => ({ default: () => <div>设置菜单</div> }));
vi.mock('./Header', () => ({ default: () => <div>设置标题</div> }));
vi.mock('@/features/NavPanel/SideBarHeaderLayout', () => ({
  default: () => <div>个人中心标题</div>,
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', async () => {
  const { useNavigate } = await import('react-router');
  return { useWorkspaceAwareNavigate: useNavigate };
});
vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({ title }: { title: string }) => <span>{title}</span>,
}));

describe('personal center sidebar', () => {
  it.each(['', '/identities', '/contexts', '/preferences', '/experiences', '/activities'])(
    'keeps personal navigation and the memory selection on /memory%s',
    (suffix) => {
      render(
        <MemoryRouter initialEntries={[`/memory${suffix}`]}>
          <MemorySidebarContent />
        </MemoryRouter>,
      );
      expect(screen.getByRole('navigation', { name: '个人中心菜单' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: '我的记忆' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(screen.getByRole('link', { name: '费用套餐' })).toBeInTheDocument();
    },
  );
  it('opens the mobile left menu and navigates to a personal section', async () => {
    render(
      <MemoryRouter initialEntries={['/settings/profile']}>
        <CustomerCenterMobileMenu />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('navigation', { name: '个人中心菜单' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开个人中心菜单' }));
    expect(await screen.findByRole('navigation', { name: '个人中心菜单' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: '我的生成' }));
    expect(screen.getByRole('button', { name: '展开个人中心菜单' })).toBeInTheDocument();
  });
  it('keeps the memory entry available in the mobile personal menu', async () => {
    const LocationProbe = () => <output aria-label="current path">{useLocation().pathname}</output>;

    render(
      <MemoryRouter initialEntries={['/settings/profile']}>
        <CustomerCenterMobileMenu />
        <LocationProbe />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开个人中心菜单' }));
    const memoryLink = await screen.findByRole('link', { name: '我的记忆' });

    expect(memoryLink).toHaveAttribute('href', '/memory');
    fireEvent.click(memoryLink);
    expect(screen.getByRole('status', { name: 'current path' })).toHaveTextContent('/memory');
  });
  it('replaces settings with personal links and follows navigation', () => {
    render(
      <MemoryRouter initialEntries={['/settings/profile']}>
        <SidebarContent />
      </MemoryRouter>,
    );
    expect(screen.queryByText('设置菜单')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '个人中心菜单' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '我的记忆' })).toHaveAttribute('href', '/memory');
    fireEvent.click(screen.getByRole('link', { name: '我的生成' }));
    expect(screen.getByRole('link', { name: '我的生成' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('link', { name: '费用套餐' }));
    expect(screen.getByRole('link', { name: '费用套餐' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('设置菜单')).not.toBeInTheDocument();
  });

  it('retains normal settings outside personal center', () => {
    render(
      <MemoryRouter initialEntries={['/settings/appearance']}>
        <SidebarContent />
      </MemoryRouter>,
    );
    expect(screen.getByText('设置菜单')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '个人中心菜单' })).not.toBeInTheDocument();
  });
});
