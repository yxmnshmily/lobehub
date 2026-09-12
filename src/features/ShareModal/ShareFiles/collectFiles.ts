import type { UIChatMessage } from '@lobechat/types';

import { parseInternalLink } from '@/features/Conversation/Markdown/plugins/Link/internalLink';

export interface ExportAttachment {
  category?: ContentCategory;
  createdAt?: UIChatMessage['createdAt'];
  documentId?: string;
  name: string;
  url?: string;
}

export type ContentCategory = 'images' | 'text' | 'media' | 'documents' | 'other';

const safeUrl = (url: string) =>
  /^(?:https?:\/\/|\/(?![/\\]))/i.test(url) &&
  !url.includes('\\') &&
  !Array.from(url).some((char) => char.charCodeAt(0) < 32);

export const classifyFile = (name: string, url = '', mime = ''): ContentCategory => {
  const type = mime.toLowerCase().split(';')[0];
  const path = `${name.split(/[?#]/)[0]} ${url.split(/[?#]/)[0]}`;
  if (
    type.startsWith('image/') ||
    /\.(?:png|jpe?g|webp|gif|svg|avif|heic|bmp|tiff?)(?:\s|$)/i.test(path)
  )
    return 'images';
  if (
    /^(?:audio|video)\//.test(type) ||
    /\.(?:mp[34]|m4[av]|mov|webm|ogg|ogv|wav|flac|aac|avi|mkv)(?:\s|$)/i.test(path)
  )
    return 'media';
  if (
    /\.(?:pdf|docx?|xlsx?|pptx?|od[tsfp]|rtf|epub)(?:\s|$)/i.test(path) ||
    /pdf|word|officedocument|ms-excel|ms-powerpoint|opendocument|rtf|epub/.test(type)
  )
    return 'documents';
  if (type.startsWith('text/') || /\.(?:txt|md|markdown|csv)(?:\s|$)/i.test(path)) return 'text';
  return 'other';
};

export const collectFiles = (messages: UIChatMessage[]): ExportAttachment[] => {
  const files = new Map<string, ExportAttachment>();
  const addFile = (file: ExportAttachment) => {
    const key = file.documentId || file.url;
    if (key && (file.documentId || (file.url && safeUrl(file.url))) && !files.has(key))
      files.set(key, file);
  };
  const visit = (message: Partial<UIChatMessage>) => {
    if (message.role === 'system') return;
    const add = (file: ExportAttachment) =>
      addFile(message.createdAt == null ? file : { ...file, createdAt: message.createdAt });
    for (const file of message.fileList || []) {
      if (!file.inaccessible)
        add({
          category: classifyFile(file.name, file.url, file.fileType),
          name: file.name,
          url: file.downloadUrl || file.url,
        });
    }
    for (const image of message.imageList || [])
      add({ category: 'images', name: image.alt || image.id, url: image.url });
    for (const media of [...(message.audioList || []), ...(message.videoList || [])])
      add({ category: 'media', name: media.alt || media.id, url: media.url });
    for (const match of (message.content || '').matchAll(/\[([^\]]+)\]\(([^\s)]+)\)/g)) {
      const [, name, url] = match;
      if (!safeUrl(url)) continue;
      const reference = parseInternalLink(url, globalThis.location?.origin);
      if (reference?.type === 'document')
        add({ category: 'documents', documentId: reference.documentId, name });
      else if (
        /\.(?:pdf|docx?|xlsx?|pptx?|od[tsfp]|rtf|epub|csv|txt|md|markdown|zip|rar|7z|json|png|jpe?g|webp|gif|svg|avif|heic|bmp|tiff?|mp[34]|m4[av]|mov|webm|ogg|ogv|wav|flac|aac|avi|mkv)(?:[?#]|$)/i.test(
          url,
        )
      )
        add({ category: classifyFile(name, url), name, url });
    }
    for (const child of [...(message.children || []), ...(message.taskCompletions || [])]) {
      visit({
        content: child.content,
        fileList: child.fileList,
        imageList: child.imageList,
        createdAt: message.createdAt,
      });
      child.council?.forEach(visit);
    }
    for (const child of [
      ...(message.members || []),
      ...(message.tasks || []),
      ...(message.compressedMessages || []),
    ])
      visit(child);
  };
  messages.forEach(visit);
  return [...files.values()];
};
