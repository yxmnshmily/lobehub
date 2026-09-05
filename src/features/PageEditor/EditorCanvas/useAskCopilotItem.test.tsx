/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ComposerTarget } from '@/features/Conversation/types';

import { useAskCopilotItem } from './useAskCopilotItem';

const mocks = vi.hoisted(() => ({
  addSelectionContext: vi.fn(),
  pageState: {
    documentId: 'page-a',
    setRightPanelMode: vi.fn(),
  },
  togglePageAgentPanel: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobechat/const', () => ({ DEFAULT_INBOX_AVATAR: 'avatar' }));
vi.mock('@lobechat/utils', () => ({ nanoid: () => 'selection-id' }));
vi.mock('@lobehub/editor', () => ({ HIDE_TOOLBAR_COMMAND: Symbol('hide-toolbar') }));
vi.mock('@lobehub/ui', () => ({ Block: () => null }));
vi.mock('@lobehub/ui/base-ui', () => ({ Avatar: () => null }));
vi.mock('antd-style', () => ({
  createStaticStyles: () => ({ askCopilot: 'ask-copilot' }),
  cssVar: { colorTextDescription: '', colorTextSecondary: '' },
}));

vi.mock('@/features/Conversation/store', () => ({
  useConversationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ composerTarget: { contextKey: 'provider-context', writable: true } }),
}));

vi.mock('@/store/file', () => ({
  useFileStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ addChatContextSelection: mocks.addSelectionContext }),
}));

vi.mock('../RightPanel/OverrideContext', () => ({
  usePageAgentPanelControl: () => ({ toggle: mocks.togglePageAgentPanel }),
}));

vi.mock('../store', () => ({
  usePageEditorStore: (selector: (state: typeof mocks.pageState) => unknown) =>
    selector(mocks.pageState),
}));

describe('useAskCopilotItem', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.addSelectionContext.mockReset();
    mocks.pageState.documentId = 'page-a';
    mocks.pageState.setRightPanelMode.mockReset();
    mocks.togglePageAgentPanel.mockReset();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('routes a selection to the current page and composer after a page switch', () => {
    const editor = {
      blur: vi.fn(),
      dispatchCommand: vi.fn(),
      getSelectionDocument: vi.fn((format: string) =>
        format === 'litexml' ? '<p>西藏</p>' : '西藏',
      ),
    };
    const firstTarget: ComposerTarget = { contextKey: 'composer-a', writable: true };
    const secondTarget: ComposerTarget = { contextKey: 'composer-b', writable: true };
    const { rerender, result } = renderHook(
      ({ target }) => useAskCopilotItem(editor as never, target),
      { initialProps: { target: firstTarget } },
    );

    const clickCurrentItem = () => {
      const element = result.current?.[0]?.children as ReactElement<{ onClick: () => void }>;
      act(() => element.props.onClick());
    };

    clickCurrentItem();
    expect(mocks.addSelectionContext).toHaveBeenLastCalledWith({
      contextKey: 'composer-a',
      selection: expect.objectContaining({
        content: '<p>西藏</p>',
        format: 'xml',
        pageId: 'page-a',
        preview: '西藏',
        type: 'text',
      }),
    });

    mocks.pageState.documentId = 'page-b';
    rerender({ target: secondTarget });
    clickCurrentItem();

    expect(mocks.addSelectionContext).toHaveBeenLastCalledWith({
      contextKey: 'composer-b',
      selection: expect.objectContaining({ pageId: 'page-b' }),
    });
    expect(mocks.addSelectionContext).toHaveBeenCalledTimes(2);
  });
});
