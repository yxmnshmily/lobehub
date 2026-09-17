import { hasMeaningfulEditorContent } from '@/libs/editor/hasMeaningfulEditorContent';

export interface PageDraftSnapshot {
  content: string;
  editorData: unknown;
  emoji?: string;
  title: string;
}

export const hasPageDraftInput = (draft: PageDraftSnapshot) =>
  Boolean(
    draft.title.trim() || draft.content.trim() || hasMeaningfulEditorContent(draft.editorData),
  );

/** Serialize the first write and subsequent edits arriving while it is in flight. */
export const createDraftSaver = (
  read: () => PageDraftSnapshot,
  create: (draft: PageDraftSnapshot) => Promise<string>,
  update: (id: string, draft: PageDraftSnapshot) => Promise<unknown>,
) => {
  let id: string | undefined;
  let saved: string | undefined;
  let pending: Promise<string | undefined> | undefined;

  const flush = (): Promise<string | undefined> => {
    if (pending) return pending;
    pending = (async () => {
      let draft = read();
      if (!id && !hasPageDraftInput(draft)) return;
      while (saved !== JSON.stringify(draft)) {
        const version = JSON.stringify(draft);
        if (id) await update(id, draft);
        else id = await create(draft);
        saved = version;
        draft = read();
      }
      return id;
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };

  return { flush };
};
