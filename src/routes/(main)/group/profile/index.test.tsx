/** @vitest-environment happy-dom */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import GroupProfile from './index';

vi.mock('@/store/agentGroup', () => ({
  useAgentGroupStore: (selector: any) => selector({}),
}));
vi.mock('@/store/agentGroup/selectors', () => ({
  agentGroupSelectors: {
    getGroupById: () => () => ({
      id: 'group-1',
      clientId: 'default-travel-service-group',
      workspaceId: null,
      title: '测试工作群',
      description: '旅游内容协作',
      agents: [],
    }),
    isGroupsInit: () => false,
    getGroupAgents: () => () => [],
  },
}));
vi.mock('./features/AgentBuilder', () => ({ default: () => null }));
vi.mock('./features/GroupProfile', () => ({ default: () => <h1>测试工作群</h1> }));
vi.mock('./features/Header', () => ({ default: () => null }));
vi.mock('./features/MemberProfile', () => ({ default: () => null }));
vi.mock('./StoreSync', () => ({ default: () => null }));
vi.mock('@/features/PlatformAdminRouteGuard', () => ({ default: ({ children }: any) => children }));
vi.mock('@/features/ResourcePermission/ResourceConfigAccessGate', () => ({
  default: ({ children }: any) => children,
}));
vi.mock('@/store/groupProfile', () => ({
  useGroupProfileStore: (selector: any) => selector({ activeTabId: 'group' }),
}));
vi.mock('@/features/GroupMembership', () => ({ GroupMembersButton: () => null }));
vi.mock('@/features/GroupMembership/DefaultGroupActions', () => ({ default: () => null }));

describe('default group profile route', () => {
  it('shows the group profile instead of sending the user back to chat', () => {
    render(
      <MemoryRouter initialEntries={['/group/group-1/profile']}>
        <Routes>
          <Route element={<GroupProfile />} path="/group/:gid/profile" />
          <Route element={<div>chat destination</div>} path="/group/:gid" />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('测试工作群')).toBeInTheDocument();
    expect(screen.queryByText('chat destination')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
