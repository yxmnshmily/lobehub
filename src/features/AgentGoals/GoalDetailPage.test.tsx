import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import GoalDetailPage from './GoalDetailPage';

const state = vi.hoisted(() => ({
  clearPortalStack: vi.fn(),
  openGoalMetric: vi.fn(),
  pauseGoal: vi.fn(),
  resumeGoal: vi.fn(),
  useFetchGoalGraph: vi.fn(() => ({ isLoading: false })),
}));
vi.mock('@/store/goal', () => ({
  useGoalStore: (selector: (s: unknown) => unknown) => selector(state),
  goalSelectors: {
    goalGraph: () => () => ({
      goal: { id: 'g1', title: '目标', status: 'running', maxRounds: null, maxTotalCost: null },
      nodes: [],
    }),
  },
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) => selector(state),
}));
vi.mock('@/store/chat/selectors', () => ({
  chatPortalSelectors: { showPortal: () => false, currentViewType: () => undefined },
}));
vi.mock('@/features/CustomerCenter/useMonthlyExchangeRate', () => ({
  useMonthlyExchangeRate: () => ({ format: String }),
}));
vi.mock('@/features/Portal/usePortalPanelWidth', () => ({
  usePortalPanelWidth: () => ({ width: 400, minWidth: 320, maxWidth: 800, updateWidth: vi.fn() }),
}));
vi.mock('@/features/Portal/router', () => ({ PortalContent: () => null }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/features/AgentBreadcrumb', () => ({ default: () => null }));
vi.mock('./GoalDetailActions', () => ({ default: () => null }));
vi.mock('./GoalRequirement', () => ({ default: () => null }));
vi.mock('./ProcessControl', () => ({ default: () => null }));
vi.mock('@/features/RightPanel', () => ({
  default: ({ children, expand }: { children: ReactNode; expand: boolean }) => (
    <div hidden={!expand}>{children}</div>
  ),
}));
// The chat editor is outside this test: exercise the collapse callback it owns.
vi.mock('./GoalChat', () => ({
  default: ({ onCollapse }: { onCollapse: () => void }) => (
    <button onClick={onCollapse}>收起对话</button>
  ),
}));

describe('goal chat collapse recovery', () => {
  it('offers a working reopen control after each collapse', () => {
    render(
      <MemoryRouter>
        <GoalDetailPage agentId="a1" goalId="g1" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: '展开对话' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '收起对话' }));
    fireEvent.click(screen.getByRole('button', { name: '展开对话' }));
    expect(screen.queryByRole('button', { name: '展开对话' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '收起对话' }));
    expect(screen.getByRole('button', { name: '展开对话' })).toBeVisible();
  });
  it('does not offer an empty chat when the goal has no responsible agent', () => {
    render(
      <MemoryRouter>
        <GoalDetailPage goalId="g1" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: '展开对话' })).not.toBeInTheDocument();
  });
});
