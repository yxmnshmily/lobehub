// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { FilesTabs, QueryFileListSchema } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, expect, it } from 'vitest';

import { buildDocumentCategoryFilter, buildFileCategoryFilter } from './fileTypeCategory';

const db = new PGlite();
afterAll(() => db.close());

it('accepts the merged category and the same sort order as the Work cursor', () => {
  expect(
    QueryFileListSchema.parse({ category: FilesTabs.Other, sorter: 'updatedAt' }),
  ).toMatchObject({ category: 'other', sorter: 'updatedAt' });
});

const matches = async (kind: 'file' | 'document', category: FilesTabs, mime: string) => {
  const filter = (kind === 'file' ? buildFileCategoryFilter : buildDocumentCategoryFilter)(
    sql`${mime}::text`,
    category,
  );
  if (filter === 'all' || filter === 'none') return filter === 'all';
  const query = new PgDialect().sqlToQuery(sql`SELECT ${filter} AS matches`);
  return (await db.query<{ matches: boolean }>(query.sql, query.params)).rows[0].matches;
};

it('includes uploaded documents and editor manuscripts in Documents', async () => {
  expect(await matches('file', FilesTabs.Documents, 'application/pdf')).toBe(true);
  expect(await matches('file', FilesTabs.Documents, 'custom/document')).toBe(true);
  expect(await matches('document', FilesTabs.Documents, 'custom/document')).toBe(true);
  expect(await matches('document', FilesTabs.Documents, 'application/pdf')).toBe(true);
  expect(await matches('document', FilesTabs.Documents, 'custom/folder')).toBe(false);
  expect(await matches('file', FilesTabs.Documents, 'image/png')).toBe(false);
});

it('keeps execution text and web clippings out of the All list', async () => {
  // 「全部」只列用户自己的文件与文稿：目标/任务的验收标准（verify/instruction）是
  // 执行过程的沟通文本；网页剪藏（article）属于「网页」分类，两者都不在这里出现。
  expect(await matches('document', FilesTabs.All, 'verify/instruction')).toBe(false);
  expect(await matches('document', FilesTabs.All, 'article')).toBe(false);

  // 真正的文件与文稿仍保留
  for (const mime of ['agent/document', 'custom/document', 'application/pdf']) {
    expect(await matches('document', FilesTabs.All, mime)).toBe(true);
  }
  expect(await matches('file', FilesTabs.All, 'application/pdf')).toBe(true);
});

it('includes raw files and audio, but not images, videos or documents in Other', async () => {
  for (const mime of ['audio/mpeg', 'audio/wav', 'application/zip', 'application/json'])
    expect(await matches('file', FilesTabs.Other, mime)).toBe(true);
  for (const mime of [
    'image/png',
    'video/mp4',
    'application/pdf',
    'custom/document',
    'custom/folder',
  ])
    expect(await matches('file', FilesTabs.Other, mime)).toBe(false);
});

