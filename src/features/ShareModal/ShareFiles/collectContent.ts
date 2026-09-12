import { type UIChatMessage } from '@lobechat/types';

import { collectFiles, type ContentCategory, type ExportAttachment } from './collectFiles';

export const CONTENT_CATEGORIES = ['all', 'images', 'text', 'media', 'documents', 'other'] as const;
export type ContentFilter = (typeof CONTENT_CATEGORIES)[number];
export interface ArchivedContent extends ExportAttachment {
  category: ContentCategory;
  content?: string;
  messageId?: string;
}

/** Derive from authorized conversation data, never duplicate chat history in another store. */
export const collectContent = (messages: UIChatMessage[]): ArchivedContent[] => {
  const files = collectFiles(messages).map((file) => ({
    ...file,
    category: file.category || ('other' as const),
  }));
  const texts = new Map<string, ArchivedContent>();
  const intermediateIds = new Set<string>();
  const sourceMessages = new Map(
    messages
      .filter((message) => ['assistant', 'supervisor', 'tool'].includes(message.role))
      .map((message) => [message.id, message]),
  );
  // Both tool-anchored and assistant-anchored execution chains can contain prose
  // between steps. A continued assistant step is not a delivered result.
  for (const message of sourceMessages.values()) {
    if (message.role === 'tool') continue;
    let parent = message.parentId ? sourceMessages.get(message.parentId) : undefined;
    const seen = new Set<string>();
    while (parent?.role === 'tool' && !seen.has(parent.id)) {
      seen.add(parent.id);
      parent = parent.parentId ? sourceMessages.get(parent.parentId) : undefined;
    }
    if (parent && ['assistant', 'supervisor'].includes(parent.role)) intermediateIds.add(parent.id);
  }
  const visit = (message: Partial<UIChatMessage>) => {
    const content = message.content?.trim();
    if (
      message.id &&
      (message.tools?.length ||
        message.metadata?.signal?.type === 'tool-stdout' ||
        message.metadata?.signal?.type === 'tool-callback')
    ) {
      intermediateIds.add(message.id);
    }
    if (
      message.id &&
      content &&
      !/^[\s.…⋯*_-]+$/.test(content) &&
      !message.error &&
      (message.role === 'assistant' || message.role === 'supervisor') &&
      !texts.has(message.id)
    ) {
      texts.set(message.id, {
        category: 'text',
        content,
        ...(message.createdAt == null ? {} : { createdAt: message.createdAt }),
        messageId: message.id,
        name: content.split('\n')[0].slice(0, 80),
      });
    }
    const blocks = [...(message.children || []), ...(message.taskCompletions || [])];
    for (const [index, block] of blocks.entries()) {
      if (index < blocks.length - 1) intermediateIds.add(block.id);
      visit({
        id: block.id,
        role: 'assistant',
        content: block.content,
        error: block.error,
        tools: block.tools,
        metadata: block.metadata,
        createdAt: message.createdAt,
      });
      block.council?.forEach(visit);
    }
    for (const child of [
      ...(message.members || []),
      ...(message.tasks || []),
      ...(message.compressedMessages || []),
    ])
      visit(child);
  };
  messages.forEach(visit);
  return [...texts.values()].filter((item) => !intermediateIds.has(item.messageId!)).concat(files);
};

export const filterContent = (items: ArchivedContent[], category: ContentFilter) =>
  category === 'all' ? items : items.filter((item) => item.category === category);
