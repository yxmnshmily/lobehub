/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Members from './index';

const mocks = vi.hoisted(() => ({
  clientId: 'default-travel-service-group' as string | null,
  isPlatformAdmin: false,
}));

vi.mock('@lobehub/ui', () => ({
  AccordionItem: ({
    action,
    children,
    title,
  }: {
    action: ReactNode;
    children: ReactNode;
    title: ReactNode;
  }) => (
    <section>
      {title}
      {action}
      {children}
    </section>
  ),
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  ActionIcon: ({ title }: { title?: string }) => <button>{title}</button>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/ResourcePermission/useResourceAccess', () => ({
  useResourceAccess: () => ({ canEditResource: true }),
}));

vi.mock('@/hooks/useInitGroupConfig', () => ({
  useInitGroupConfig: () => ({ isRevalidating: false }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true, reason: 'forbidden' }),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    platformAccess: {
      isPlatformAdmin: {
        useQuery: () => ({ data: mocks.isPlatformAdmin }),
      },
    },
  },
}));

vi.mock('@/store/agentGroup', () => ({
  useAgentGroupStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      activeGroupId: 'group-1',
      groupMap: {
        'group-1': { clientId: mocks.clientId, id: 'group-1' },
      },
    }),
}));

vi.mock('@/store/agentGroup/selectors', () => ({
  agentGroupSelectors: {
    activeGroupId: (state: { activeGroupId: string }) => state.activeGroupId,
    getGroupAgentCount: () => () => 3,
    getGroupById:
      (groupId: string) => (state: { groupMap: Record<string, { clientId: string | null }> }) =>
        state.groupMap[groupId],
    getGroupMemberCount: () => () => 2,
  },
}));

vi.mock('../GroupConfig/GroupMember', () => ({
  default: ({ canManage }: { canManage?: boolean }) => (
    <div data-can-manage={String(canManage)} data-testid="group-member" />
  ),
}));

vi.mock('../GroupConfig/SortMembersModal', () => ({ default: () => null }));
vi.mock('@/business/client/BusinessSettingPages/SuperGroupTemplateSection', () => ({
  default: () => null,
}));

describe('group member management policy', () => {
  beforeEach(() => {
    mocks.clientId = 'default-travel-service-group';
    mocks.isPlatformAdmin = false;
  });

  it('hides member-management controls for an ordinary user in a platform-managed group', () => {
    render(<Members itemKey="members" />);

    expect(
      screen.queryByRole('button', { name: 'groupSidebar.members.addMember' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'groupSidebar.members.sortMember' }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('group-member')).toHaveAttribute('data-can-manage', 'false');
  });

  it('keeps member-management controls for an ordinary user-created group', () => {
    mocks.clientId = null;
    render(<Members itemKey="members" />);

    expect(
      screen.getByRole('button', { name: 'groupSidebar.members.addMember' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'groupSidebar.members.sortMember' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('group-member')).toHaveAttribute('data-can-manage', 'true');
  });

  it('shows global member actions for a platform admin without enabling local writes', () => {
    mocks.isPlatformAdmin = true;
    render(<Members itemKey="members" />);

    expect(screen.getByRole('button', { name: '添加成员' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '成员排序' })).toBeInTheDocument();
    expect(screen.getByTestId('group-member')).toHaveAttribute('data-can-manage', 'false');
    expect(
      screen.queryByText('默认群成员由管理员在群成员面板统一管理，并同步到所有用户的默认群。'),
    ).not.toBeInTheDocument();
  });
});
