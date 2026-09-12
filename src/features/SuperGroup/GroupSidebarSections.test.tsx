import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import GroupSidebarSections from './GroupSidebarSections';

const navigate = vi.hoisted(() => vi.fn());
const platform = vi.hoisted(() => ({ isDesktop: true }));
vi.mock('@/const/version', () => platform);
vi.mock('@/hooks/useActiveLocation', () => ({
  useActiveLocation: () => ({ pathname: window.location.pathname }),
}));
vi.mock('@/hooks/useQueryRoute', () => ({ useQueryRoute: () => ({ push: navigate }) }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    groupMembership: {
      listParticipants: {
        useQuery: () => ({
          data: {
            items: [],
            assistants: [
              {
                id: 'assistant-1',
                isSupervisor: true,
                title: '旅游助手',
                subtitle: '旅行规划师',
                avatar: null,
                model: 'group-model',
                provider: 'provider',
              },
            ],
            nextOffset: null,
          },
          isLoading: false,
          isError: false,
        }),
      },
    },
  },
}));
vi.mock('@/features/GroupMembership', () => ({ GroupMembersButton: () => null }));
vi.mock('@/features/GroupMembership/AssistantActions', () => ({ default: () => null }));
vi.mock('@/features/GroupMembership/DefaultGroupActions', () => ({ default: () => null }));
vi.mock('./RecentTopicLinks', () => ({ default: () => null }));
vi.mock('./GroupTaskLink', () => ({ default: () => null }));
vi.mock('./GroupWorkLinks', () => ({ default: () => null }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/features/ResourcePermission/useResourceAccess', () => ({
  useResourceAccess: () => ({ canEditResource: true, isAccessResolved: true }),
}));
vi.mock('@/store/agentGroup', () => ({ useAgentGroupStore: () => vi.fn() }));

afterEach(() => {
  window.history.replaceState({}, '', '/');
  navigate.mockClear();
  platform.isDesktop = true;
});

describe('shared group assistant navigation', () => {
  it.each([false, true])(
    'opens the shared card without navigating and shows the read-only model (management=%s)',
    async (manageDefaultGroup) => {
      window.history.replaceState({}, '', '/group/previous?topic=old-topic&tab=old-agent');
      render(<GroupSidebarSections groupId="joined" manageDefaultGroup={manageDefaultGroup} />);
      fireEvent.click(screen.getByRole('button', { name: '展开成员' }));
      expect(screen.getByText('主管')).toBeVisible();
      expect(screen.getByText('旅行规划师')).toBeVisible();
      const trigger = screen.getByRole('button', { name: '旅游助手' });
      fireEvent.click(trigger);
      await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'));
      expect(await screen.findByText('group-model')).toBeInTheDocument();
      expect(navigate).not.toHaveBeenCalled();
      expect(screen.queryByRole('combobox')).toBeNull();
    },
  );
});

it('opens the member management page without toggling the member list', () => {
  render(<GroupSidebarSections groupId="joined" />);
  fireEvent.click(screen.getByRole('button', { name: '成员', exact: true }));
  expect(navigate).toHaveBeenCalledWith('/group/joined/members');
  expect(screen.getByRole('button', { name: '展开成员' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

it.each([false, true])(
  'web members navigate directly without a dropdown (compact=%s)',
  (compact) => {
    platform.isDesktop = false;
    render(<GroupSidebarSections compact={compact} groupId="joined" />);
    expect(screen.queryByRole('button', { name: /展开成员|收起成员/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '旅游助手' })).toBeNull();
    const button = screen.getByRole('button', { name: '成员', exact: true });
    expect(button.querySelector('[data-nav-chevron]')).toBeNull();
    fireEvent.click(button);
    expect(navigate).toHaveBeenCalledWith('/group/joined/members');
  },
);
