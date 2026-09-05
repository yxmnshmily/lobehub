/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Header from './index';

const mocks = vi.hoisted(() => ({
  isMobile: true,
  push: vi.fn(),
  toggleMobileTopic: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  ActionIcon: ({
    'aria-label': ariaLabel,
    onClick,
    title,
  }: {
    'aria-label'?: string;
    'onClick'?: () => void;
    'title'?: string;
  }) => (
    <button aria-label={ariaLabel} type="button" onClick={onClick}>
      {title}
    </button>
  ),
}));

vi.mock('@lobehub/ui/mobile', () => ({
  ChatHeader: Object.assign(
    ({ center, left, right }: { center?: ReactNode; left?: ReactNode; right?: ReactNode }) => (
      <header>
        {left}
        {center}
        {right}
      </header>
    ),
    {
      Title: ({ title }: { title?: ReactNode }) => <h1>{title}</h1>,
    },
  ),
}));

vi.mock('@/features/AgentTransferMigration', () => ({ AgentMigrationBadge: () => null }));
vi.mock('@/features/NavHeader', () => ({ default: () => <div data-testid="desktop-header" /> }));
vi.mock('@/features/WideScreenContainer/WideScreenButton', () => ({ default: () => null }));
vi.mock('@/hooks/useQueryRoute', () => ({ useQueryRoute: () => ({ push: mocks.push }) }));
vi.mock('@/store/agentGroup', () => ({
  useAgentGroupStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      activeGroupId: 'group-1',
      groupMap: { 'group-1': { title: '旅游服务超级群组' } },
    }),
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: (
    selector: (state: { toggleMobileTopic: typeof mocks.toggleMobileTopic }) => unknown,
  ) => selector({ toggleMobileTopic: mocks.toggleMobileTopic }),
}));
vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: { isMobile: boolean }) => unknown) =>
    selector({ isMobile: mocks.isMobile }),
}));
vi.mock('./ShareButton', () => ({ default: () => null }));

describe('Group conversation header', () => {
  beforeEach(() => {
    mocks.isMobile = true;
    mocks.push.mockReset();
    mocks.toggleMobileTopic.mockReset();
  });

  it('renders a titled back button on mobile and returns to the session list', () => {
    render(<Header />);

    expect(screen.getByRole('heading', { name: '旅游服务超级群组' })).toBeInTheDocument();
    const backButton = screen.getByRole('button', { name: '返回' });
    expect(backButton).toHaveAttribute('aria-label', '返回');
    fireEvent.click(backButton);
    expect(mocks.push).toHaveBeenCalledWith('/', { replace: true });
  });

  it('opens the historical topic list from the mobile header', () => {
    render(<Header />);

    fireEvent.click(screen.getByRole('button', { name: '历史会话' }));

    expect(mocks.toggleMobileTopic).toHaveBeenCalledWith(true);
  });

  it('keeps the existing desktop header outside mobile mode', () => {
    mocks.isMobile = false;

    render(<Header />);

    expect(screen.getByTestId('desktop-header')).toBeInTheDocument();
  });
});
