/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { type VListHandle } from 'virtua';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConversationScroll } from './useConversationScroll';

const state = vi.hoisted(() => ({
  displayMessages: [] as { id: string; role: string }[],
  operationState: { isAIGenerating: false },
}));
vi.mock('../../store', () => ({
  useConversationStore: (selector: (value: typeof state) => unknown) => selector(state),
  dataSelectors: { displayMessages: (s: typeof state) => s.displayMessages },
  messageStateSelectors: { isAIGenerating: (s: typeof state) => s.operationState.isAIGenerating },
}));

let resize: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  state.displayMessages = [{ id: 'old', role: 'assistant' }];
  state.operationState.isAIGenerating = false;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const flush = () =>
  act(() => {
    vi.runOnlyPendingTimers();
  });

function setup(
  options: { autoScrollEnabled?: boolean; footerOffset?: number; headerOffset?: number } = {},
) {
  const handle = {
    scrollToIndex: vi.fn(),
    scrollSize: 1600,
    viewportSize: 600,
    scrollOffset: 1000,
  };
  const container = document.createElement('div');
  container.innerHTML = '<div data-conversation-viewport><div></div></div>';
  const cancelRestore = vi.fn();
  const hook = renderHook(
    ({ dataSource, contextKey }) =>
      useConversationScroll({
        ...options,
        cancelRestore,
        containerRef: { current: container },
        contextKey,
        dataSource,
        virtuaRef: { current: handle as unknown as VListHandle },
      }),
    { initialProps: { dataSource: ['old'], contextKey: 'main_agent_topic' } },
  );
  const update = (ids: string[], contextKey = 'main_agent_topic') => {
    state.displayMessages = ids.map((id) => ({
      id,
      role: id.startsWith('user') ? 'user' : 'assistant',
    }));
    hook.rerender({ dataSource: ids, contextKey });
    flush();
  };
  return { ...hook, update, handle, cancelRestore };
}

