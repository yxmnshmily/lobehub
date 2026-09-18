import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TravelPromptShortcuts from '.';

const state = vi.hoisted(() => ({
  fillInputMessage: vi.fn(),
  inputMessage: '',
  editor: { setDocument: vi.fn(), getJSONState: vi.fn() },
  updateInputMessage: vi.fn(),
}));
const api = { getState: () => state };
vi.mock('@/features/Conversation/store', () => ({
  useConversationStore: (selector: any) => selector(state),
  useConversationStoreApi: () => api,
}));

/*
 * 2026-09-18 用户定稿：提示词固定为口播文案（talk-copy）组——"线路讲解 / 客户答疑 /
 * 领队故事 / 纯玩说明"，不随 copyCategory、URL 参数或页面变化。以下断言全部按该口径。
 */
describe('TravelPromptShortcuts', () => {
  it('renders the fixed talk-copy shortcuts without any copyCategory', () => {
    render(<TravelPromptShortcuts />);

    expect(screen.getByRole('button', { name: '线路讲解' })).toBeVisible();
    expect(screen.getByRole('button', { name: '客户答疑' })).toBeVisible();
  });
  it('opens the list outside the composer so its overflow cannot clip the prompts', () => {
    const { container } = render(<TravelPromptShortcuts />);
    fireEvent.click(screen.getByRole('button', { name: '线路讲解' }));
    const panel = screen.getByRole('region', { name: '线路讲解提示词' });
    expect(container.contains(panel)).toBe(false);
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
  it('closes on outside press but leaves panel interactions open', () => {
    render(<TravelPromptShortcuts />);
    fireEvent.click(screen.getByRole('button', { name: '线路讲解' }));
    fireEvent.pointerDown(screen.getByRole('region'));
    expect(screen.getByRole('region')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
  beforeEach(() => {
    state.inputMessage = '';
    state.fillInputMessage.mockReset();
    state.editor.setDocument.mockReset();
    state.updateInputMessage.mockImplementation((text) => {
      state.inputMessage = text;
    });
  });

  it('previews on hover without moving focus, and restores on leave', () => {
    render(<TravelPromptShortcuts />);
    fireEvent.click(screen.getByRole('button', { name: '线路讲解' }));
    const prompt = screen.getByRole('button', { name: '讲清多日核心路线' });
    fireEvent.mouseEnter(prompt);
    expect(state.editor.setDocument).toHaveBeenCalledWith(
      'text',
      expect.stringContaining('按天讲清路线'),
      {
        keepHistory: true,
      },
    );
    expect(state.fillInputMessage).not.toHaveBeenCalled();
    fireEvent.mouseLeave(prompt);
    expect(state.inputMessage).toBe('');
  });

  it('expands a category, fills a prompt without sending, and closes the list', () => {
    render(<TravelPromptShortcuts />);
    fireEvent.click(screen.getByRole('button', { name: '线路讲解' }));
    fireEvent.click(screen.getByRole('button', { name: '讲清多日核心路线' }));
    expect(state.fillInputMessage).toHaveBeenCalledWith(expect.stringContaining('按天讲清路线'));
    expect(screen.queryByRole('button', { name: '关闭提示词' })).not.toBeInTheDocument();
  });

  it('switches prompt groups and supports closing', () => {
    render(<TravelPromptShortcuts />);
    fireEvent.click(screen.getByRole('button', { name: '线路讲解' }));
    fireEvent.click(screen.getByRole('button', { name: '客户答疑' }));
    expect(screen.getByRole('button', { name: '回答什么时候最合适' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭提示词' }));
    expect(screen.queryByRole('button', { name: '回答什么时候最合适' })).not.toBeInTheDocument();
  });

  it.each([[undefined], ['mix-copy'], ['talk-copy'], ['other-copy']])(
    'shows the fixed talk-copy groups regardless of copyCategory (%s)',
    (slug) => {
      render(<TravelPromptShortcuts {...(slug ? { copyCategory: slug } : {})} />);

      for (const title of ['线路讲解', '客户答疑', '领队故事', '纯玩说明'])
        expect(screen.getByRole('button', { name: title })).toBeVisible();
      expect(screen.queryByRole('button', { name: '行程混剪' })).not.toBeInTheDocument();
    },
  );

  it('opens the selected group with several relevant prompts', () => {
    render(<TravelPromptShortcuts />);

    fireEvent.click(screen.getByRole('button', { name: '线路讲解' }));

    expect(screen.getByRole('region', { name: '线路讲解提示词' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '讲清多日核心路线' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '写第一次来怎么走' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '把详细行程说自然' })).toBeInTheDocument();
  });

  it('keeps switching previews even with a draft, then restores its rich content', () => {
    state.inputMessage = '我的草稿';
    const json = { root: { children: [{ text: '我的草稿' }] } };
    state.editor.getJSONState.mockReturnValue(json);
    render(<TravelPromptShortcuts />);
    fireEvent.click(screen.getByRole('button', { name: '线路讲解' }));
    const first = screen.getByRole('button', { name: '讲清多日核心路线' });
    const second = screen.getByRole('button', { name: '写第一次来怎么走' });
    expect(first).toBeEnabled();
    fireEvent.mouseEnter(first);
    expect(state.inputMessage).toContain('按天讲清路线');
    fireEvent.mouseLeave(first);
    fireEvent.mouseEnter(second);
    expect(state.inputMessage).toContain('第一次到访者');
    fireEvent.mouseLeave(second);
    expect(state.inputMessage).toBe('我的草稿');
    expect(state.editor.setDocument).toHaveBeenLastCalledWith('json', json, { keepHistory: true });
    expect(state.fillInputMessage).not.toHaveBeenCalled();
  });
});
