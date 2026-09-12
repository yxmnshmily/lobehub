/**
 * @vitest-environment happy-dom
 */
import { EDITOR_DEBOUNCE_TIME } from '@lobechat/const';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore, Provider } from './store';
import StoreUpdater from './StoreUpdater';

const mocks = vi.hoisted(() => ({
  performSave: vi.fn(),
}));

vi.mock('@/libs/editor/hasMeaningfulEditorContent', () => ({
  hasMeaningfulEditorContent: () => false,
}));

vi.mock('@/services/documentHistoryQueue', () => ({
  documentHistoryQueueService: { enqueueEditorSnapshot: vi.fn(), flush: vi.fn() },
}));

vi.mock('@/store/document', () => {
  const state = {
    commitEditorMutation: vi.fn(),
    documents: {},
    performSave: mocks.performSave,
  };

  return {
    useDocumentStore: Object.assign(
      (selector: (store: typeof state) => unknown) => selector(state),
      { getState: () => state },
    ),
  };
});

vi.mock('@/store/page', () => ({
  pageSelectors: {
    getDocumentById: () => () => undefined,
  },
  usePageStore: (selector: (state: object) => unknown) => selector({}),
}));

vi.mock('@/store/tool/slices/builtin/executors/pageAgentRuntime', () => ({
  pageAgentRuntime: {
    setAfterMutateHandler: vi.fn(),
    setBeforeMutateHandler: vi.fn(),
    setCurrentDocId: vi.fn(),
    setEditor: vi.fn(),
    setTitleHandlers: vi.fn(),
  },
}));

vi.mock('./useDocumentLock', () => ({ useDocumentLock: vi.fn() }));
vi.mock('./usePageDraft', () => ({ usePageDraft: vi.fn() }));
vi.mock('./useResourceEvents', () => ({ useResourceEvents: vi.fn() }));

const Wrapper = ({
  children,
  store,
}: {
  children: ReactNode;
  store: ReturnType<typeof createStore>;
}) => <Provider createStore={() => store}>{children}</Provider>;

describe('StoreUpdater document switching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.performSave.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('flushes the previous document meta save before switching document ids', async () => {
    const store = createStore();
    const view = render(<StoreUpdater pageId="doc-1" title="Document 1" />, {
      wrapper: ({ children }) => <Wrapper store={store}>{children}</Wrapper>,
    });

    expect(store.getState().documentId).toBe('doc-1');
    store.getState().setTitle('Document 1 edited');

    view.rerender(<StoreUpdater pageId="doc-2" title="Document 2" />);
    expect(store.getState().documentId).toBe('doc-2');
    await vi.advanceTimersByTimeAsync(EDITOR_DEBOUNCE_TIME);

    expect(mocks.performSave).toHaveBeenCalledWith(
      'doc-1',
      { emoji: undefined, title: 'Document 1 edited' },
      { saveSource: 'autosave' },
    );
  });
});