describe('conversation bottom following', () => {
  it('follows the latest reply instead of pinning the user turn at the top', () => {
    const { update, handle, cancelRestore } = setup();
    update(['old', 'user', 'reply']);
    expect(handle.scrollToIndex).toHaveBeenLastCalledWith(2, { align: 'end', smooth: false });
    expect(cancelRestore).toHaveBeenCalledOnce();
  });

  it('handles a user message and assistant placeholder arriving in separate renders', () => {
    const { update, handle } = setup();
    update(['old', 'user']);
    expect(handle.scrollToIndex).toHaveBeenLastCalledWith(1, { align: 'end', smooth: false });
    update(['old', 'user', 'reply']);
    expect(handle.scrollToIndex).toHaveBeenLastCalledWith(2, { align: 'end', smooth: false });
  });

  it('follows tool/image height changes even when message count and text are unchanged', () => {
    const { update, handle } = setup();
    update(['old', 'user', 'reply']);
    handle.scrollToIndex.mockClear();
    handle.scrollSize = 2600;
    act(() => resize());
    flush();
    expect(handle.scrollToIndex).toHaveBeenCalledWith(2, { align: 'end', smooth: false });
  });

  it('pauses on manual upward scrolling and resumes when Back to Bottom is clicked', () => {
    const { update, handle, result } = setup();
    update(['old', 'user', 'reply']);
    act(() => result.current.onScrollOffset(1000));
    act(() => result.current.onScrollOffset(850, true));
    handle.scrollToIndex.mockClear();
    act(() => resize());
    flush();
    update(['old', 'user', 'reply', 'tool']);
    expect(handle.scrollToIndex).not.toHaveBeenCalled();
    act(() => result.current.resumeFollowing());
    flush();
    expect(handle.scrollToIndex).toHaveBeenLastCalledWith(3, { align: 'end', smooth: false });
  });

  it('keeps an explicit history jump paused through queued frames, resize and stale bottom events', () => {
    const { update, handle, result, cancelRestore } = setup();
    update(['old', 'user', 'reply']);
    handle.scrollToIndex.mockClear();
    cancelRestore.mockClear();
    act(() => resize());
    act(() => result.current.pauseFollowing());
    // The virtual list can emit the previous bottom offset before landing.
    act(() => result.current.onScrollOffset(1000));
    act(() => result.current.onScrollOffset(200));
    act(() => resize());
    flush();
    update(['old', 'user', 'reply', 'tool']);
    expect(handle.scrollToIndex).not.toHaveBeenCalled();
    expect(cancelRestore).toHaveBeenCalledOnce();
    act(() => result.current.resumeFollowing());
    expect(handle.scrollToIndex).toHaveBeenLastCalledWith(3, { align: 'end', smooth: false });
  });

  it('resumes after a history jump when the user scrolls to bottom or sends again', () => {
    const { update, handle, result } = setup();
    update(['old', 'user', 'reply']);
    act(() => result.current.pauseFollowing());
    act(() => result.current.onScrollOffset(200));
    act(() => result.current.onScrollOffset(1000, true));
    handle.scrollToIndex.mockClear();
    act(() => resize());
    flush();
    expect(handle.scrollToIndex).toHaveBeenCalled();
    act(() => result.current.pauseFollowing());
    update(['old', 'user', 'reply', 'user-next']);
    expect(handle.scrollToIndex).toHaveBeenLastCalledWith(3, { align: 'end', smooth: false });
  });

  it('does not treat workflow collapse as manual scrolling', () => {
    const { update, handle, result } = setup();
    update(['old', 'user', 'reply']);
    act(() => result.current.onScrollOffset(1000));
    act(() => result.current.onScrollOffset(500, false));
    handle.scrollToIndex.mockClear();
    act(() => resize());
    flush();
    expect(handle.scrollToIndex).toHaveBeenCalled();
  });

  it('a new send resumes following after reading history, but an ID replacement does not', () => {
    const { update, handle, result } = setup();
    update(['old', 'user-temp', 'reply-temp']);
    act(() => result.current.onScrollOffset(1000));
    act(() => result.current.onScrollOffset(400, true));
    handle.scrollToIndex.mockClear();
    update(['old', 'user-real', 'reply-real']);
    expect(handle.scrollToIndex).not.toHaveBeenCalled();
    update(['old', 'user-real', 'reply-real', 'user-next', 'reply-next']);
    expect(handle.scrollToIndex).toHaveBeenLastCalledWith(4, { align: 'end', smooth: false });
  });

  it('does not mistake prepended history for a new send', () => {
    const { update, handle } = setup();
    update(['user-history', 'reply-history', 'old']);
    expect(handle.scrollToIndex).not.toHaveBeenCalled();
  });

  it('leaves real topic changes to the history restoration controller', () => {
    const { update, handle } = setup();
    update(['old', 'user', 'reply']);
    handle.scrollToIndex.mockClear();
    update(['old-other', 'user-other', 'reply-other'], 'main_agent_other');
    act(() => resize());
    flush();
    expect(handle.scrollToIndex).not.toHaveBeenCalled();
  });

  it('lands after header and footer slots without adding a blank spacer', () => {
    const { update, handle } = setup({ headerOffset: 1, footerOffset: 1 });
    update(['old', 'user', 'reply']);
    expect(handle.scrollToIndex).toHaveBeenLastCalledWith(4, { align: 'end', smooth: false });
  });

  it('keeps following when a draft is promoted to its saved topic ID', () => {
    const { update, handle, result } = setup();
    update(['old'], 'main_agent_new');
    act(() => result.current.resumeFollowing());
    flush();
    update(['old', 'user', 'reply'], 'main_agent_new');
    handle.scrollToIndex.mockClear();
    update(['old', 'user-real', 'reply-real'], 'main_agent_saved');
    act(() => resize());
    flush();
    expect(handle.scrollToIndex).toHaveBeenLastCalledWith(2, { align: 'end', smooth: false });
  });

  it('respects disabled streaming auto-scroll but still locates a newly sent message', () => {
    const { update, handle } = setup({ autoScrollEnabled: false });
    update(['old', 'user', 'reply']);
    expect(handle.scrollToIndex).toHaveBeenCalledOnce();
    handle.scrollToIndex.mockClear();
    act(() => resize());
    flush();
    expect(handle.scrollToIndex).not.toHaveBeenCalled();
  });

  it('cancels queued scrolling when the component unmounts', () => {
    const { result, handle, unmount } = setup();
    act(() => result.current.resumeFollowing());
    handle.scrollToIndex.mockClear();
    act(() => resize());
    unmount();
    flush();
    expect(handle.scrollToIndex).not.toHaveBeenCalled();
  });

  it('honors Back to Bottom immediately without waiting for an animation frame', () => {
    const { result, handle } = setup();
    act(() => result.current.resumeFollowing());
    expect(handle.scrollToIndex).toHaveBeenCalledWith(0, { align: 'end', smooth: false });
  });
});
