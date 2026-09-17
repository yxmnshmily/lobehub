import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNewPageDraft } from './useNewPageDraft';

const mocks = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ id: 'new-document' }),
  update: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn().mockResolvedValue(undefined),
  changed: vi.fn(),
  error: vi.fn(),
  getDocument: vi.fn<(format: string) => string | { root: object } | undefined>(),
}));
const state = {
  documentId: undefined,
  draftVisibility: 'private',
  editor: { getDocument: mocks.getDocument },
  emoji: undefined,
  onDocumentIdChange: mocks.changed,
  title: 'Draft',
};
vi.mock('./store', () => ({
  usePageEditorStore: (selector: (s: typeof state) => unknown) => selector(state),
  useStoreApi: () => draftStore,
}));
const draftStore = { getState: () => state, subscribe: () => () => {} };
const translate = (key: string) => key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock('@/services/document', () => ({
  documentService: { createDocument: mocks.create, updateDocument: mocks.update },
}));
vi.mock('@/store/page', () => ({
  usePageStore: { getState: () => ({ refreshDocuments: mocks.refresh }) },
}));
vi.mock('@/features/EditorCanvas/UnsavedChangesGuard', () => ({ default: () => null }));
vi.mock('@lobehub/ui/base-ui', () => ({ toast: { error: mocks.error } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('new page draft export', () => {
  it('saves markdown and editor data before selecting the created page', async () => {
    mocks.getDocument.mockImplementation((format) =>
      format === 'markdown' ? 'Draft body' : { root: {} },
    );
    const { result } = renderHook(useNewPageDraft);
    act(() => result.current.onChange());
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Draft body', editorData: '{"root":{}}' }),
    );
    expect(mocks.changed).toHaveBeenCalledWith('new-document');
  });

  it('rejects a non-markdown export without saving or discarding dirty state', async () => {
    mocks.getDocument.mockReturnValue({ root: {} });
    const { result } = renderHook(useNewPageDraft);
    act(() => {
      expect(() => result.current.onChange()).not.toThrow();
    });
    expect(result.current.guard?.props.isDirty).toBe(true);
    expect(mocks.error).toHaveBeenCalledWith('pageEditor.saveFailed');
    await expect(result.current.guard?.props.onAutoSave()).rejects.toThrow('markdown');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.changed).not.toHaveBeenCalled();
    expect(result.current.guard?.props.isDirty).toBe(true);
  });
});
