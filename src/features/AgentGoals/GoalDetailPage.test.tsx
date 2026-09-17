import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

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
vi.mock('./NorthStarMetrics', () => ({ default: () => null }));
vi.mock('./GoalSupervision', () => ({ GoalSupervision: () => null }));
vi.mock('./ProcessControl', () => ({
  default: ({
    graphFullscreen,
    onGraphFullscreenChange,
  }: {
    graphFullscreen: boolean;
    onGraphFullscreenChange: (value: boolean) => void;
  }) => <button onClick={() => onGraphFullscreenChange(!graphFullscreen)}>切换画布全屏</button>,
}));
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
  it.each([true, false])(
    'restores sidebar preference %s after fullscreen and unmount',
    (expanded) => {
      useGlobalStore.setState({ isStatusInit: true });
      useGlobalStore.getState().toggleLeftPanel(expanded);
      const view = render(
        <MemoryRouter>
          <GoalDetailPage agentId="a1" goalId="g1" />
        </MemoryRouter>,
      );
      const isExpanded = () => systemStatusSelectors.showLeftPanel(useGlobalStore.getState());
      fireEvent.click(screen.getByRole('button', { name: '切换画布全屏' }));
      expect(isExpanded()).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: '切换画布全屏' }));
      expect(isExpanded()).toBe(expanded);
      fireEvent.click(screen.getByRole('button', { name: '切换画布全屏' }));
      view.unmount();
      expect(isExpanded()).toBe(expanded);
    },
  );
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
