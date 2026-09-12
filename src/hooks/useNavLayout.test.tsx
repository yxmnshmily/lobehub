import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface GlobalStateMock {
  toggleCommandMenu: () => void;
}

const mocks = vi.hoisted(() => ({
  activeWorkspaceSlug: null as string | null,
  showMarket: true,
}));

vi.mock('@/config/routes', () => ({
  getRouteById: (id: string) => ({
    icon: () => id,
  }),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: GlobalStateMock) => unknown) =>
    selector({ toggleCommandMenu: vi.fn() }),
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: {},
  useServerConfigStore: () => ({
    hideGitHub: false,
    showMarket: mocks.showMarket,
  }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => mocks.activeWorkspaceSlug,
}));

describe('useNavLayout', () => {
  beforeEach(() => {
    mocks.activeWorkspaceSlug = null;
    mocks.showMarket = true;
  });

  it('hides community and memory from the personal sidebar', async () => {
    const { useNavLayout } = await import('./useNavLayout');
    const { result } = renderHook(() => useNavLayout());

    const memoryItem = result.current.bottomMenuItems.find((item) => item.key === 'memory');

    expect(memoryItem?.hidden).toBe(true);
    expect(result.current.bottomMenuItems.find((item) => item.key === 'community')?.hidden).toBe(
      true,
    );
    expect(result.current.bottomMenuItems.find((item) => item.key === 'pages')?.hidden).toBe(true);
  });

  it('hides Memory in workspace mode', async () => {
    mocks.activeWorkspaceSlug = 'lobe-team';

    const { useNavLayout } = await import('./useNavLayout');
    const { result } = renderHook(() => useNavLayout());

    const memoryItem = result.current.bottomMenuItems.find((item) => item.key === 'memory');

    expect(memoryItem?.hidden).toBe(true);
  });
});
