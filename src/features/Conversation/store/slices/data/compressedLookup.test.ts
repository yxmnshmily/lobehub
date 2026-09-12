import { describe, expect, it, vi } from 'vitest';

import { dataSelectors } from './selectors';

vi.mock('@/store/chat', () => ({ useChatStore: {} }));
vi.mock('@/store/chat/selectors', () => ({ topicSelectors: {} }));

describe('compressed display message lookup', () => {
  it('resolves a task in nested compressed history for its existing renderer', () => {
    const task = { id: 'task', role: 'task' };
    const state = {
      displayMessages: [
        { id: 'outer', compressedMessages: [{ id: 'inner', compressedMessages: [task] }] },
      ],
    } as any;
    expect(dataSelectors.getDisplayMessageById('task')(state)).toBe(task);
    expect(dataSelectors.getDisplayMessageById('missing')(state)).toBeUndefined();
  });
});
