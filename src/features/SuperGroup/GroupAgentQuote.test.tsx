import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GroupAgentQuote, useGroupMessageContent } from './GroupAgentQuote';
import { GroupChatPresentation } from './GroupChatPresentation';

const fixture = vi.hoisted(() => ({ messages: [] as any[] }));
vi.mock('@/features/Conversation/store', () => ({
  dataSelectors: {
    getDbMessageById: (id: string) => (s: any) => s.dbMessages.find((m: any) => m.id === id),
  },
  useConversationStore: (selector: any) =>
    selector({ dbMessages: fixture.messages, displayMessages: fixture.messages }),
  useConversationStoreApi: () => ({ getState: () => ({ displayMessages: fixture.messages }) }),
}));
vi.mock('@/features/Conversation/hooks/useAgentMeta', () => ({
  useAgentMeta: (id: string) => ({ name: id === 'writer' ? '文案A' : '检查B' }),
}));
vi.mock('@/features/Conversation/hooks/useConversationResourceAccess', () => ({
  useConversationResourceAccess: () => ({ canUseResource: true }),
}));

function Reply({ group = true }: { group?: boolean }) {
  return (
    <MemoryRouter>
      <GroupChatPresentation.Provider value={group}>
        <Body />
      </GroupChatPresentation.Provider>
    </MemoryRouter>
  );
}
function Body() {
  const reply = useGroupMessageContent(fixture.messages[1].content);
  return (
    <>
      <p>{reply.content}</p>
      <GroupAgentQuote id="msg_B" referenceId={reply.referenceId} />
    </>
  );
}

beforeEach(() => {
  fixture.messages = [
    {
      id: 'msg_A',
      role: 'assistant',
      agentId: 'writer',
      groupId: 'group',
      topicId: 'topic',
      content: '好的，文案完毕了请检查；' + '详细文案。'.repeat(80),
    },
    {
      id: 'msg_B',
      role: 'assistant',
      agentId: 'reviewer',
      groupId: 'group',
      topicId: 'topic',
      content: '<group_reply ref="msg%5FA" />\n我来检查你的文案',
    },
  ];
});

describe('agent-to-agent quote cards', () => {
  it('renders A’s actual author/text below B, truncates and expands the original', () => {
    render(<Reply />);
    expect(screen.getByText('我来检查你的文案')).toBeVisible();
    const quote = screen.getByRole('button', { name: '查看引用消息：文案A' });
    expect(quote.textContent).toContain('好的，文案完毕了请检查；');
    expect(quote.textContent).toMatch(/…$/);
    expect(quote.textContent!.length).toBeLessThan(250);
    expect(document.body.textContent).not.toContain('msg_A');
    expect(document.body.textContent).not.toContain('group_reply');
    fireEvent.click(screen.getByText('展开引用'));
    expect(screen.getByText(fixture.messages[0].content)).toBeVisible();
  });

  it('retains the relationship when persisted messages are rehydrated', () => {
    // Exercise serialized history, not an in-memory clone.
    // eslint-disable-next-line unicorn/prefer-structured-clone
    fixture.messages = JSON.parse(JSON.stringify(fixture.messages));
    render(<Reply />);
    expect(screen.getByRole('button', { name: '查看引用消息：文案A' })).toBeVisible();
  });

  it.each(['groupId', 'topicId'])('does not resolve an original from a different %s', (field) => {
    fixture.messages[0][field] = 'other';
    render(<Reply />);
    expect(screen.queryByRole('button', { name: /查看引用消息/ })).toBeNull();
    expect(screen.getByText('引用的原消息不在当前记录中')).toBeVisible();
    expect(document.body.textContent).not.toContain('详细文案');
  });

  it('does not claim a tool result is another agent’s reply', () => {
    fixture.messages[0].role = 'tool';
    render(<Reply />);
    expect(screen.queryByRole('button', { name: /查看引用消息/ })).toBeNull();
  });

  it('does not parse or alter private chat content', () => {
    const { container } = render(<Reply group={false} />);
    expect(container.querySelector('p')?.textContent).toBe(fixture.messages[1].content);
    expect(screen.queryByRole('button', { name: /查看引用消息/ })).toBeNull();
  });

  it('does not create a self-reference', () => {
    fixture.messages[1].content = '<group_reply ref="msg%5FB" />\n我来检查';
    render(<Reply />);
    expect(screen.queryByRole('button', { name: /查看引用消息/ })).toBeNull();
  });

  it('silently omits a quote of the same agent’s earlier message while continuing work', () => {
    fixture.messages[1].agentId = 'writer';
    fixture.messages[1].content = '<group_reply ref="msg%5FA" />\n我继续完善这条文案';
    render(<Reply />);
    expect(screen.getByText('我继续完善这条文案')).toBeVisible();
    expect(screen.queryByRole('button', { name: /查看引用消息/ })).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('does not automatically quote the previous member when posting a standalone update', () => {
    fixture.messages[1].content = '我继续完成自己的任务';
    render(<Reply />);
    expect(screen.getByText('我继续完成自己的任务')).toBeVisible();
    expect(screen.queryByRole('button', { name: /查看引用消息/ })).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('degrades safely when the referenced message has been deleted', () => {
    fixture.messages[0].id = 'unrelated';
    render(<Reply />);
    expect(screen.getByText('引用的原消息不在当前记录中')).toBeVisible();
    expect(screen.getByText('我来检查你的文案')).toBeVisible();
  });
});
