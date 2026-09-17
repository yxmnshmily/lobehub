import { CUSTOM_DOCUMENT_FILE_TYPE } from '@lobechat/const';
import { toast } from '@lobehub/ui/base-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import UnsavedChangesGuard from '@/features/EditorCanvas/UnsavedChangesGuard';
import { documentService } from '@/services/document';
import { usePageStore } from '@/store/page';

import { createDraftSaver, hasPageDraftInput, type PageDraftSnapshot } from './draftSaver';
import { usePageEditorStore, useStoreApi } from './store';

/** Only the explicitly opened new-page route opts into lazy document creation. */
export const useNewPageDraft = () => {
  const store = useStoreApi();
  const { t } = useTranslation(['file', 'ui']);
  const enabled = usePageEditorStore((s) => !s.documentId && !!s.onDocumentIdChange);
  const visibility = usePageEditorStore((s) => s.draftVisibility);
  const [dirty, setDirty] = useState(false);
  const [savedId, setSavedId] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const leaving = useRef(false);
  const mounted = useRef(true);

  const read = useCallback((): PageDraftSnapshot => {
    const { editor, title, emoji } = store.getState();
    const content = editor?.getDocument('markdown');
    if (content !== null && content !== undefined && typeof content !== 'string') {
      throw new TypeError('Expected markdown export to be a string');
    }
    return {
      content: content ?? '',
      editorData: editor?.getDocument('json') || null,
      emoji,
      title: title || '',
    };
  }, [store]);

  const saver = useMemo(() => {
    const payload = (draft: PageDraftSnapshot) => ({
      content: draft.content,
      editorData: JSON.stringify(draft.editorData),
      metadata: { emoji: draft.emoji },
      title: draft.title.trim() || t('pageList.untitled'),
    });
    return createDraftSaver(
      read,
      async (draft) => {
        const document = await documentService.createDocument({
          ...payload(draft),
          fileType: CUSTOM_DOCUMENT_FILE_TYPE,
          visibility,
        });
        return document.id;
      },
      (id, draft) =>
        documentService.updateDocument({
          ...payload(draft),
          id,
          saveSource: 'autosave',
        }),
    );
  }, [read, t, visibility]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const id = await saver.flush();
    if (id) {
      await usePageStore.getState().refreshDocuments();
      // Typing can continue while the sidebar refresh is in flight.
      await saver.flush();
    }
    if (mounted.current) {
      setDirty(false);
      if (id && !leaving.current) setSavedId(id);
    }
    return true;
  }, [saver]);

  const onChange = useCallback(() => {
    if (!enabled) return;
    // Keep the unsaved guard active if the editor cannot export this draft.
    setDirty(true);
    clearTimeout(timer.current);
    try {
      setDirty(hasPageDraftInput(read()));
    } catch {
      toast.error(t('pageEditor.saveFailed'));
      return;
    }
    timer.current = setTimeout(() => {
      void flush().catch(() => {
        if (mounted.current) toast.error(t('pageEditor.saveFailed'));
      });
    }, 600);
  }, [enabled, flush, read, t]);

  useEffect(() => {
    if (!enabled) return;
    return store.subscribe((next, previous) => {
      if (next.title !== previous.title || next.emoji !== previous.emoji) onChange();
    });
  }, [enabled, onChange, store]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  // Wait for the dirty guard to receive the saved state before replacing the route.
  useEffect(() => {
    if (savedId && !dirty && !leaving.current) store.getState().onDocumentIdChange?.(savedId);
  }, [dirty, savedId, store]);

  return {
    onChange,
    guard: enabled ? (
      <UnsavedChangesGuard
        isDirty={dirty}
        message={t('form.unsavedWarning', { ns: 'ui' })}
        onAutoSave={async () => {
          leaving.current = true;
          try {
            return await flush();
          } catch (error) {
            leaving.current = false;
            throw error;
          }
        }}
      />
    ) : null,
  };
};
