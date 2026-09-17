import { LOADING_FLAT } from '@lobechat/const';
import type { UIChatMessage } from '@lobechat/types';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

import { parseAgentMessageQuote, parseMessageQuote } from '@/features/SuperGroup/messageQuote';
import { cleanSpeakerTag } from '@/store/chat/utils/cleanSpeakerTag';
import { unescapeMarkdown } from '@/store/chat/utils/unescapeMarkdown';

export interface MessageDownload {
  name: string;
  url: string;
}

/** Export visible prose only; tool results/reasoning are not the reply body. */
export const getMessageExportText = (
  data: UIChatMessage,
  options: { stripGroupQuote?: boolean } = {},
): string => {
  const { stripGroupQuote = true } = options;
  const blocks = data.children?.length ? data.children : [data];
  return blocks
    .map(({ content }) => {
      if (!content || content === LOADING_FLAT) return '';
      const text = stripGroupQuote
        ? parseMessageQuote(parseAgentMessageQuote(content).content).content
        : content;
      return data.role === 'user' ? unescapeMarkdown(cleanSpeakerTag(text)) : text;
    })
    .filter(Boolean)
    .join('\n\n');
};

const fileExtension =
  /\.(?:png|jpe?g|gif|webp|avif|svg|mp4|webm|mov|m4v|mp3|wav|ogg|m4a|pdf|txt|md|csv|docx?|xlsx?|pptx?|zip)$/i;

/** Inspect rendered attachments/Markdown, never arbitrary tool JSON or code fences. */
export const getMessageDownloads = (data: UIChatMessage): MessageDownload[] => {
  const files = new Map<string, MessageDownload>();
  const add = (url: string, name?: string) => {
    if (
      !url ||
      Array.from(url).some((char) => char.charCodeAt(0) <= 32) ||
      !/^(?:https?:\/\/|\/(?!\/)|blob:|data:(?:image|audio|video)\/)/i.test(url)
    )
      return;
    try {
      new URL(url, 'https://local.invalid');
    } catch {
      return;
    }
    if (files.has(url)) return;
    let filename = name || (/^(?:data:|blob:)/i.test(url) ? '媒体文件' : undefined);
    if (!filename) {
      try {
        filename = decodeURIComponent(
          new URL(url, 'https://local.invalid').pathname.split('/').pop() || '文件',
        );
      } catch {
        filename = '文件';
      }
    }
    files.set(url, { name: filename, url });
  };
  for (const block of [data, ...(data.children ?? [])]) {
    for (const file of block.fileList ?? [])
      if (!file.inaccessible) add(file.downloadUrl || file.url, file.name);
    for (const image of block.imageList ?? []) add(image.url, image.alt);
  }
  for (const file of [...(data.videoList ?? []), ...(data.audioList ?? [])])
    add(file.url, file.alt);

  // Parse on demand when opening Download, not while rendering every message.
  const source = [data.content, ...(data.children ?? []).map((block) => block.content)]
    .filter(Boolean)
    .join('\n\n');
  const tree = unified().use(remarkParse).parse(source);
  const definitions = new Map<string, string>();
  visit(tree, 'definition', (node) => {
    definitions.set(node.identifier, node.url);
  });
  visit(tree, (node) => {
    if (
      node.type === 'image' ||
      node.type === 'imageReference' ||
      node.type === 'link' ||
      node.type === 'linkReference'
    ) {
      const url = 'url' in node ? node.url : definitions.get(node.identifier);
      if (!url) return;
      if (
        node.type.startsWith('image') ||
        fileExtension.test(url.split(/[?#]/)[0]) ||
        /^\/f\/[^/?#]+(?:[?#]|$)/.test(url)
      )
        add(url);
    }
    if (node.type === 'html' && typeof DOMParser !== 'undefined') {
      const document = new DOMParser().parseFromString(node.value, 'text/html');
      for (const media of document.querySelectorAll('img[src],video[src],audio[src],source[src]'))
        add(media.getAttribute('src') || '');
    }
  });
  return [...files.values()];
};
