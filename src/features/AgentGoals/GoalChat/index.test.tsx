import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import GoalChat from './index';

const current = vi.hoisted(() => ({ agentId: '' }));
vi.mock('./GoalChatProvider', () => ({
  GoalChatProvider: ({ agentId, goalId, initialTopicId, children }: any) => {
    current.agentId = agentId;
    return (
      <div
        data-agent={agentId}
        data-goal={goalId}
        data-testid="context"
        data-topic={initialTopicId}
      >
        {children}
      </div>
    );
  },
}));
vi.mock('@/features/Conversation', () => ({
  conversationSelectors: { agentId: () => current.agentId },
  useConversationStore: (select: any) => select({}),
  ChatList: () => null,
  ChatInput: ({ leftContent, sendAreaPrefix }: any) => (
    <div>
      {leftContent}
      {sendAreaPrefix}
    </div>
  ),
}));
vi.mock('@/components/DragUploadZone', () => ({
  default: ({ children }: any) => children,
  useUploadFiles: () => ({ handleUploadFiles: vi.fn() }),
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (select: any) => select({ useFetchAgentConfig: vi.fn() }),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentModelById: () => () => 'model',
    getAgentModelProviderById: () => () => 'provider',
  },
}));
vi.mock('./Toolbar', () => ({ default: () => null }));
vi.mock('@/features/ChatInput/ActionBar/config', () => ({
  actionMap: { search: () => <span>搜索</span> },
}));
vi.mock('@/features/PageEditor/Copilot/CopilotModelSelect', () => ({
  default: () => <span>模型选择</span>,
}));
vi.mock('@/features/AgentTaskManager/AgentSelectorAction', () => ({
  default: ({ assistantId, assistantTitle, onAgentChange }: any) => (
    <>
      <button onClick={() => onAgentChange(assistantId)}>{assistantTitle}</button>
      <button onClick={() => onAgentChange('writer')}>文案成员</button>
    </>
  ),
}));

describe('goal conversation assistant controls', () => {
  it('switches the conversation agent while retaining the goal and isolating its initial topic', () => {
    const view = render(
      <GoalChat
        agentId="owner"
        goalId="goal-one"
        initialTopicId="owner-topic"
        onCollapse={vi.fn()}
      />,
    );
    expect(screen.getByText('目标助手')).toBeInTheDocument();
    expect(screen.getByText('搜索')).toBeInTheDocument();
    expect(screen.getByText('模型选择')).toBeInTheDocument();
    fireEvent.click(screen.getByText('文案成员'));
    expect(screen.getByTestId('context')).toHaveAttribute('data-agent', 'writer');
    expect(screen.getByTestId('context')).toHaveAttribute('data-goal', 'goal-one');
    expect(screen.getByTestId('context')).not.toHaveAttribute('data-topic');
    fireEvent.click(screen.getByText('目标助手'));
    expect(screen.getByTestId('context')).toHaveAttribute('data-agent', 'owner');
    expect(screen.getByTestId('context')).toHaveAttribute('data-topic', 'owner-topic');
    fireEvent.click(screen.getByText('文案成员'));
    view.rerender(<GoalChat agentId="next-owner" goalId="goal-two" onCollapse={vi.fn()} />);
    expect(screen.getByTestId('context')).toHaveAttribute('data-agent', 'next-owner');
  });
});
