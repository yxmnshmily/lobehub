import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProjectAssistantAction from './ProjectAssistantAction';

const { editor, selectorProps } = vi.hoisted(() => ({
  editor: { dispatchCommand: vi.fn(), focus: vi.fn() },
  selectorProps: vi.fn(),
}));
vi.mock('@lobehub/editor', () => ({ INSERT_MENTION_COMMAND: 'mention' }));
vi.mock('@/features/Conversation', () => ({
  useConversationStore: (selector: any) => selector({ editor }),
}));
vi.mock('@/features/ChatInput/InputEditor/useMentionCategories', () => ({
  useMentionCategories: () => [
    {
      items: [
        { label: 'display node', metadata: { id: 'designer', label: '设计师', type: 'agent' } },
        { label: 'Topic', metadata: { id: 'topic-1', type: 'topic' } },
      ],
    },
  ],
}));
vi.mock('@/features/AgentTaskManager/AgentSelectorAction', () => ({
  default: (props: any) => {
    selectorProps(props);
    return (
      <>
        <button onClick={() => props.onAgentChange('coordinator')}>项目助手</button>
        <button onClick={() => props.onAgentChange('designer')}>邀请设计师</button>
        <button onClick={() => props.onAgentChange('private-agent')}>不允许的成员</button>
      </>
    );
  },
}));

describe('ProjectAssistantAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the coordinator as project assistant and only exposes mentionable agents', () => {
    render(<ProjectAssistantAction assistantId="coordinator" />);
    expect(selectorProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        allowedAgentIds: ['coordinator', 'designer'],
        assistantId: 'coordinator',
        assistantTitle: '项目助手',
        ariaLabel: '项目助手与邀请成员',
      }),
    );
    fireEvent.click(screen.getByText('项目助手'));
    expect(editor.dispatchCommand).not.toHaveBeenCalled();
    expect(editor.focus).toHaveBeenCalledOnce();
  });

  it('invites a member using a native mention without switching the topic owner', () => {
    render(<ProjectAssistantAction assistantId="coordinator" />);
    fireEvent.click(screen.getByText('邀请设计师'));
    expect(editor.dispatchCommand).toHaveBeenCalledWith('mention', {
      label: '设计师',
      metadata: { id: 'designer', label: '设计师', type: 'agent' },
    });
    expect(editor.focus).toHaveBeenCalledOnce();
  });

  it('rejects agents absent from the existing mention visibility list', () => {
    render(<ProjectAssistantAction assistantId="coordinator" />);
    fireEvent.click(screen.getByText('不允许的成员'));
    expect(editor.dispatchCommand).not.toHaveBeenCalled();
  });
});
