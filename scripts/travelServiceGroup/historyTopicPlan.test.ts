import { describe, expect, it } from 'vitest';

import { planHistoryTopics } from './historyTopicPlan';

describe('historical group topic boundaries', () => {
  const rows = [
    { id: 'hello', role: 'user', content: '哈喽', parent_id: null, thread_id: null },
    { id: 'hello-reply', role: 'assistant', content: '你好', parent_id: 'hello', thread_id: null },
    {
      id: 'plan',
      role: 'user',
      content: '请帮我规划一份多日游行程',
      parent_id: 'hello-reply',
      thread_id: null,
    },
    { id: 'budget', role: 'user', content: '马来西亚，2000元', parent_id: 'plan', thread_id: null },
    {
      id: 'copy',
      role: 'user',
      content: '出个 短视频文案吧',
      parent_id: 'budget',
      thread_id: null,
    },
    {
      id: 'private',
      role: 'user',
      content: '什么叫子话题？',
      parent_id: null,
      thread_id: 'thread',
    },
    {
      id: 'late-reply',
      role: 'assistant',
      content: '行程回复',
      parent_id: 'budget',
      thread_id: null,
    },
    {
      id: 'cover',
      role: 'user',
      content: '根据之前的文案，做一个封面9:16',
      parent_id: 'copy',
      thread_id: null,
    },
    { id: 'retry', role: 'user', content: '继续作封面图', parent_id: 'cover', thread_id: null },
    { id: 'tool', role: 'tool', content: 'image', parent_id: 'retry', thread_id: null },
  ].map((row, i) => ({
    ...row,
    created_at: new Date(1000 + i),
    group_id: row.thread_id ? null : 'group',
  }));

  it('separates requests, retaining follow-ups, late replies and private thread ancestry', () => {
    const plan = planHistoryTopics('old', 'group', rows, [
      { id: 'thread', source_message_id: 'plan' },
    ]);
    expect(plan.boundaries.map((r) => r.id)).toEqual(['plan', 'copy', 'cover']);
    expect([...plan.messageAnchors]).toEqual([
      ['hello', null],
      ['hello-reply', null],
      ['plan', 'plan'],
      ['budget', 'plan'],
      ['copy', 'copy'],
      ['private', 'plan'],
      ['late-reply', 'plan'],
      ['cover', 'cover'],
      ['retry', 'cover'],
      ['tool', 'cover'],
    ]);
  });

  it('does not split an already separated topic again', () => {
    const plan = planHistoryTopics('cover-topic', 'group', rows.slice(7), []);
    expect(plan.boundaries).toEqual([]);
  });

  it('fails closed for orphaned replies instead of guessing by timestamp', () => {
    expect(() =>
      planHistoryTopics('old', 'group', [rows[0], { ...rows[1], parent_id: 'missing' }], []),
    ).toThrow('Unresolved');
  });
});
