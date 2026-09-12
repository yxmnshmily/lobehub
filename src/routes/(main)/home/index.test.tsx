import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Home from './index';

const readiness = vi.hoisted(() => ({
  groupId: undefined as string | undefined,
  isEnabled: true,
  isRetrying: false,
  retry: vi.fn(),
  status: 'preparing' as string | undefined,
}));
vi.mock('@/hooks/useMyTravelGroupReadiness', () => ({
  useMyTravelGroupReadiness: () => readiness,
}));
vi.mock('@/components/Analytics/HomePageTracker', () => ({ default: () => null }));
vi.mock('@/features/Home', () => ({ default: () => <div>原首页</div> }));
vi.mock('@/features/Home/HomeNavHeader', () => ({ default: () => null }));
vi.mock('@/features/Home/CustomizeModal/useHomeCustomization', () => ({
  useHomeMinimalLayout: () => false,
}));

const renderHome = () =>
  render(
    <MemoryRouter initialEntries={['/home']}>
      <Routes>
        <Route element={<Home />} path="/home" />
        <Route element={<div>我的超级工作群页面</div>} path="/group/cg_mine" />
      </Routes>
    </MemoryRouter>,
  );

describe('personal home entry', () => {
  beforeEach(() => {
    Object.assign(readiness, {
      groupId: undefined,
      isEnabled: true,
      isRetrying: false,
      status: 'preparing',
    });
  });

  it('opens the current user’s ready super group instead of the dashboard', () => {
    Object.assign(readiness, { groupId: 'cg_mine', status: 'ready' });
    renderHome();
    expect(screen.getByText('我的超级工作群页面')).toBeTruthy();
    expect(screen.queryByText('原首页')).toBeNull();
  });

  it('shows preparation status without flashing the dashboard', () => {
    renderHome();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByText('原首页')).toBeNull();
  });

  it('keeps a retry available when preparation fails', () => {
    readiness.status = 'retryable_error';
    renderHome();
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  });

  it('preserves the dashboard outside the personal workspace', () => {
    readiness.isEnabled = false;
    renderHome();
    expect(screen.getByText('原首页')).toBeTruthy();
  });
});
