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

describe('TravelPromptShortcuts', () => {
  it('does not render outside a copywriting case embed', () => {
    render(<TravelPromptShortcuts />);

    expect(screen.queryByTestId('travel-prompt-banner')).not.toBeInTheDocument();
  });
  it('opens the list outside the composer so its overflow cannot clip the prompts', () => {
    const { container } = render(<TravelPromptShortcuts copyCategory="mix-copy" />);
    fireEvent.click(screen.getByRole('button', { name: '行程混剪' }));
    const panel = screen.getByRole('region', { name: '行程混剪提示词' });
    expect(container.contains(panel)).toBe(false);
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
  it('closes on outside press but leaves panel interactions open', () => {
    render(<TravelPromptShortcuts copyCategory="mix-copy" />);
    fireEvent.click(screen.getByRole('button', { name: '行程混剪' }));
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
    render(<TravelPromptShortcuts copyCategory="mix-copy" />);
    fireEvent.click(screen.getByRole('button', { name: '行程混剪' }));
    const prompt = screen.getByRole('button', { name: '把案例路线改成混剪脚本' });
    fireEvent.mouseEnter(prompt);
    expect(state.editor.setDocument).toHaveBeenCalledWith('text', expect.stringContaining('逐镜'), {
      keepHistory: true,
    });
    expect(state.fillInputMessage).not.toHaveBeenCalled();
    fireEvent.mouseLeave(prompt);
    expect(state.inputMessage).toBe('');
  });

  it('expands a category, fills a prompt without sending, and closes the list', () => {
    render(<TravelPromptShortcuts copyCategory="mix-copy" />);
    fireEvent.click(screen.getByRole('button', { name: '行程混剪' }));
    fireEvent.click(screen.getByRole('button', { name: '把案例路线改成混剪脚本' }));
    expect(state.fillInputMessage).toHaveBeenCalledWith(expect.stringContaining('逐镜'));
    expect(screen.queryByRole('button', { name: '关闭提示词' })).not.toBeInTheDocument();
  });

  it('switches prompt groups and supports closing', () => {
    render(<TravelPromptShortcuts copyCategory="mix-copy" />);
    fireEvent.click(screen.getByRole('button', { name: '行程混剪' }));
    fireEvent.click(screen.getByRole('button', { name: '家庭客群' }));
    expect(screen.getByRole('button', { name: '写亲子游混剪旁白' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭提示词' }));
    expect(screen.queryByRole('button', { name: '写亲子游混剪旁白' })).not.toBeInTheDocument();
  });

  it.each([
    ['mix-copy', ['行程混剪', '家庭客群', '当季种草', '攻略避坑']],
    ['talk-copy', ['线路讲解', '客户答疑', '领队故事', '纯玩说明']],
    ['ip-copy', ['导游人设', '专业观点', '实用攻略', '从业故事']],
    ['ad-copy', ['当季推广', '价格套餐', '品质小团', '家庭客群']],
    ['brand-copy', ['定制服务', '领队接待', '地域专长', '品牌信任']],
    ['other-copy', ['省钱路线', '避坑清单', '美食体验', '旅行推广']],
  ])('shows four case-derived prompt groups for %s', (slug, titles) => {
    render(<TravelPromptShortcuts copyCategory={slug} />);

    for (const title of titles) expect(screen.getByRole('button', { name: title })).toBeVisible();
    expect(screen.getAllByRole('button')).toHaveLength(4);
  });

  it('opens the selected case-derived group with several relevant prompts', () => {
    render(<TravelPromptShortcuts copyCategory="mix-copy" />);

    fireEvent.click(screen.getByRole('button', { name: '行程混剪' }));

    expect(screen.getByRole('region', { name: '行程混剪提示词' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '把案例路线改成混剪脚本' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '按天数拆分镜头节奏' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提炼路线亮点旁白' })).toBeInTheDocument();
  });

  it('keeps switching previews even with a draft, then restores its rich content', () => {
    state.inputMessage = '我的草稿';
    const json = { root: { children: [{ text: '我的草稿' }] } };
    state.editor.getJSONState.mockReturnValue(json);
    render(<TravelPromptShortcuts copyCategory="mix-copy" />);
    fireEvent.click(screen.getByRole('button', { name: '行程混剪' }));
    const first = screen.getByRole('button', { name: '把案例路线改成混剪脚本' });
    const second = screen.getByRole('button', { name: '按天数拆分镜头节奏' });
    expect(first).toBeEnabled();
    fireEvent.mouseEnter(first);
    expect(state.inputMessage).toContain('逐镜');
    fireEvent.mouseLeave(first);
    fireEvent.mouseEnter(second);
    expect(state.inputMessage).toContain('按天数');
    fireEvent.mouseLeave(second);
    expect(state.inputMessage).toBe('我的草稿');
    expect(state.editor.setDocument).toHaveBeenLastCalledWith('json', json, { keepHistory: true });
    expect(state.fillInputMessage).not.toHaveBeenCalled();
  });
});
