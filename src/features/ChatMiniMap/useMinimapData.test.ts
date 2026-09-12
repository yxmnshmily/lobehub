/** @vitest-environment happy-dom */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { virtuaListSlice } from '../Conversation/store/slices/virtuaList/action';
import { useMinimapData } from './useMinimapData';

const { state } = vi.hoisted(() => ({ state: {} as Record<string, any> }));
vi.mock('@/features/Conversation', () => ({
  conversationSelectors: {
    activeIndex: (s: typeof state) => s.activeIndex,
    displayMessages: (s: typeof state) => s.displayMessages,
  },
  useConversationStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

describe('minimap history navigation', () => {
  it('pauses following before each jump and uses message indices, while bottom navigation stays separate', () => {
    const calls: string[] = [];
    const pauseFollowing = vi.fn(() => calls.push('pause'));
    const scrollToIndex = vi.fn(() => calls.push('scroll'));
    Object.assign(state, {
      activeIndex: 0,
      displayMessages: [
        { id: 'first', role: 'user', content: 'First' },
        { id: 'answer', role: 'assistant', content: 'Answer' },
        { id: 'second', role: 'user', content: 'Second' },
      ],
      virtuaScrollMethods: { pauseFollowing, scrollToIndex, getTotalCount: () => 3 },
    });
    Object.assign(
      state,
      virtuaListSlice(
        ((patch: object) => Object.assign(state, patch)) as any,
        (() => state) as any,
        {} as any,
      ),
    );
    const { result } = renderHook(() => useMinimapData());
    expect(result.current.indicators.map((item) => item.virtuosoIndex)).toEqual([0, 2]);
    act(() => result.current.handleJump(result.current.indicators[1].virtuosoIndex));
    act(() => result.current.handleJump(result.current.indicators[0].virtuosoIndex));
    expect(calls).toEqual(['pause', 'scroll', 'pause', 'scroll']);
    expect(scrollToIndex).toHaveBeenNthCalledWith(1, 2, { align: 'start', smooth: false });
    expect(scrollToIndex).toHaveBeenNthCalledWith(2, 0, { align: 'start', smooth: false });
    pauseFollowing.mockClear();
    state.scrollToBottom(false);
    expect(pauseFollowing).not.toHaveBeenCalled();
    expect(scrollToIndex).toHaveBeenLastCalledWith(2, { align: 'end', smooth: false });
  });
});
