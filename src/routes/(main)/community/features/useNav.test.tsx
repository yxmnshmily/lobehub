import { renderHook } from '@testing-library/react';
import { type PropsWithChildren } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { DiscoverTab } from '@/types/discover';

import { getCommunityCategoryPath, useNav } from './useNav';

vi.mock('@lobehub/icons', () => ({ MCP: () => <span /> }));
vi.mock('@lobehub/ui', () => ({ Icon: () => <span /> }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const wrapperFor = (pathname: string) => {
  const Wrapper = ({ children }: PropsWithChildren) => (
    <MemoryRouter initialEntries={[pathname]}>{children}</MemoryRouter>
  );
  return Wrapper;
};

describe('community useNav', () => {
  it.each([
    [DiscoverTab.Home, '/community'],
    [DiscoverTab.Assistants, '/community/agent'],
    [DiscoverTab.Skills, '/community/skill'],
  ])('maps %s to the shared category route', (key, expected) => {
    expect(getCommunityCategoryPath(key)).toBe(expected);
  });

  it('exposes one complete category list for desktop, mobile tabs, and the mobile drawer', () => {
    const { result } = renderHook(() => useNav(), { wrapper: wrapperFor('/community') });

    expect(result.current.navItems.map((item) => item.key)).toEqual([
      DiscoverTab.Home,
      DiscoverTab.Assistants,
      DiscoverTab.Skills,
      DiscoverTab.Mcp,
      DiscoverTab.Models,
      DiscoverTab.Providers,
    ]);
  });

  it.each([
    ['/community/skill', DiscoverTab.Skills],
    ['/travel/community/provider', DiscoverTab.Providers],
    ['/community/plugin/example', DiscoverTab.Mcp],
  ])('resolves %s to the matching category', (pathname, expected) => {
    const { result } = renderHook(() => useNav(), { wrapper: wrapperFor(pathname) });

    expect(result.current.activeKey).toBe(expected);
    expect(result.current.activeItem?.key).toBe(expected);
  });
});
