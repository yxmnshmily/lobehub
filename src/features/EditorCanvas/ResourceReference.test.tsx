// @vitest-environment happy-dom
import { type IEditor, moment, ReactCodePlugin, ReactTablePlugin } from '@lobehub/editor';
import { Editor, useEditor } from '@lobehub/editor/react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ResourceMarkdown from './ResourceMarkdown';
import ReactResourceReferencePlugin, { ResourceReference } from './ResourceReference';

const mocks = vi.hoisted(() => ({ get: vi.fn(), modal: vi.fn(), document: vi.fn() }));
vi.mock('@/services/file', () => ({ fileService: { getKnowledgeItem: mocks.get } }));
vi.mock('@lobehub/ui/base-ui', () => ({ createModal: mocks.modal }));
vi.mock('@/components/FileIcon', () => ({ default: () => <span>icon</span> }));
vi.mock('@/features/DocumentModal/loader', () => ({ openDocumentModal: mocks.document }));
vi.mock('@/features/FileViewer', () => ({
  default: ({ name }: { name: string }) => <div>{name}</div>,
}));
vi.mock('@/components/AsyncError', () => ({ default: () => <div>文件不可用</div> }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const Wrapper = ({ ready }: { ready: (e: IEditor) => void }) => {
  const editor = useEditor();
  useEffect(() => {
    if (editor) ready(editor);
  }, [editor, ready]);
  return editor ? (
    <Editor
      content=""
      editor={editor}
      plugins={[ReactCodePlugin, ReactTablePlugin, ReactResourceReferencePlugin]}
      type="text"
    />
  ) : null;
};

describe('document resource reference', () => {
  it.each([
    ['file_image', 'image/jpeg'],
    ['file_video', 'video/mp4'],
    ['file_pdf', 'application/pdf'],
  ])('opens %s in the existing file preview', async (id, fileType) => {
    mocks.get.mockResolvedValue({ id, name: '测试文件', fileType, url: '/test' });
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <ResourceReference id={id} />
      </SWRConfig>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /测试文件/ }));
    expect(mocks.modal).toHaveBeenCalledWith(expect.objectContaining({ title: '测试文件' }));
    expect(mocks.document).not.toHaveBeenCalled();
  });
  it('renders goal and task markdown references as clickable thumbnails', async () => {
    mocks.get.mockResolvedValue({
      id: 'file_markdown',
      name: '配图.jpeg',
      fileType: 'image/jpeg',
      url: '/test',
    });
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <ResourceMarkdown>{'配图：`file_markdown`'}</ResourceMarkdown>
      </SWRConfig>,
    );
    const button = await screen.findByRole('button', { name: '配图.jpeg' });
    expect(button.querySelector('img')).toBeTruthy();
    expect(button.textContent).not.toContain('配图.jpeg');
    fireEvent.click(button);
    expect(mocks.modal).toHaveBeenCalledWith(expect.objectContaining({ title: '配图.jpeg' }));
  });
  it('opens a document through the document viewer', async () => {
    mocks.get.mockResolvedValue({ id: 'docs_one', name: '审阅文档', fileType: 'custom/document' });
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <ResourceReference id="docs_one" />
      </SWRConfig>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /审阅文档/ }));
    expect(mocks.document).toHaveBeenCalledWith('docs_one');
  });
  it('does not open an unavailable resource as a successful preview', async () => {
    mocks.get.mockResolvedValue(null);
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <ResourceReference id="file_missing" />
      </SWRConfig>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'notFound.title' }));
    expect(mocks.modal).toHaveBeenCalled();
    expect(mocks.document).not.toHaveBeenCalled();
  });
  it('hydrates a table reference and preserves its markdown and JSON on reopen', async () => {
    mocks.get.mockResolvedValue({
      id: 'file_real',
      name: '封面.jpeg',
      fileType: 'image/jpeg',
      url: '/test',
    });
    let editor: IEditor | undefined;
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <Wrapper
          ready={(e) => {
            editor = e;
          }}
        />
      </SWRConfig>,
    );
    await act(async () => {
      await moment();
    });
    await act(async () => {
      editor!.setDocument(
        'markdown',
        '| 文件 | 尺寸 |\n| --- | --- |\n| `file_real` | 1440×2560 |',
      );
      await moment();
    });
    expect(await screen.findByTitle('封面.jpeg')).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledWith('file_real');
    const thumbnail = await screen.findByTitle('封面.jpeg');
    // Browser selection must not run between pointer press and click, including
    // after a modal closes and the editor still holds an earlier caret.
    expect(fireEvent.pointerDown(thumbnail)).toBe(false);
    expect(fireEvent.mouseDown(thumbnail)).toBe(false);
    fireEvent.click(await screen.findByTitle('封面.jpeg'));
    expect(mocks.modal).toHaveBeenCalledWith(expect.objectContaining({ title: '封面.jpeg' }));
    expect(editor!.getDocument('markdown')).toContain('`file_real`');
    const json = editor!.getDocument('json');
    expect(JSON.stringify(json)).not.toContain('resource-reference');
    await act(async () => {
      editor!.setDocument('json', json);
      await moment();
    });
    expect(await screen.findByTitle('封面.jpeg')).toBeTruthy();
    mocks.modal.mockClear();
    const reopenedThumbnail = await screen.findByTitle('封面.jpeg');
    expect(fireEvent.pointerDown(reopenedThumbnail)).toBe(false);
    fireEvent.click(reopenedThumbnail);
    expect(mocks.modal).toHaveBeenCalledTimes(1);
  });
});
