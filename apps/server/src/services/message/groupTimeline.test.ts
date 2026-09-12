// @vitest-environment node
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';

describe('group timeline queries', () => {
  it('reads across topics only when the server opts into the group timeline', async () => {
    const model = new MessageModel({} as any, 'owner');
    const query = vi.spyOn(model, 'queryWithWhere').mockResolvedValue([]);
    await model.query({ groupId: 'group-a' }, { groupTimeline: true });
    const timeline = new PgDialect().sqlToQuery(query.mock.calls[0]![0]!.where!);
    expect(timeline.params).toEqual(['group-a']);
    expect(timeline.sql).not.toContain('topic_id');
    expect(query.mock.calls[0]![0]).toMatchObject({ groupId: 'group-a', allowShareVisitor: false });

    await model.query({ groupId: 'group-a' });
    const ordinary = new PgDialect().sqlToQuery(query.mock.calls[1]![0]!.where!);
    expect(ordinary.sql).toContain('topic_id');
    expect(query.mock.calls[1]![0]?.groupId).toBeUndefined();
  });

  it('includes historical compressed message groups even without a selected topic', async () => {
    const model = new MessageModel({} as any, 'owner') as any;
    const node = { id: 'compressed-history' };
    const query = vi.spyOn(model, 'queryMessageGroupNodes').mockResolvedValue([node]);
    const result = await model.queryMessageGroupNodesForPage({
      current: 0,
      groupId: 'group-a',
      result: [],
      allowShareVisitor: false,
    });
    expect(result).toEqual([node]);
    expect(query).toHaveBeenCalledWith(undefined, undefined, undefined, undefined, {
      groupId: 'group-a',
      allowShareVisitor: false,
    });
  });
});
