/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { use } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GroupWorkScopeContext } from '@/features/SuperGroup/GroupWorkScope';

import Body from './Body';

const mocks = vi.hoisted(() => ({ config: {} as Record<string, unknown> }));
vi.mock('@/store/chat', () => ({ useChatStore: (select: (s: unknown) => unknown) => select({}) }));
vi.mock('@/store/chat/selectors', () => ({ chatPortalSelectors: { taskDetailId: () => 'T-1' } }));
vi.mock('@/store/task', () => ({
  useTaskStore: (select: (s: unknown) => unknown) =>
    select({ taskDetailMap: { 'T-1': { config: mocks.config } } }),
}));
vi.mock('@/features/AgentTasks', () => ({
  useActiveTaskDetail: () => ({ isInitialLoading: false, isNotFound: false }),
  TaskDetailSkeleton: () => null,
  TopicChatDrawer: () => null,
  TaskDetailSections: () => {
    const scope = use(GroupWorkScopeContext);
    return <span data-testid="scope">{scope?.groupId ?? 'personal'}</span>;
  },
}));
afterEach(cleanup);

describe('task portal group scope', () => {
  it.each<[Record<string, unknown>, string]>([
    [{ groupId: 'record-group' }, 'record-group'],
    [{}, 'personal'],
  ])('uses the actual task ownership rather than its outer group for %j', (config, expected) => {
    mocks.config = config;
    render(
      <GroupWorkScopeContext value={{ groupId: 'outer-group' }}>
        <Body />
      </GroupWorkScopeContext>,
    );
    expect(screen.getByTestId('scope').textContent).toBe(expected);
  });
});
