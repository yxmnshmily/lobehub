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
 * 2026-09-18 用户定稿：一排 6 个提示词组（旅游文案、图文笔记、海报设计、详情页设计、
 * 直播间贴片、账号分析），每组 6 条、恒定显示。面板条目显示主核心短描述。
 */
const GROUP_TITLES = ['旅游文案', '图文笔记', '海报设计', '详情页设计', '直播间贴片', '账号分析'];

describe('TravelPromptShortcuts', () => {
  it('renders the six fixed prompt groups in a single row', () => {
    render(<TravelPromptShortcuts />);

    for (const title of GROUP_TITLES)
      expect(screen.getByRole('button', { name: new RegExp(title) })).toBeVisible();
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

  it('opens a group panel with six core-titled prompts', () => {
    render(<TravelPromptShortcuts />);
    fireEvent.click(screen.getByRole('button', { name: /旅游文案/ }));
    const panel = screen.getByRole('region', { name: '旅游文案提示词' });
    // Popover 自带 portal：面板不在组件容器内，不会被输入区 overflow 裁切。
    expect(panel.closest('body')).not.toBeNull();
    // 主核心短描述：不是"旅游文案 1"式序号。
    expect(screen.getByRole('button', { name: '混剪种草文案' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '对比转化文案' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '旅游文案 1' })).not.toBeInTheDocument();
  });

  it('fills a prompt without sending, and closes the panel', () => {
    render(<TravelPromptShortcuts />);
    fireEvent.click(screen.getByRole('button', { name: /旅游文案/ }));
    fireEvent.click(screen.getByRole('button', { name: '混剪种草文案' }));
    expect(state.fillInputMessage).toHaveBeenCalledWith(expect.stringContaining('节奏卡点'));
    expect(screen.queryByRole('button', { name: '关闭提示词' })).not.toBeInTheDocument();
  });

  it('switches prompt groups and supports closing', () => {
    render(<TravelPromptShortcuts />);
    fireEvent.click(screen.getByRole('button', { name: /旅游文案/ }));
    fireEvent.click(screen.getByRole('button', { name: /账号分析/ }));
    expect(screen.getByRole('button', { name: '抖音账号诊断' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭提示词' }));
    expect(screen.queryByRole('button', { name: '抖音账号诊断' })).not.toBeInTheDocument();
  });
});
