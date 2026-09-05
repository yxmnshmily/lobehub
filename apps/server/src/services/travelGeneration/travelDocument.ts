import { CUSTOM_DOCUMENT_FILE_TYPE } from '@lobechat/const/agentDocument';

import { DocumentModel } from '@/database/models/document';
import type { LobeChatDatabase } from '@/database/type';
import { createMarkdownEditorSnapshot } from '@/server/services/agentDocuments/headlessEditor';
import { sanitizeFileName } from '@/utils/sanitizeFileName';

const LEGACY_TRAVEL_DOCUMENT_FILE_TYPE = 'markdown';
const TRAVEL_DOCUMENT_SOURCE = 'travel-generation';

const preserveHtmlAsMarkdownText = (content: string): string =>
  content.replaceAll(/<(?:\/?[a-z]|!)[^>]*>/gi, (tag) =>
    tag.replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  );

export const normalizeTravelDocumentTitle = (title: string): string => {
  const withoutControlCharacters = [...title.replaceAll(/[\\/]/g, ' ')]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127 ? ' ' : character;
    })
    .join('');
  const readable = withoutControlCharacters
    .replaceAll(/\s+/g, ' ')
    .trim()
    .replaceAll(/^\.+|\.+$/g, '')
    .trim();
  const normalized = sanitizeFileName(readable, '旅游文档', 120)
    .replaceAll(/^_+|_+$/g, '')
    .trim();

  return normalized || '旅游文档';
};

export const createTravelDocumentPage = async (params: {
  content: string;
  db: LobeChatDatabase;
  title: string;
  userId: string;
  workspaceId?: string;
}) => {
  const title = normalizeTravelDocumentTitle(params.title);
  const snapshot = await createMarkdownEditorSnapshot(preserveHtmlAsMarkdownText(params.content));

  return new DocumentModel(params.db, params.userId, params.workspaceId).create({
    content: snapshot.content,
    editorData: snapshot.editorData,
    fileType: CUSTOM_DOCUMENT_FILE_TYPE,
    filename: title,
    source: TRAVEL_DOCUMENT_SOURCE,
    sourceType: 'api',
    title,
    totalCharCount: snapshot.content.length,
    totalLineCount: snapshot.content.split('\n').length,
    visibility: 'private',
  });
};

export const repairLegacyTravelDocuments = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<{ repaired: number }> => {
  const legacyDocuments = await db.query.documents.findMany({
    columns: {
      content: true,
      fileType: true,
      filename: true,
      id: true,
      source: true,
      title: true,
      userId: true,
      workspaceId: true,
    },
    where: (fields, { and, eq }) =>
      and(
        eq(fields.userId, userId),
        eq(fields.source, TRAVEL_DOCUMENT_SOURCE),
        eq(fields.fileType, LEGACY_TRAVEL_DOCUMENT_FILE_TYPE),
      ),
  });

  let repaired = 0;
  for (const document of legacyDocuments) {
    if (
      document.userId !== userId ||
      document.source !== TRAVEL_DOCUMENT_SOURCE ||
      document.fileType !== LEGACY_TRAVEL_DOCUMENT_FILE_TYPE
    ) {
      continue;
    }

    const content = document.content ?? '';
    const snapshot = await createMarkdownEditorSnapshot(content);
    const title = normalizeTravelDocumentTitle(document.title ?? document.filename ?? '旅游文档');
    await new DocumentModel(db, userId, document.workspaceId ?? undefined).update(document.id, {
      editorData: snapshot.editorData,
      fileType: CUSTOM_DOCUMENT_FILE_TYPE,
      filename: title,
      sourceType: 'api',
      title,
      totalCharCount: content.length,
      totalLineCount: content.split('\n').length,
    });
    repaired += 1;
  }

  return { repaired };
};
