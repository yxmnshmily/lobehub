import { fireEvent, render, screen } from '@testing-library/react';
import { $getRoot, createEditor } from 'lexical';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GroupChatPresentation } from './GroupChatPresentation';
import GroupDraftQuote from './GroupDraftQuote';
import { GroupMessageQuote, GroupReplyAction, GroupSpeakingStatus } from './GroupMessageQuote';
import { appendMessageQuote } from './messageQuote';

const fixture = vi.hoisted(() => ({ state: {} as any, canUse: true }));
vi.mock('@/features/Conversation/store', () => ({
  dataSelectors: {
    getDisplayMessageById: (id: string) => (s: any) =>
      s.displayMessages.find((m: any) => m.id === id),
  },
  useConversationStore: (selector: any) => selector(fixture.state),
  useConversationStoreApi: () => ({ getState: () => fixture.state }),
}));
vi.mock('@/features/Conversation/hooks/useConversationResourceAccess', () => ({
  useConversationResourceAccess: () => ({ canUseResource: fixture.canUse }),
}));

function CurrentLocation() {
  const location = useLocation();
  return (
    <output aria-label="当前定位">
      {location.pathname}
      {location.search}
      {location.hash}
    </output>
  );
}

beforeEach(() => {
  fixture.canUse = true;
  fixture.state = {
    displayMessages: [{ id: 'msg-1', role: 'assistant', content: '先拍背影' }],
    composerTarget: { writable: true },
  };
});

describe('group quote controls', () => {
  it('announces speaking only while the existing message is loading', () => {
    const { rerender } = render(<GroupSpeakingStatus loading={false} />);
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<GroupSpeakingStatus loading />);
    expect(screen.getByRole('status')).toHaveTextContent('正在回复');
    rerender(<GroupSpeakingStatus loading={false} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('leaves non-group editors untouched', () => {
    render(<GroupDraftQuote />);
    expect(screen.queryByLabelText('正在引用')).not.toBeInTheDocument();
  });
  it('shows a cancellable draft quote without exposing its message ID', () => {
    const lexical = createEditor({ namespace: 'draft-quote-test' });
    appendMessageQuote(lexical, { id: 'msg-1', name: '编剧', excerpt: '先拍背影' });
    fixture.state.editor = {
      instance: { getLexicalEditor: () => lexical },
      getMarkdownContent: () => '',
      focus: () => {},
    };
    fixture.state.updateInputMessage = () => {};
    render(
      <MemoryRouter>
        <GroupChatPresentation.Provider value>
          <GroupDraftQuote />
        </GroupChatPresentation.Provider>
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('正在引用')).toHaveTextContent('编剧');
    expect(screen.getByLabelText('正在引用')).not.toHaveTextContent('msg-1');
    fireEvent.click(screen.getByRole('button', { name: '取消引用' }));
    expect(screen.queryByLabelText('正在引用')).not.toBeInTheDocument();
    lexical
      .getEditorState()
      .read(() => expect($getRoot().getTextContent()).not.toContain('引用消息'));
  });
  it('expands the available original text rather than only the saved excerpt', () => {
    fixture.state.displayMessages[0].content = '完整原文：第一镜先拍背影，第二镜再切到象鼻山正面。';
    render(
      <MemoryRouter>
        <GroupMessageQuote
          placement="left"
          quote={{ id: 'msg-1', name: '编剧', excerpt: '先拍背影' }}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('展开引用'));
    expect(screen.getByText('完整原文：第一镜先拍背影，第二镜再切到象鼻山正面。')).toBeVisible();
  });
  it('locates a quoted message without leaving the current topic', () => {
    render(
      <MemoryRouter initialEntries={['/group/g?topic=t']}>
        <GroupMessageQuote
          placement="right"
          quote={{ id: 'msg-1', name: '编剧', excerpt: '先拍背影' }}
        />
        <CurrentLocation />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '查看引用消息：编剧' }));
    expect(screen.getByLabelText('当前定位')).toHaveTextContent('/group/g?topic=t#msg-1');
  });

  it('does not navigate to a missing or inaccessible original', () => {
    render(
      <MemoryRouter initialEntries={['/group/g?topic=t']}>
        <GroupMessageQuote
          placement="left"
          quote={{ id: 'other', name: '编剧', excerpt: '旧消息' }}
        />
        <CurrentLocation />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '查看引用消息：编剧' }));
    expect(screen.getByLabelText('当前定位')).toHaveTextContent('/group/g?topic=t');
    expect(screen.getByLabelText('当前定位').textContent).not.toContain('#');
  });

  it('prepares a reply in the existing editor without sending it', () => {
    const lexical = createEditor({ namespace: 'quote-action-test' });
    fixture.state.editor = {
      instance: { getLexicalEditor: () => lexical },
      getMarkdownContent: () => '',
      focus: () => {},
    };
    fixture.state.updateInputMessage = () => {};
    render(<GroupReplyAction id="msg-1" name="编剧" />);
    expect(screen.getByRole('button', { name: '引用回复 编剧' })).toHaveStyle({ height: '24px' });
    fireEvent.click(screen.getByRole('button', { name: '引用回复 编剧' }));
    lexical.getEditorState().read(() => {
      expect($getRoot().getTextContent()).toContain('引用消息「编剧」〔msg-1〕：先拍背影');
    });
  });

  it.each(['view-only', 'unwritable', 'no-editor'])(
    'does not offer a send action for %s',
    (reason) => {
      fixture.state.editor = { instance: {} };
      if (reason === 'view-only') fixture.canUse = false;
      if (reason === 'unwritable') fixture.state.composerTarget.writable = false;
      if (reason === 'no-editor') fixture.state.editor = null;
      render(<GroupReplyAction id="msg-1" name="编剧" />);
      expect(screen.queryByRole('button', { name: '引用回复 编剧' })).not.toBeInTheDocument();
    },
  );
});
