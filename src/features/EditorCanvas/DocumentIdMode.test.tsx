/**
 * @vitest-environment happy-dom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { editorSelectors } from '@/store/document/slices/editor';

import DocumentIdMode from './DocumentIdMode';

const handleContentChangeStore = vi.fn();
const performSave = vi.fn();
const flushSave = vi.fn();
const initDocumentWithEditor = vi.fn();
const onEditorInit = vi.fn().mockResolvedValue(undefined);
const upsertDocument = vi.fn();
const createFetchDocumentResult = (
  overrides: Partial<{
    data: unknown;
    error: unknown;
    isLoading: boolean;
    mutate: ReturnType<typeof vi.fn>;
  }> = {},
) => ({ data: undefined, error: undefined, isLoading: false, mutate: vi.fn(), ...overrides });
const useFetchDocument = vi.fn(() => createFetchDocumentResult());

let saveHotkeyHandler: (() => void | Promise<void>) | undefined;
let documentStoreState: {
  activeDocumentId?: string;
  documents: Record<string, unknown>;
};
let pageDocuments: Array<{ id: string }>;

const mockDocumentStore = {
  flushSave,
  handleContentChange: handleContentChangeStore,
  initDocumentWithEditor,
  onEditorInit,
  performSave,
  useFetchDocument,
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('zustand-utils', () => ({
  createStoreUpdater: () => () => undefined,
}));

vi.mock('@/hooks/useHotkeys', () => ({
  useSaveDocumentHotkey: vi.fn((handler: () => void | Promise<void>) => {
    saveHotkeyHandler = handler;
  }),
}));

vi.mock('@/components/404', () => ({
  default: vi.fn(() => <div data-testid="not-found" />),
}));

vi.mock('@/components/AsyncError', () => ({
  default: vi.fn(({ onRetry }: { onRetry: () => void }) => (
    <button data-testid="async-error" onClick={onRetry}>
      retry
    </button>
  )),
}));

vi.mock('@/store/document', () => ({
  useDocumentStore: Object.assign(
    vi.fn((selector: (state: typeof mockDocumentStore & typeof documentStoreState) => unknown) =>
      selector({ ...mockDocumentStore, ...documentStoreState }),
    ),
    {
      getState: vi.fn(() => ({ ...mockDocumentStore, ...documentStoreState })),
    },
  ),
}));

vi.mock('@/store/page', () => ({
  pageSelectors: {
    getDocumentById:
      (documentId: string | undefined) => (state: { documents: typeof pageDocuments }) =>
        state.documents.find((document) => document.id === documentId),
  },
  usePageStore: Object.assign(
    vi.fn((selector: (state: { documents: typeof pageDocuments }) => unknown) =>
      selector({ documents: pageDocuments }),
    ),
    {
      getState: vi.fn(() => ({ upsertDocument })),
    },
  ),
}));

vi.mock('@/store/document/slices/editor', () => ({
  editorSelectors: {
    isDirty: vi.fn(() => () => false),
    isDocumentLoading: vi.fn(() => () => false),
  },
}));

vi.mock('./InternalEditor', () => ({
  default: vi.fn(() => <div data-testid="internal-editor" />),
}));

vi.mock('./UnsavedChangesGuard', () => ({
  default: vi.fn(() => null),
}));

describe('DocumentIdMode', () => {
  beforeEach(() => {
    handleContentChangeStore.mockClear();
    performSave.mockClear();
    flushSave.mockClear();
    initDocumentWithEditor.mockReset();
    onEditorInit.mockClear();
    upsertDocument.mockClear();
    useFetchDocument.mockClear();
    documentStoreState = { activeDocumentId: 'doc-1', documents: {} };
    pageDocuments = [];
    vi.mocked(editorSelectors.isDocumentLoading).mockReturnValue(() => false);
    saveHotkeyHandler = undefined;
  });

  it('should save with manual source when save hotkey is triggered', async () => {
    render(
      <DocumentIdMode
        documentId="doc-1"
        editor={
          {
            getLexicalEditor: vi.fn(() => ({})),
          } as any
        }
      />,
    );

    expect(screen.getByTestId('internal-editor')).toBeInTheDocument();
    expect(saveHotkeyHandler).toBeDefined();

    await act(async () => {
      await saveHotkeyHandler?.();
    });

    expect(handleContentChangeStore).toHaveBeenCalledTimes(1);
    expect(performSave).toHaveBeenCalledWith('doc-1', undefined, { saveSource: 'manual' });
    expect(flushSave).not.toHaveBeenCalled();
  });

  it('should call external onInit after document hydration', async () => {
    const onInit = vi.fn();
    const editor = {
      getLexicalEditor: vi.fn(() => ({})),
    } as any;

    render(<DocumentIdMode documentId="doc-1" editor={editor} onInit={onInit} />);

    await waitFor(() => {
      expect(onEditorInit).toHaveBeenCalledWith(editor);
      expect(onInit).toHaveBeenCalledWith(editor);
    });
  });

  it('should pass topicId into document fetching options', () => {
    const editor = {
      getLexicalEditor: vi.fn(() => ({})),
    } as any;

    render(
      <DocumentIdMode documentId="doc-1" editor={editor} sourceType="notebook" topicId="topic-1" />,
    );

    expect(useFetchDocument).toHaveBeenCalledWith('doc-1', {
      autoSave: true,
      editor,
      sourceType: 'notebook',
      topicId: 'topic-1',
    });
  });

  it('should render a recoverable fetch error before the document loading gate', () => {
    const editor = {
      getLexicalEditor: vi.fn(() => ({})),
    } as any;
    const mutate = vi.fn();
    useFetchDocument.mockReturnValueOnce({
      ...createFetchDocumentResult(),
      error: new Error('load failed'),
      mutate,
    });
    vi.mocked(editorSelectors.isDocumentLoading).mockReturnValueOnce(() => true);

    render(<DocumentIdMode documentId="doc-1" editor={editor} />);

    expect(screen.getByTestId('async-error')).toBeInTheDocument();
    expect(screen.queryByTestId('internal-editor')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('async-error'));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('should recover a matching fetched document when the store sync was missed', async () => {
    const editor = {
      getLexicalEditor: vi.fn(() => ({})),
    } as any;
    const remoteDocument = {
      content: '# Existing page',
      editorData: {},
      id: 'doc-1',
      updatedAt: new Date('2026-09-03T00:00:00.000Z'),
    };
    useFetchDocument.mockReturnValue(createFetchDocumentResult({ data: remoteDocument }));
    vi.mocked(editorSelectors.isDocumentLoading).mockImplementation(
      (documentId: string) => (state: typeof documentStoreState) => !state.documents[documentId],
    );
    initDocumentWithEditor.mockImplementation(({ documentId }: { documentId: string }) => {
      documentStoreState.documents[documentId] = {};
    });

    const view = render(<DocumentIdMode documentId="doc-1" editor={editor} />);

    await waitFor(() => {
      expect(initDocumentWithEditor).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: 'doc-1', editor, sourceType: 'page' }),
      );
    });
    // The real Zustand store update schedules this render. The test store is a
    // plain mutable object, so change a harmless prop to bypass React.memo.
    view.rerender(<DocumentIdMode documentId="doc-1" editor={editor} style={{ width: '100%' }} />);

    expect(screen.getByTestId('internal-editor')).toBeInTheDocument();
    expect(upsertDocument).toHaveBeenCalledWith(remoteDocument);
  });

  it('should not hydrate a response that is no longer the active document', async () => {
    const editor = {
      getLexicalEditor: vi.fn(() => ({})),
    } as any;
    documentStoreState.activeDocumentId = 'doc-2';
    useFetchDocument.mockReturnValue(
      createFetchDocumentResult({
        data: {
          content: '# Old page',
          editorData: {},
          id: 'doc-1',
          updatedAt: new Date('2026-09-03T00:00:00.000Z'),
        },
      }),
    );
    vi.mocked(editorSelectors.isDocumentLoading).mockReturnValue(() => true);

    render(<DocumentIdMode documentId="doc-1" editor={editor} />);

    await act(async () => undefined);
    expect(initDocumentWithEditor).not.toHaveBeenCalled();
  });

  it('should not duplicate hydration when the sync callback already populated the store', async () => {
    const editor = {
      getLexicalEditor: vi.fn(() => ({})),
    } as any;
    documentStoreState.documents['doc-1'] = {};
    useFetchDocument.mockReturnValue(
      createFetchDocumentResult({
        data: {
          content: '# Synced page',
          editorData: {},
          id: 'doc-1',
          updatedAt: new Date('2026-09-03T00:00:00.000Z'),
        },
      }),
    );
    // Simulate the selector value captured before useFetchDocument's onData
    // effect populated the real store.
    vi.mocked(editorSelectors.isDocumentLoading).mockReturnValue(() => true);

    render(<DocumentIdMode documentId="doc-1" editor={editor} />);

    await act(async () => undefined);
    expect(initDocumentWithEditor).not.toHaveBeenCalled();
  });

  it('should retry a locally known new page once and settle on a recoverable error', async () => {
    const editor = {
      getLexicalEditor: vi.fn(() => ({})),
    } as any;
    const mutate = vi.fn();
    pageDocuments = [{ id: 'doc-1' }];
    useFetchDocument.mockReturnValue(createFetchDocumentResult({ data: null, mutate }));
    vi.mocked(editorSelectors.isDocumentLoading).mockReturnValue(() => true);

    const view = render(<DocumentIdMode documentId="doc-1" editor={editor} />);

    expect(screen.queryByTestId('not-found')).not.toBeInTheDocument();
    expect(screen.getByTestId('async-error')).toBeInTheDocument();
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));

    view.rerender(<DocumentIdMode documentId="doc-1" editor={editor} />);
    expect(mutate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('async-error'));
    expect(mutate).toHaveBeenCalledTimes(2);
  });

  it('should render not found when the document fetch resolves to null', () => {
    const editor = {
      getLexicalEditor: vi.fn(() => ({})),
    } as any;
    useFetchDocument.mockReturnValueOnce({
      ...createFetchDocumentResult(),
      data: null,
    });
    vi.mocked(editorSelectors.isDocumentLoading).mockReturnValueOnce(() => true);

    render(<DocumentIdMode documentId="doc-1" editor={editor} />);

    expect(screen.getByTestId('not-found')).toBeInTheDocument();
    expect(screen.queryByTestId('internal-editor')).not.toBeInTheDocument();
  });
});
