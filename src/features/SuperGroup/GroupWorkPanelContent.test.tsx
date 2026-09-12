import type { UIChatMessage } from '@lobechat/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import GroupWorkPanelContent from './GroupWorkPanelContent';

const state = vi.hoisted(() => ({
  displayMessages: [] as UIChatMessage[],
  messagesInit: true,
  pending: [],
}));
vi.mock('@/features/Conversation/store', () => ({
  useConversationStore: (selector: any) => selector(state),
  dataSelectors: {
    displayMessages: (s: any) => s.displayMessages,
    messagesInit: (s: any) => s.messagesInit,
    pendingInterventions: (s: any) => s.pending,
  },
}));
vi.mock('@/store/goal', () => ({ useGoalStore: () => () => ({ data: undefined }) }));
vi.mock('@/features/Conversation/InterventionBar/InterventionContent', () => ({
  default: () => null,
}));
vi.mock('@/features/Conversation/Messages', () => ({
  default: ({ id, readOnly }: { id: string; readOnly: boolean }) => (
    <div data-read-only={readOnly}>{id}</div>
  ),
}));

describe('group work panel categories', () => {
  it('offers an add action for the selected list', () => {
    const onAdd = vi.fn();
    render(<GroupWorkPanelContent initialKind="goals" onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: '添加目标' }));
    expect(onAdd).toHaveBeenLastCalledWith('goals');
    fireEvent.click(screen.getByRole('button', { name: '任务' }));
    fireEvent.click(screen.getByRole('button', { name: '添加任务' }));
    expect(onAdd).toHaveBeenLastCalledWith('tasks');
  });
  beforeEach(() => {
    state.displayMessages = [];
  });
  it('reads a standalone goal in the panel instead of rendering the navigating tool card', () => {
    state.displayMessages = [
      {
        id: 'goal-tool',
        role: 'tool',
        content: '',
        plugin: {
          identifier: 'lobe-goal',
          apiName: 'createGoal',
          type: 'builtin',
          arguments: '{}',
        },
        pluginState: { success: true, goalId: 'goal-1', name: '群目标' },
      } as UIChatMessage,
    ];
    render(<GroupWorkPanelContent initialKind="goals" />);
    expect(screen.getByText('正在读取目标进度…')).toBeInTheDocument();
    expect(screen.queryByText('goal-tool')).not.toBeInTheDocument();
  });
  it.each(['done', 'rejected'])('renders standalone tool records after %s', (status) => {
    state.displayMessages = [
      {
        id: `tool-${status}`,
        role: 'tool',
        content: status,
        plugin: {
          identifier: 'lobe-group-management',
          apiName: 'executeAgentTask',
          type: 'builtin',
        },
      } as UIChatMessage,
    ];
    render(<GroupWorkPanelContent initialKind="tasks" />);
    expect(screen.getByText(`tool-${status}`)).toHaveAttribute('data-read-only', 'true');
  });
  it('starts with the requested category and switches without navigating or creating work', () => {
    render(<GroupWorkPanelContent initialKind="tasks" />);
    expect(screen.getByText('当前话题暂无任务记录')).toBeInTheDocument();
    expect(screen.queryByText('当前话题暂无目标记录')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '目标' }));
    expect(screen.getByText('当前话题暂无目标记录')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '目标' })).toHaveAttribute('aria-pressed', 'true');
  });
});
