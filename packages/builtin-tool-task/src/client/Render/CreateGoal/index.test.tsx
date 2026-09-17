/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CreateGoalRender from './index';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  snapshot: {
    decisions: [],
    goal: {
      agentId: 'coordinator',
      config: {} as Record<string, unknown>,
      status: 'achieved',
      title: 'Campaign',
    },
  },
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));
vi.mock('@/store/goal', () => ({
  goalSelectors: { goalGraph: () => () => mocks.snapshot },
  useGoalStore: (selector: (state: unknown) => unknown) => selector({ useFetchGoalGraph: vi.fn() }),
}));
vi.mock('../shared', () => ({
  TaskResultCard: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

afterEach(() => {
  cleanup();
  mocks.navigate.mockClear();
});

describe('CreateGoal card navigation', () => {
  it.each<[Record<string, unknown>, string]>([
    [{ groupId: 'travel' }, '/group/travel/goal/goal-one'],
    [{}, '/agent/coordinator/goal/goal-one'],
  ])('uses actual goal ownership for %j', (config, path) => {
    mocks.snapshot.goal.config = config;
    render(
      <CreateGoalRender
        args={{ criteria: [], instruction: 'Create the campaign', name: 'Campaign' }}
        content=""
        messageId="message-one"
        pluginState={{ success: true, goalId: 'goal-one' }}
      />,
    );
    fireEvent.click(screen.getByText('builtins.lobe-task.goal.phase.accepted'));
    expect(mocks.navigate).toHaveBeenCalledWith(path);
  });
});
