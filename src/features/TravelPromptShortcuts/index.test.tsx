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
 * 2026-09-18 用户定稿：提示词为 6 个固定大块（旅游文案、图文笔记、海报设计、
 * 详情页设计、直播间贴片、账号分析），每块 6 条提示词，不依赖任何参数或条件。
 */
const BLOCK_TITLES = ['旅游文案', '图文笔记', '海报设计', '详情页设计', '直播间贴片', '账号分析'];

describe('TravelPromptShortcuts', () => {
  it('renders the six fixed prompt blocks unconditionally', () => {
    render(<TravelPromptShortcuts />);

    for (const title of BLOCK_TITLES)
      expect(screen.getByRole('button', { name: new RegExp(title) })).toBeVisible();
  });

  it('opens the block panel outside the composer so overflow cannot clip it', () => {
    const { container } = render(<TravelPromptShortcuts />);
    fireEvent.click(screen.getByRole('button', { name: /旅游文案/ }));
    const panel = screen.getByRole('region', { name: '旅游文案提示词' });
    expect(container.contains(panel)).toBe(false);
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('closes on outside press but leaves panel interactions open', () => {
    render(<TravelPromptShortcuts />);
    fireEvent.click(screen.getByRole('button', { name: /旅游文案/ }));
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
    fireEvent.click(screen.getByRole('button', { name: /旅游文案/ }));
    const prompt = screen.getByRole('button', { name: /旅游混剪短视频文案/ });
    fireEvent.mouseEnter(prompt);
    expect(state.editor.setDocument).toHaveBeenCalledWith(
      'text',
      expect.stringContaining('节奏卡点'),
      { keepHistory: true },
    );
    expect(state.fillInputMessage).not.toHaveBeenCalled();
    fireEvent.mouseLeave(prompt);
    expect(state.inputMessage).toBe('');
  });

  it('fills a prompt without sending, and closes the panel', () => {
    render(<TravelPromptShortcuts />);
    fireEvent.click(screen.getByRole('button', { name: /旅游文案/ }));
    fireEvent.click(screen.getByRole('button', { name: /旅游混剪短视频文案/ }));
    expect(state.fillInputMessage).toHaveBeenCalledWith(expect.stringContaining('节奏卡点'));
    expect(screen.queryByRole('button', { name: '关闭提示词' })).not.toBeInTheDocument();
  });

  it('switches blocks and supports closing', () => {
    render(<TravelPromptShortcuts />);
    fireEvent.click(screen.getByRole('button', { name: /旅游文案/ }));
    fireEvent.click(screen.getByRole('button', { name: /账号分析/ }));
    expect(screen.getByRole('button', { name: /抖音账号诊断/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭提示词' }));
    expect(screen.queryByRole('button', { name: /抖音账号诊断/ })).not.toBeInTheDocument();
  });

  it('shows six prompts inside an opened block', () => {
    render(<TravelPromptShortcuts />);
    fireEvent.click(screen.getByRole('button', { name: /图文笔记/ }));
    const prompts = screen.getAllByRole('button', { name: /请参考图文笔记案例栏目/ });
    expect(prompts).toHaveLength(6);
  });
});
