import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import GroupIdSync from './GroupIdSync';

const state = vi.hoisted(() => ({
  params: { gid: 'g1', projectId: undefined as string | undefined },
  chat: vi.fn(),
  group: vi.fn(),
}));
vi.mock('@lobechat/const', () => ({ isDesktop: false }));
vi.mock('react-router', () => ({ useParams: () => state.params }));
vi.mock('@/hooks/useQueryRoute', () => ({ useQueryRoute: () => undefined }));
vi.mock('@/store/electron', () => ({ useElectronStore: () => undefined }));
vi.mock('@/store/agentGroup', () => ({
  useAgentGroupStore: { setState: state.group, getState: () => ({}) },
}));
vi.mock('@/store/chat', () => ({ useChatStore: { setState: state.chat, getState: () => ({}) } }));

describe('group project chat isolation', () => {
  it('keeps the outer group navigation but clears the group message scope inside a project and restores it on return', () => {
    state.params = { gid: 'g1', projectId: 'p1' };
    const { rerender } = render(<GroupIdSync />);
    expect(state.group).toHaveBeenLastCalledWith({ activeGroupId: 'g1', router: undefined });
    expect(state.chat).toHaveBeenLastCalledWith({ activeGroupId: undefined });
    state.params = { gid: 'g1', projectId: undefined };
    rerender(<GroupIdSync />);
    expect(state.chat).toHaveBeenLastCalledWith({ activeGroupId: 'g1' });
  });
});
