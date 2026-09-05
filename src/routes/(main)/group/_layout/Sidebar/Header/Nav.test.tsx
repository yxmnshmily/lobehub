/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Nav from './Nav';

const mocks = vi.hoisted(() => ({
  clientId: 'default-travel-service-group' as string | null,
  isPlatformAdmin: false,
  push: vi.fn(),
  switchToNewTopic: vi.fn(),
  switchTopic: vi.fn(),
  toggleCommandMenu: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({ title }: { title: string }) => <button>{title}</button>,
}));

vi.mock('@/features/ResourcePermission/useResourceAccess', () => ({
  useResourceAccess: () => ({ canEditResource: true, isAccessResolved: true }),
}));

vi.mock('@/hooks/useActiveLocation', () => ({
  useActiveLocation: () => ({ pathname: '/group/group-1' }),
}));

vi.mock('@/hooks/useActiveRouteParams', () => ({
  useActiveRouteParams: () => ({ gid: 'group-1' }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true }),
}));

vi.mock('@/hooks/useQueryRoute', () => ({ useQueryRoute: () => ({ push: mocks.push }) }));

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
      groupMap: {
        'group-1': { clientId: mocks.clientId, id: 'group-1' },
      },
      switchToNewTopic: mocks.switchToNewTopic,
    }),
}));

vi.mock('@/store/agentGroup/selectors', () => ({
  agentGroupSelectors: {
    getGroupById:
      (groupId: string) =>
      (state: { groupMap: Record<string, { clientId: string | null }> }) =>
        state.groupMap[groupId],
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: { switchTopic: typeof vi.fn }) => unknown) =>
    selector({ switchTopic: mocks.switchTopic }),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: { toggleCommandMenu: typeof vi.fn }) => unknown) =>
    selector({ toggleCommandMenu: mocks.toggleCommandMenu }),
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: vi.fn(),
  useServerConfigStore: () => ({ isAgentEditable: true }),
}));

describe('group navigation management policy', () => {
  beforeEach(() => {
    mocks.clientId = 'default-travel-service-group';
    mocks.isPlatformAdmin = false;
  });

  it('hides the profile entry for an ordinary user in a platform-managed group', () => {
    render(<Nav />);

    expect(screen.queryByRole('button', { name: 'tab.groupProfile' })).not.toBeInTheDocument();
  });

  it('keeps the profile entry for an ordinary user-created group', () => {
    mocks.clientId = null;
    render(<Nav />);

    expect(screen.getByRole('button', { name: 'tab.groupProfile' })).toBeInTheDocument();
  });

  it('keeps the profile entry for a super admin in a platform-managed group', () => {
    mocks.isPlatformAdmin = true;
    render(<Nav />);

    expect(screen.getByRole('button', { name: 'tab.groupProfile' })).toBeInTheDocument();
  });
});
