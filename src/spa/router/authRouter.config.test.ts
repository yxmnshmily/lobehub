import { render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { authRoutes, useAuthErrorCopy } from './authRouter.config';

vi.mock('@/components/Loading/BrandTextLoading', () => ({ default: () => null }));
vi.mock('@/features/AuthShell', () => ({ default: () => null }));
vi.mock('@/utils/chunkError', () => ({
  isChunkLoadError: () => false,
  notifyChunkError: vi.fn(),
}));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }));
vi.mock('react-router', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('react-router')),
  useRouteError: () => new Error('route failed'),
}));

afterEach(() => {
  document.cookie = 'LOBE_LOCALE=; Max-Age=0; path=/';
  localStorage.removeItem('LOBE_SYSTEM_STATUS');
  document.documentElement.lang = '';
  window.history.replaceState({}, '', '/');
});

describe('useAuthErrorCopy', () => {
  it('loads the persisted Simplified Chinese copy outside AuthShell', async () => {
    document.cookie = 'LOBE_LOCALE=zh-CN; path=/';
    document.documentElement.lang = 'en-US';

    const { result } = renderHook(() => useAuthErrorCopy());

    await waitFor(() =>
      expect(result.current).toEqual({
        retry: '重新加载',
        signIn: '重新登录',
        title: '页面暂时不可用',
      }),
    );
  });

  it('returns to sign-in inside the active LobeHub mount', async () => {
    document.cookie = 'LOBE_LOCALE=zh-CN; path=/';
    window.history.replaceState({}, '', '/lobehub/signin');
    const rootRoute = authRoutes.find((route) => route.path === '/');

    render(rootRoute?.errorElement as ReactElement);

    expect(await screen.findByRole('link', { name: '重新登录' })).toHaveAttribute(
      'href',
      '/lobehub/signin',
    );
  });
});
