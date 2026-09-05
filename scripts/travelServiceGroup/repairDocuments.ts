import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import { sql } from 'drizzle-orm';

import {
  parseTravelDocumentRepairArgs,
  runTravelDocumentRepair,
  type TravelDocumentRepairCandidate,
} from './repairDocumentsCore';

const environment = process.env.NODE_ENV || 'development';
dotenvExpand.expand(dotenv.config());
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${environment}` }));
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${environment}.local` }));

const fail = (message: string): never => {
  console.error(`Travel document repair failed: ${message}`);
  process.exit(1);
};

const normalizeTitle = (value: string | null): string => {
  const normalized = [...(value || '旅游文档').replaceAll(/[\\/]/g, ' ')]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127 ? ' ' : character;
    })
    .join('')
    .replaceAll(/[<>:"|?*]/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .replaceAll(/^\.+|\.+$/g, '')
    .trim()
    .slice(0, 120);
  return normalized || '旅游文档';
};

const createPortableEditorData = (documentId: string, content: string) => ({
  root: {
    children: content.split('\n').map((line, index) => ({
      children: line
        ? [
            {
              detail: 0,
              format: 0,
              id: `${documentId}-text-${index}`,
              mode: 'normal',
              style: '',
              text: line,
              type: 'text',
              version: 1,
            },
          ]
        : [],
      direction: null,
      format: '',
      id: `${documentId}-paragraph-${index}`,
      indent: 0,
      textFormat: 0,
      textStyle: '',
      type: 'paragraph',
      version: 1,
    })),
    direction: null,
    format: '',
    id: 'root',
    indent: 0,
    type: 'root',
    version: 1,
  },
});

const main = async () => {
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is not configured');
  let args;
  try {
    args = parseTravelDocumentRepairArgs(process.argv.slice(2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const { serverDB } = await import('../../packages/database/src/server');

  const result = await runTravelDocumentRepair(args, {
    canRepair: async (userId) => {
      const accountResult = await serverDB.execute(sql`
        SELECT ban_expires, banned, email_verified
        FROM users
        WHERE id = ${userId}
        LIMIT 1
      `);
      if (accountResult.rows.length !== 1) return false;

      const account = accountResult.rows[0] as Record<string, unknown>;
      const banExpires = account.ban_expires ? new Date(String(account.ban_expires)) : null;
      const activeBan =
        account.banned === true && (!banExpires || banExpires.getTime() > Date.now());
      return account.email_verified === true && !activeBan;
    },
    listDocuments: async (userId) => {
      const legacyResult = await serverDB.execute(sql`
        SELECT id, content, filename, file_type, source, title, user_id
        FROM documents
        WHERE user_id = ${userId}
          AND source = 'travel-generation'
          AND file_type = 'markdown'
      `);
      return legacyResult.rows.map((rawRow) => {
        const row = rawRow as Record<string, unknown>;
        return {
          content: (row.content as null | string) ?? null,
          filename: (row.filename as null | string) ?? null,
          fileType: String(row.file_type),
          id: String(row.id),
          source: String(row.source),
          title: (row.title as null | string) ?? null,
          userId: String(row.user_id),
        } satisfies TravelDocumentRepairCandidate;
      });
    },
    repair: async (row) => {
      const content = row.content ?? '';
      const title = normalizeTitle(row.title ?? row.filename ?? null);
      const editorData = JSON.stringify(createPortableEditorData(row.id, content));
      const updated = await serverDB.execute(sql`
        UPDATE documents
        SET editor_data = ${editorData}::jsonb,
            file_type = 'custom/document',
            filename = ${title},
            source_type = 'api',
            title = ${title},
            total_char_count = ${content.length},
            total_line_count = ${content.split('\n').length},
            updated_at = NOW()
        WHERE id = ${row.id}
          AND user_id = ${args.userId}
          AND source = 'travel-generation'
          AND file_type = 'markdown'
        RETURNING id
      `);
      return updated.rows.length === 1;
    },
  });
  console.log(JSON.stringify(result));
};

void main().catch(() => fail('operation failed'));
