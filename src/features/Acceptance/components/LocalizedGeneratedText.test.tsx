import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import LocalizedGeneratedText from './LocalizedGeneratedText';

const state = vi.hoisted(() => ({ language: 'zh-CN', fetch: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: state.language } }),
}));
vi.mock('@/libs/better-auth/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'test' } } }),
}));
vi.mock('@/services/chat', () => ({ chatService: { fetchPresetTaskResult: state.fetch } }));
vi.mock('@/store/user', () => ({ useUserStore: { getState: () => ({}) } }));
vi.mock('@/store/user/selectors', () => ({
  systemAgentSelectors: { translation: () => ({ model: 'model', provider: 'provider' }) },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.language = 'zh-CN';
});
it('translates old English reasoning and restores the original on English switch', async () => {
  const text =
    'The original verification evidence does not establish that the image can be viewed.';
  state.fetch.mockImplementation(async ({ onFinish }) =>
    onFinish('原始验证证据不足以确认图片可以查看。'),
  );
  const view = render(<LocalizedGeneratedText text={text} />);
  expect(await screen.findByText('原始验证证据不足以确认图片可以查看。')).toBeInTheDocument();
  expect(state.fetch).toHaveBeenCalledTimes(1);
  state.language = 'en-US';
  view.rerender(<LocalizedGeneratedText text={text} />);
  expect(screen.getByText(text)).toBeInTheDocument();
  expect(state.fetch).toHaveBeenCalledTimes(1);
});
it('keeps Chinese text without a model request', () => {
  render(<LocalizedGeneratedText text="证据完整，检查通过。" />);
  expect(screen.getByText('证据完整，检查通过。')).toBeInTheDocument();
  expect(state.fetch).not.toHaveBeenCalled();
});
it('retains original evidence on translation failure', async () => {
  state.fetch.mockImplementation(async ({ onError }) => onError(new Error('offline')));
  render(
    <LocalizedGeneratedText text="A different original statement with enough English words for translation." />,
  );
  expect(await screen.findByText(/翻译暂时失败，原文/)).toBeInTheDocument();
});
