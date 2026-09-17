import { describe, expect, it, vi } from 'vitest';

import { createDraftSaver, hasPageDraftInput, type PageDraftSnapshot } from './draftSaver';

const blank = (): PageDraftSnapshot => ({
  content: '',
  editorData: { root: { children: [{ type: 'paragraph', children: [] }] } },
  title: '',
});

describe('new page draft persistence', () => {
  it('does not create a record for an empty editor or whitespace', async () => {
    const create = vi.fn();
    const saver = createDraftSaver(
      () => ({ ...blank(), title: ' ', content: '\n' }),
      create,
      vi.fn(),
    );
    await saver.flush();
    await saver.flush();
    expect(create).not.toHaveBeenCalled();
  });

  it('recognizes title-only and non-text content', () => {
    expect(hasPageDraftInput({ ...blank(), title: '标题' })).toBe(true);
    expect(
      hasPageDraftInput({ ...blank(), editorData: { root: { children: [{ type: 'image' }] } } }),
    ).toBe(true);
  });

  it('creates once and saves text typed during the first request to the same document', async () => {
    let draft = { ...blank(), content: '第一句' };
    let resolve!: (id: string) => void;
    const create = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    const update = vi.fn().mockResolvedValue(undefined);
    const saver = createDraftSaver(() => draft, create, update);
    const first = saver.flush();
    const second = saver.flush();
    draft = { ...draft, content: '第一句，第二句', title: '新标题' };
    resolve('docs_one');
    expect(await first).toBe('docs_one');
    await second;
    await saver.flush();
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledExactlyOnceWith('docs_one', draft);
  });

  it('retries a failed update without creating another document', async () => {
    let draft = { ...blank(), content: '正文' };
    const create = vi.fn(async () => {
      draft = { ...draft, content: '继续输入' };
      return 'docs_one';
    });
    const update = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const saver = createDraftSaver(() => draft, create, update);
    await expect(saver.flush()).rejects.toThrow('offline');
    expect(await saver.flush()).toBe('docs_one');
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(2);
  });
});
