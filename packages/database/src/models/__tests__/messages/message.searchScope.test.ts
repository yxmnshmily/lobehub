// @vitest-environment node
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { expect, it, vi } from 'vitest';

import { MessageModel } from '../../message';

it('narrows keyword search to the current group without dropping account ownership', async () => {
  const where = vi.fn((_condition: SQL) => ({ orderBy: vi.fn().mockResolvedValue([]) }));
  const db = { select: () => ({ from: () => ({ where }) }) };
  const model = new MessageModel(db as any, 'search-owner');
  await model.queryByKeyword('旅行', 'current-group');
  const query = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
  expect(query.sql).toContain('"messages"."group_id" =');
  expect(query.params).toContain('current-group');
  expect(query.params).toContain('search-owner');
});
