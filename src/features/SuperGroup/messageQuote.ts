import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isParagraphNode,
  type LexicalEditor,
} from 'lexical';

export interface MessageQuote {
  excerpt: string;
  id: string;
  name: string;
}

const quotePattern = /^引用消息「([^\n」]+)」〔([^\n〕]+)〕：([^\n]+)$/m;
const singleLine = (text: string) => text.replaceAll(/\s+/g, ' ').trim();

/** An agent chooses only a source ID; the UI resolves author/text from authorized messages. */
export function parseAgentMessageQuote(content: string): { content: string; referenceId?: string } {
  const match = /^\s*<group_reply ref="([\w%.-]{1,200})"\s*\/>\s*/.exec(content);
  if (match) {
    try {
      const referenceId = decodeURIComponent(match[1]);
      if (/^[\w-]+$/.test(referenceId)) {
        return { content: content.slice(match[0].length), referenceId };
      }
    } catch {
      /* An incomplete or invalid ID is not a navigation target. */
    }
  }
  // Do not flash the internal reference while its first streaming line is arriving.
  const prefix = content.trimStart();
  if (prefix.startsWith('<group_reply') && !/[>\n]/.test(prefix) && prefix.length < 256) {
    return { content: '' };
  }
  return { content };
}

/** A readable body reference, not a new message field or a scheduling instruction. */
export function parseMessageQuote(content: string): { content: string; quote?: MessageQuote } {
  const match = quotePattern.exec(content);
  if (!match) return { content };
  try {
    const id = decodeURIComponent(match[2]);
    if (!id || /[\s#/?]/.test(id)) return { content };
    return {
      content: [
        content.slice(0, match.index).trimEnd(),
        content.slice(match.index + match[0].length).trimStart(),
      ]
        .filter(Boolean)
        .join('\n\n'),
      quote: { excerpt: match[3], id, name: match[1] },
    };
  } catch {
    return { content };
  }
}

export function appendMessageQuote(editor: LexicalEditor, quote: MessageQuote) {
  const name = singleLine(quote.name).replaceAll('」', '') || '群成员';
  const excerpt = singleLine(quote.excerpt).slice(0, 240) || '[附件消息]';
  // Markdown serialization escapes underscores in plain text. Percent-encode
  // them here so the persisted ID survives both rich and markdown renderers.
  const encodedId = encodeURIComponent(quote.id).replaceAll('_', '%5F');
  const text = `引用消息「${name}」〔${encodedId}〕：${excerpt}`;
  editor.update(
    () => {
      const root = $getRoot();
      // Replace only an earlier reference paragraph; never round-trip the rich draft.
      const previous = root.getChildren().find((node) => {
        const parsed = parseMessageQuote(node.getTextContent());
        return parsed.quote && !parsed.content;
      });
      const paragraph = $createParagraphNode().append($createTextNode(text));
      if (previous) previous.replace(paragraph);
      else root.append(paragraph);
      const last = root.getLastChild();
      const reply =
        $isElementNode(last) && last.getType() === 'paragraph' && !last.getTextContent()
          ? last
          : $createParagraphNode();
      if (reply !== last) root.append(reply);
      reply.selectEnd();
    },
    { discrete: true },
  );
}

/** Presentation only: the standard paragraph still participates in draft/save/send/undo. */
export function observeMessageQuote(
  editor: LexicalEditor,
  onChange: (quote?: MessageQuote) => void,
) {
  let hidden: HTMLElement | null = null;
  const restore = () => {
    if (hidden) {
      hidden.hidden = false;
      hidden.removeAttribute('data-group-draft-reference');
      hidden = null;
    }
  };
  const sync = () =>
    editor.getEditorState().read(() => {
      restore();
      const node = $getRoot()
        .getChildren()
        .find((child) => {
          if (!$isParagraphNode(child)) return false;
          const parsed = parseMessageQuote(child.getTextContent());
          return parsed.quote && !parsed.content;
        });
      const quote = node ? parseMessageQuote(node.getTextContent()).quote : undefined;
      hidden = node ? editor.getElementByKey(node.getKey()) : null;
      if (hidden) {
        hidden.hidden = true;
        hidden.setAttribute('data-group-draft-reference', '');
      }
      onChange(quote);
    });
  const unsubscribe = editor.registerUpdateListener(sync);
  const unsubscribeRoot = editor.registerRootListener(sync);
  return () => {
    unsubscribe();
    unsubscribeRoot();
    restore();
  };
}

export function removeMessageQuote(editor: LexicalEditor, id: string) {
  editor.update(
    () => {
      for (const node of $getRoot().getChildren()) {
        if (!$isParagraphNode(node)) continue;
        const parsed = parseMessageQuote(node.getTextContent());
        if (parsed.quote?.id === id && !parsed.content) node.remove();
      }
      if (!$getRoot().getChildrenSize()) $getRoot().append($createParagraphNode());
    },
    { discrete: true },
  );
}

/** Keep rich text/mentions intact while moving the reference below the bubble. */
export function withoutQuoteParagraph(editorData: Record<string, any> | undefined, id: string) {
  if (!Array.isArray(editorData?.root?.children)) return editorData;
  return {
    ...editorData,
    root: {
      ...editorData.root,
      children: editorData.root.children.filter((node: any) => {
        if (
          node.type !== 'paragraph' ||
          !node.children?.every((child: any) => child.type === 'text')
        )
          return true;
        const parsed = parseMessageQuote(node.children.map((child: any) => child.text).join(''));
        return parsed.quote?.id !== id || Boolean(parsed.content);
      }),
    },
  };
}
