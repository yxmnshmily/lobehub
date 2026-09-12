import { describe, expect, it } from 'vitest';

import { SidebarTabKey } from '@/store/global/initialState';

import { resolveActiveTabKey } from './useActiveTabKey';

describe('resolveActiveTabKey', () => {
  it.each([
    ['/community/skill', SidebarTabKey.Community],
    ['/travel-team/community/skill', SidebarTabKey.Community],
    ['/me', SidebarTabKey.Me],
  ])('resolves %s to %s', (pathname, expected) => {
    expect(resolveActiveTabKey(pathname)).toBe(expected);
  });

  it('keeps the home fallback for the root path', () => {
    expect(resolveActiveTabKey('/')).toBe(SidebarTabKey.Home);
  });
});
