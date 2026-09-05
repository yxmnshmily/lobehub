/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import DefaultMode from './DefaultMode';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'defaultList': '默认列表',
        'pin': '置顶',
        'topic.recent': '最近话题',
      })[key] || key,
  }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => null,
}));
vi.mock('@/hooks/useFetchSessions', () => ({ useFetchSessions: vi.fn() }));
vi.mock('@/libs/swr', () => ({
  useClientDataSWR: () => ({
    data: [
      {
        agentId: 'agent-1',
        icon: 'topic',
        id: 'topic-1',
        routePath: '/agent/agent-1/topic-1',
        status: null,
        title: '西藏行程讨论',
        type: 'topic',
        updatedAt: new Date('2026-09-05T00:00:00.000Z'),
      },
    ],
  }),
}));
vi.mock('@/libs/swr/useCacheScope', () => ({ useCacheScope: () => 'personal' }));
vi.mock('@/services/recent', () => ({
  recentService: { getAll: vi.fn() },
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: { updateSystemStatus: () => void }) => unknown) =>
    selector({ updateSystemStatus: vi.fn() }),
}));
vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: { sessionGroupKeys: () => () => [] },
}));
vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: { isMobile: boolean }) => unknown) =>
    selector({ isMobile: true }),
}));
vi.mock('@/store/serverConfig/selectors', () => ({
  serverConfigSelectors: { isMobile: (state: { isMobile: boolean }) => state.isMobile },
}));
vi.mock('@/store/session', () => ({
  useSessionStore: (selector: (state: object) => unknown) => selector({}),
}));
vi.mock('@/store/session/selectors', () => ({
  sessionSelectors: {
    customSessionGroups: () => [],
    defaultSessions: () => [],
    pinnedSessions: () => [],
  },
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { isLogin: boolean }) => unknown) => selector({ isLogin: true }),
}));
vi.mock('@/store/user/selectors', () => ({
  authSelectors: { isLogin: (state: { isLogin: boolean }) => state.isLogin },
}));
vi.mock('@/features/Workspace/WorkspaceLink', () => ({
  default: ({ children, to }: { children?: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock('@/features/Home/Recents/Item', () => ({
  default: ({ title }: { title: string }) => <span>{title}</span>,
}));
vi.mock('./CollapseGroup', () => ({
  default: ({
    items,
  }: {
    items?: Array<{ children?: ReactNode; key: string; label?: ReactNode }>;
  }) => (
    <div>
      {items?.map((item) => (
        <section key={item.key}>
          <h2>{item.label}</h2>
          {item.children}
        </section>
      ))}
    </div>
  ),
}));
vi.mock('./CollapseGroup/Actions', () => ({ default: () => null }));
vi.mock('./Inbox', () => ({ default: () => null }));
vi.mock('./List', () => ({ default: () => null }));
vi.mock('./Modals/ConfigGroupModal', () => ({ default: () => null }));
vi.mock('./Modals/RenameGroupModal', () => ({ openRenameGroupModal: vi.fn() }));

describe('mobile home recent topics', () => {
  it('shows a direct link back to each recent topic', () => {
    render(<DefaultMode />);

    expect(screen.getByRole('heading', { name: '最近话题' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '西藏行程讨论' })).toHaveAttribute(
      'href',
      '/agent/agent-1/topic-1',
    );
  });
});
