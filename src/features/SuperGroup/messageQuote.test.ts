import { createHeadlessEditor } from '@lobehub/editor/headless';
import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from 'lexical';
import { describe, expect, it } from 'vitest';

import {
  appendMessageQuote,
  observeMessageQuote,
  parseMessageQuote,
  removeMessageQuote,
  withoutQuoteParagraph,
} from './messageQuote';

describe('group message quotes without changing the send protocol', () => {
  it('presents a hidden reference without removing it from serialization, and cancels only that reference', () => {
    const editor = createEditor({ namespace: 'quote-presentation-test' });
    const root = document.createElement('div');
    document.body.append(root);
    editor.setRootElement(root);
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode('保留草稿').toggleFormat('bold')),
        );
      },
      { discrete: true },
    );
    appendMessageQuote(editor, { id: 'msg-1', name: '编剧', excerpt: '先拍背影' });
    let current: any;
    const stop = observeMessageQuote(editor, (quote) => {
      current = quote;
    });
    expect(current).toEqual({ id: 'msg-1', name: '编剧', excerpt: '先拍背影' });
    expect(root.querySelector('[data-group-draft-reference]')).toHaveAttribute('hidden');
    expect(JSON.stringify(editor.getEditorState().toJSON())).toContain('引用消息');
    removeMessageQuote(editor, 'msg-1');
    expect(current).toBeUndefined();
    editor.getEditorState().read(() => {
      expect($getRoot().getTextContent().trim()).toBe('保留草稿');
      expect(
        ($getRoot().getFirstDescendant() as ReturnType<typeof $createTextNode>).hasFormat('bold'),
      ).toBe(true);
    });
    appendMessageQuote(editor, { id: 'msg-2', name: '审核员', excerpt: '换个角度' });
    expect(current.id).toBe('msg-2');
    stop();
    expect(root.querySelector('[hidden]')).toBeNull();
    editor.setRootElement(null);
    root.remove();
  });
  it('round-trips the actual editor markdown and removes only the quote from rich rendering', () => {
    const editor = createHeadlessEditor();
    editor.hydrateMarkdown('**已写好的回复**');
    appendMessageQuote(editor.kernel.getLexicalEditor()!, {
      id: 'msg_abc_DEF',
      name: '编剧',
      excerpt: '先拍背影',
    });
    const saved = editor.export();
    expect(parseMessageQuote(saved.markdown).quote?.id).toBe('msg_abc_DEF');
    const display = withoutQuoteParagraph(saved.editorData, 'msg_abc_DEF');
    const reloaded = createHeadlessEditor();
    reloaded.hydrateEditorData(display as any);
    expect(reloaded.export().markdown.trim()).toBe('**已写好的回复**');
    expect(JSON.stringify(saved.editorData)).toContain('引用消息');
    reloaded.destroy();
    editor.destroy();
  });

  it('appends a readable reference without replacing a rich draft', () => {
    const editor = createEditor({ namespace: 'group-quote-test' });
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode('保留草稿').toggleFormat('bold')),
        );
      },
      { discrete: true },
    );
    appendMessageQuote(editor, { id: 'msg-1', name: '编剧', excerpt: '先拍背影' });
    editor.getEditorState().read(() => {
      expect($getRoot().getFirstDescendant()?.getTextContent()).toBe('保留草稿');
      expect(
        ($getRoot().getFirstDescendant() as ReturnType<typeof $createTextNode>).hasFormat('bold'),
      ).toBe(true);
      expect(parseMessageQuote($getRoot().getTextContent())).toEqual({
        content: '保留草稿',
        quote: { id: 'msg-1', name: '编剧', excerpt: '先拍背影' },
      });
    });
  });

  it('preserves text written after the reference and limits it to one quote', () => {
    expect(parseMessageQuote('回复\n\n引用消息「审核员」〔msg-2〕：第一镜\n\n补充意见')).toEqual({
      content: '回复\n\n补充意见',
      quote: { id: 'msg-2', name: '审核员', excerpt: '第一镜' },
    });
  });

  it('does not interpret ordinary blockquotes or malformed references as message links', () => {
    for (const content of ['> 普通引用', '引用消息「人」〔%broken〕：内容', '正文']) {
      expect(parseMessageQuote(content)).toEqual({ content });
    }
  });
});
