import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useMemberSidebar } from './useMemberSidebar';

vi.mock('@/store/user', () => ({ useUserStore: () => true }));
vi.mock('@/store/user/selectors', () => ({ authSelectors: { isLogin: () => true } }));
vi.mock('@/store/home', () => ({
  useHomeStore: (selector: any) => selector({ useFetchAgentList: vi.fn() }),
}));
vi.mock('@/store/home/selectors', () => ({
  homeAgentListSelectors: {
    allAgents: () => [{ id: 'pinned', pinned: true }],
    agentGroups: () => [{ id: 'writing', name: '写作', items: [{ id: 'ordinary' }] }],
    privateAgentGroups: () => [{ name: '个人', items: [{ id: 'private' }] }],
  },
}));
vi.mock('@/features/HomeSidebar/Body/Agent/useSidebarItemVisibility', () => ({
  useSidebarItemVisibility: () => ({ isSidebarItemVisible: ({ id }: any) => id !== 'hidden' }),
}));

describe('member sidebar organization', () => {
  it('hides personal opt-outs, brings pinned members first and preserves the source membership', () => {
    const members = [{ id: 'ordinary' }, { id: 'hidden' }, { id: 'pinned' }, { id: 'last' }];
    const { result } = renderHook(useMemberSidebar);
    expect(result.current.arrange(members).map((member) => member.id)).toEqual([
      'pinned',
      'ordinary',
      'last',
    ]);
    expect(members.map((member) => member.id)).toEqual(['ordinary', 'hidden', 'pinned', 'last']);
    expect(result.current.category('ordinary')).toBe('写作');
    expect(result.current.category('private')).toBe('个人');
    expect(result.current.category('virtual-agent', 'writing')).toBe('写作');
    expect(
      result.current
        .arrange([{ id: 'ordinary' }, { id: 'virtual-agent', pinned: true }])
        .map((member) => member.id),
    ).toEqual(['virtual-agent', 'ordinary']);
  });
});
