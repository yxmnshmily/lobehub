import { afterEach, describe, expect, it, vi } from 'vitest';

import { canCopyResourceContent, copyResourceContent } from './copyResourceContent';

const resource = { filename: 'notes.txt', fileType: 'text/plain', url: '/notes.txt' };
afterEach(() => vi.unstubAllGlobals());

const clipboard = () => {
  const write = vi.fn<(items: { data: Record<string, Promise<Blob>> }[]) => Promise<void>>(
    async (items) => {
      await Promise.all(items.flatMap((item) => Object.values(item.data)));
    },
  );
  vi.stubGlobal('navigator', { clipboard: { write } });
  vi.stubGlobal(
    'ClipboardItem',
    class {
      constructor(public data: Record<string, Promise<Blob>>) {}
    },
  );
  return write;
};

describe('copy resource content', () => {
  it('copies text bytes, never the URL, and starts clipboard access before loading finishes', async () => {
    const write = clipboard();
    const fetchFile = vi.fn(async () => new Response('actual document body'));
    vi.stubGlobal('fetch', fetchFile);
    await copyResourceContent(resource);
    const item = write.mock.calls[0][0][0];
    expect(await (await item.data['text/plain']).text()).toBe('actual document body');
    expect(fetchFile).toHaveBeenCalledWith('/notes.txt', expect.any(Object));
  });

  it('copies a document body supplied by the page loader without fetching a file URL', async () => {
    const write = clipboard();
    const fetchFile = vi.fn();
    vi.stubGlobal('fetch', fetchFile);
    await copyResourceContent({ ...resource, loadText: async () => '# Document body' });
    expect(await (await write.mock.calls[0][0][0].data['text/plain']).text()).toBe(
      '# Document body',
    );
    expect(fetchFile).not.toHaveBeenCalled();
  });

  it('copies a PNG as image data', async () => {
    const write = clipboard();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['png-data'], { type: 'image/png' }))),
    );
    await copyResourceContent({ ...resource, fileType: 'image/png', filename: 'photo.png' });
    expect((await write.mock.calls[0][0][0].data['image/png']).type).toBe('image/png');
  });

  it('does not copy an error response as document content', async () => {
    clipboard();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('denied', { status: 403 })),
    );
    await expect(copyResourceContent(resource)).rejects.toThrow('Could not load file: 403');
  });

  it('converts non-PNG images to PNG and releases its temporary URL', async () => {
    const write = clipboard();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['jpeg'], { type: 'image/jpeg' }))),
    );
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:image-test', revokeObjectURL: revoke });
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 3;
        naturalHeight = 2;
        decode = async () => {};
      },
    );
    const canvas = {
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (cb: (b: Blob) => void) => cb(new Blob(['converted'], { type: 'image/png' })),
    };
    vi.stubGlobal('document', { createElement: () => canvas });
    await copyResourceContent({ ...resource, fileType: 'image/jpeg', filename: 'photo.jpg' });
    expect((await write.mock.calls[0][0][0].data['image/png']).type).toBe('image/png');
    expect(revoke).toHaveBeenCalledWith('blob:image-test');
  });

  it('rejects unsupported binaries rather than copying a link or garbled text', async () => {
    const write = clipboard();
    const video = { ...resource, filename: 'clip.mp4', fileType: 'video/mp4' };
    expect(canCopyResourceContent(video)).toBe(false);
    await expect(copyResourceContent(video)).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });

  it('propagates clipboard denial', async () => {
    const write = clipboard();
    write.mockRejectedValue(new Error('Permission denied'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('body')),
    );
    await expect(copyResourceContent(resource)).rejects.toThrow('Permission denied');
  });
});
