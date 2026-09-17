import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';

import { PortalViewType } from '@/store/chat/slices/portal/initialState';

import AgentTaskManager from './index';

const state = vi.hoisted(() => ({
  expanded: true,
  view: 'acceptance',
  resize: () => {},
  drag: (_size: { width: number }) => {},
  minimum: 0,
  maximum: 0,
}));
vi.mock('@/store/chat', () => ({ useChatStore: () => state.view }));
vi.mock('@/store/chat/selectors', () => ({
  chatPortalSelectors: { currentViewType: () => state.view },
}));
vi.mock('@/store/global', () => ({ useGlobalStore: () => [state.expanded, vi.fn()] }));
vi.mock('@/features/Portal/router', () => ({ PortalContent: () => <div>report</div> }));
vi.mock('./Conversation', () => ({ default: () => null }));
vi.mock('./TaskAgentProvider', () => ({
  TaskAgentProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/features/RightPanel', () => ({
  default: ({
    width,
    minWidth,
    maxWidth,
    onSizeChange,
  }: {
    width?: number;
    minWidth: number;
    maxWidth: number;
    onSizeChange: (size: { width: number }) => void;
  }) => {
    state.drag = onSizeChange;
    state.minimum = minWidth;
    state.maximum = maxWidth;
    return <div data-testid="width">{width}</div>;
  },
}));
it('uses half the workspace pixel width on opening, resize and reopening', () => {
  state.view = PortalViewType.Acceptance;
  let width = 1307;
  const getter = vi
    .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
    .mockImplementation(() => width);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        state.resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  try {
    const view = render(
      <div>
        <AgentTaskManager />
      </div>,
    );
    expect(screen.getByTestId('width').textContent).toBe('653.5');
    act(() => {
      width = 1000;
      state.resize();
    });
    expect(screen.getByTestId('width').textContent).toBe('500');
    state.expanded = false;
    view.rerender(
      <div>
        <AgentTaskManager viewedTaskId="closed" />
      </div>,
    );
    width = 1400;
    state.expanded = true;
    view.rerender(
      <div>
        <AgentTaskManager viewedTaskId="open" />
      </div>,
    );
    expect(screen.getByTestId('width').textContent).toBe('700');
    expect(state.minimum).toBe(400);
    expect(state.maximum).toBe(1000);
    act(() => state.drag({ width: 40 }));
    expect(screen.getByTestId('width').textContent).toBe('400');
    act(() => state.drag({ width: 1380 }));
    expect(screen.getByTestId('width').textContent).toBe('1000');
    act(() => {
      width = 700;
      state.resize();
    });
    expect(state.minimum).toBe(350);
    expect(state.maximum).toBe(350);
    expect(screen.getByTestId('width').textContent).toBe('350');
    state.view = PortalViewType.AcceptanceCheck;
    view.rerender(
      <div>
        <AgentTaskManager viewedTaskId="check" />
      </div>,
    );
    act(() => state.drag({ width: 10 }));
    expect(screen.getByTestId('width').textContent).toBe('350');
    view.unmount();
  } finally {
    getter.mockRestore();
    vi.unstubAllGlobals();
  }
});
