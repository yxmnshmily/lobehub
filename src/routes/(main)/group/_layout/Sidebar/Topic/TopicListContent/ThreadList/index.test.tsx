/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import ThreadList from './index';

const chatState = vi.hoisted(() => ({
  activeThreadId: undefined,
  activeTopicId: 'topic-1',
  threads: [
    { id: 'continuation-1', title: '用户分支', type: 'continuation' },
    { id: 'isolation-1', title: '', type: 'isolation' },
  ],
}));

vi.mock('@lobehub/ui', () => ({
  ScrollShadow: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/hooks/useFetchThreads', () => ({
  useFetchThreads: vi.fn(),
}));

vi.mock('@/hooks/useScrollActiveThreadIntoView', () => ({
  useScrollActiveThreadIntoView: () => ({ current: null }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));

vi.mock('@/store/chat/selectors', () => ({
  threadSelectors: {
    getThreadsByTopic: () => (state: typeof chatState) => state.threads,
  },
}));

vi.mock('./ThreadItem', () => ({
  default: ({ id, title }: { id: string; title: string }) => (
    <div data-testid={`thread-${id}`}>{title}</div>
  ),
}));

describe('group ThreadList', () => {
  it('does not expose AI isolation threads as user-facing subtopics', () => {
    render(<ThreadList />);

    expect(screen.getByTestId('thread-continuation-1')).toHaveTextContent('用户分支');
    expect(screen.queryByTestId('thread-isolation-1')).not.toBeInTheDocument();
  });
});
