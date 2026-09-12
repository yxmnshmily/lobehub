import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { canRetainTopicPage, useRecentTopicControls } from './useRecentTopicControls';

describe('recent topic controls', () => {
  it.each(['NOT_FOUND', 'UNAUTHORIZED', 'FORBIDDEN'])(
    'does not retain cached topics after access fails with %s',
    (code) => {
      expect(canRetainTopicPage(code)).toBe(false);
    },
  );
  it('can retain loaded topics after a transient page failure', () => {
    expect(canRetainTopicPage('INTERNAL_SERVER_ERROR')).toBe(true);
    expect(canRetainTopicPage(undefined)).toBe(true);
  });
  it('opens the list immediately when used in a floating panel', () => {
    const { result } = renderHook(() => useRecentTopicControls([1, 2], true));
    expect(result.current.expanded).toBe(true);
    expect(result.current.topics).toEqual([1, 2]);
  });
  it('keeps every loaded topic and can collapse without removing records', () => {
    const items = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    const { result } = renderHook(() => useRecentTopicControls(items));
    expect(result.current.expanded).toBe(false);
    act(() => result.current.setExpanded(true));
    expect(result.current.expanded).toBe(true);
    expect(result.current.topics).toEqual(items);
    act(() => result.current.setOldestFirst(true));
    expect(result.current.topics).toEqual([...items].reverse());
    act(() => result.current.setExpanded(false));
    expect(result.current.expanded).toBe(false);
    expect(result.current.topics).toHaveLength(12);
    expect(items).toHaveLength(12);
  });
});
