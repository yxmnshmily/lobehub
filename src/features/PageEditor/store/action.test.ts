import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '.';

const mocks = vi.hoisted(() => ({
  performSave: vi.fn(),
}));

vi.mock('@/store/document', () => ({
  useDocumentStore: {
    getState: () => ({ performSave: mocks.performSave }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PageEditorStore - rightPanelMode', () => {
  it('should default to copilot mode', () => {
    const store = createStore();

    expect(store.getState().rightPanelMode).toBe('copilot');
  });

  it('should switch to history mode', () => {
    const store = createStore();

    store.getState().setRightPanelMode('history');

    expect(store.getState().rightPanelMode).toBe('history');
  });
});

describe('PageEditorStore - metaReadOnly', () => {
  it('ignores setTitle when meta is read-only (manual UI, AI, or extraction)', () => {
    const store = createStore({ metaReadOnly: true, title: 'Skill name' });

    store.getState().setTitle('SKILL.md');

    // title unchanged and the doc never gets marked dirty → no autosave fires
    expect(store.getState().title).toBe('Skill name');
    expect(store.getState().isMetaDirty).toBeFalsy();
  });

  it('ignores setEmoji when meta is read-only', () => {
    const store = createStore({ emoji: '🧩', metaReadOnly: true });

    store.getState().setEmoji('📄');

    expect(store.getState().emoji).toBe('🧩');
    expect(store.getState().isMetaDirty).toBeFalsy();
  });

  it('does not persist meta for a read-only doc even if marked dirty out-of-band', async () => {
    const store = createStore({
      documentId: 'docs_1',
      isMetaDirty: true,
      metaReadOnly: true,
      title: 'SKILL.md',
    });

    await store.getState().performMetaSave();

    // bails before flipping to 'saving' → never reaches the DocumentService write
    expect(store.getState().metaSaveStatus).toBe('idle');
  });

  it('still allows setTitle when meta is editable', () => {
    const store = createStore({ title: 'Old' });

    store.getState().setTitle('New');

    expect(store.getState().title).toBe('New');
    expect(store.getState().isMetaDirty).toBe(true);
  });
});

describe('PageEditorStore - document switching', () => {
  it('does not apply an old document save completion to the newly opened document', async () => {
    let resolveSave: (() => void) | undefined;
    mocks.performSave.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const store = createStore({
      documentId: 'doc-1',
      lastSavedTitle: 'Document 1',
      title: 'Document 1',
    });

    store.setState({ isMetaDirty: true, title: 'Document 1 edited' });
    const save = store.getState().performMetaSave();

    store.setState({ documentId: 'doc-2' });
    store.getState().initMeta('Document 2', '📄');

    resolveSave?.();
    await save;

    expect(store.getState()).toMatchObject({
      documentId: 'doc-2',
      emoji: '📄',
      isMetaDirty: false,
      lastSavedEmoji: '📄',
      lastSavedTitle: 'Document 2',
      metaSaveStatus: 'idle',
      title: 'Document 2',
    });
  });

  it('does not apply an old document save failure to the newly opened document', async () => {
    let rejectSave: ((error: Error) => void) | undefined;
    mocks.performSave.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          rejectSave = reject;
        }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createStore({
      documentId: 'doc-1',
      lastSavedTitle: 'Document 1',
      title: 'Document 1',
    });

    store.setState({ isMetaDirty: true, title: 'Document 1 edited' });
    const save = store.getState().performMetaSave();

    store.setState({ documentId: 'doc-2' });
    store.getState().initMeta('Document 2', '📄');
    store.setState({ isMetaDirty: true, metaSaveStatus: 'saving', title: 'Document 2 edited' });

    rejectSave?.(new Error('Document 1 save failed'));
    await save;

    expect(store.getState()).toMatchObject({
      documentId: 'doc-2',
      isMetaDirty: true,
      lastSavedEmoji: '📄',
      lastSavedTitle: 'Document 2',
      metaSaveStatus: 'saving',
      title: 'Document 2 edited',
    });
  });
});

describe('PageEditorStore - setLockState', () => {
  it('records the holder owner session alongside the holder id', () => {
    const store = createStore();

    store.getState().setLockState('user-1', null, 'page-owner-1');

    expect(store.getState().lockHolderId).toBe('user-1');
    expect(store.getState().lockHolderOwnerId).toBe('page-owner-1');
  });

  it('clears the holder owner when the lock is released', () => {
    const store = createStore();
    store.getState().setLockState('user-1', null, 'page-owner-1');

    store.getState().setLockState(null);

    expect(store.getState().lockHolderId).toBeNull();
    expect(store.getState().lockHolderOwnerId).toBeNull();
  });
});
