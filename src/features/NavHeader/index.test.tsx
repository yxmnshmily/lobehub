import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';

import NavHeader from './index';

const state = vi.hoisted(() => ({ expanded: true }));
vi.mock('@/store/global', () => ({ useGlobalStore: () => state.expanded }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('@/features/NavPanel/ToggleLeftPanelButton', () => ({
  isMacDesktop: false,
  default: () => <button aria-label="切换侧栏" />,
}));

describe('persistent sidebar control', () => {
  it('uses the shared mobile page gutter while preserving the desktop fallback', () => {
    const { container } = render(<NavHeader>内容</NavHeader>);

    expect(container.firstElementChild?.getAttribute('style')).toContain(
      'var(--mobile-page-gutter, 8px)',
    );
  });

  it('lets all three header slots shrink without pushing the page wider', () => {
    const { container } = render(
      <NavHeader
        left={<span>很长的面包屑内容</span>}
        right={<button>页面操作</button>}
        slotClassNames={{ center: 'center-slot', left: 'left-slot', right: 'right-slot' }}
      >
        很长的页面标题
      </NavHeader>,
    );

    expect(container.querySelector('.left-slot')).toHaveStyle({ minWidth: 0 });
    expect(container.querySelector('.center-slot')).toHaveStyle({ minWidth: 0 });
    expect(container.querySelector('.right-slot')).toHaveStyle({ minWidth: 0 });
  });

  it('renders only the content-side toggle when both headers are present', () => {
    render(
      <>
        <SideBarHeaderLayout />
        <NavHeader>内容</NavHeader>
      </>,
    );
    expect(screen.getAllByRole('button', { name: '切换侧栏' })).toHaveLength(1);
  });

  it('keeps the toggle available when the sidebar expands or collapses', () => {
    const { rerender } = render(<NavHeader>群聊</NavHeader>);
    expect(screen.getByRole('button', { name: '切换侧栏' })).toBeVisible();
    state.expanded = false;
    rerender(<NavHeader>群聊</NavHeader>);
    expect(screen.getByRole('button', { name: '切换侧栏' })).toBeVisible();
  });
});
