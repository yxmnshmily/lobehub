import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { createStore, Provider } from '@/features/Conversation/store';

import GroupHistoryNotice, { GroupHistoryAction, GroupRecentNotice } from './GroupHistoryNotice';

const push = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useQueryRoute', () => ({ useQueryRoute: () => ({ push }) }));

it('opens the same topic list from the header icon and retains return navigation', () => {
  const view = render(<GroupHistoryAction groupId="example" />);
  fireEvent.click(screen.getByRole('button', { name: '查看历史话题' }));
  expect(push).toHaveBeenLastCalledWith('/group/example/topics');
  view.rerender(<GroupHistoryNotice history groupId="example" />);
  fireEvent.click(screen.getByRole('button', { name: '返回近期聊天' }));
  expect(push).toHaveBeenLastCalledWith('/group/example');
});

it('shows on upward scrolling and hides on downward scrolling before reaching bottom', () => {
  const store = createStore({
    context: { agentId: '', groupId: 'example', scope: 'group', topicId: null },
  });
  render(
    <Provider createStore={() => store}>
      <GroupRecentNotice />
    </Provider>,
  );
  const notice = screen.getByText(/主窗口显示最近 200 条消息/).parentElement!;
  expect(notice.getAttribute('aria-hidden')).toBe('true');
  act(() => store.getState().setScrollState({ atBottom: false, scrollDirection: 'up' }));
  expect(notice.getAttribute('aria-hidden')).toBe('false');
  act(() => store.getState().setScrollState({ atBottom: false, scrollDirection: 'down' }));
  expect(notice.getAttribute('aria-hidden')).toBe('true');
  act(() => store.getState().setScrollState({ atBottom: false, scrollDirection: 'up' }));
  expect(notice.getAttribute('aria-hidden')).toBe('false');
  act(() => store.getState().setScrollState({ atBottom: true }));
  expect(notice.getAttribute('aria-hidden')).toBe('true');
});

it('hides after five idle seconds and reopens on another upward scroll', () => {
  vi.useFakeTimers();
  const store = createStore({
    context: { agentId: '', groupId: 'example', scope: 'group', topicId: null },
  });
  const view = render(
    <Provider createStore={() => store}>
      <GroupRecentNotice />
    </Provider>,
  );
  try {
    const notice = screen.getByText(/主窗口显示最近 200 条消息/).parentElement!;
    act(() =>
      store
        .getState()
        .setScrollState({ atBottom: false, scrollDirection: 'up', isScrolling: true }),
    );
    act(() => store.getState().setScrollState({ isScrolling: false }));
    act(() => vi.advanceTimersByTime(4999));
    expect(notice.getAttribute('aria-hidden')).toBe('false');
    act(() => vi.advanceTimersByTime(1));
    expect(notice.getAttribute('aria-hidden')).toBe('true');
    act(() => store.getState().setScrollState({ isScrolling: true }));
    expect(notice.getAttribute('aria-hidden')).toBe('false');
    act(() => vi.advanceTimersByTime(6000));
    expect(notice.getAttribute('aria-hidden')).toBe('false');
    act(() => store.getState().setScrollState({ isScrolling: false }));
    act(() => vi.advanceTimersByTime(5000));
    expect(notice.getAttribute('aria-hidden')).toBe('true');
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});
