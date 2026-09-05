import { describe, expect, it } from 'vitest';

import { buildTopicByline } from './topicByline';

describe('buildTopicByline', () => {
  it('uses the tourism supervisor name for a shared inbox topic', () => {
    expect(
      buildTopicByline({
        agentId: 'inbox',
        agentMeta: { slug: 'inbox' },
        groupId: null,
        shareId: 'share-1',
        title: '行程讨论',
        topicId: 'topic-1',
        visibility: 'public',
      }),
    ).toBe('旅游群主AI');
  });

  it('keeps a shared group title ahead of the inbox fallback', () => {
    expect(
      buildTopicByline({
        agentId: 'inbox',
        agentMeta: { slug: 'inbox' },
        groupId: 'group-1',
        groupMeta: { title: '西北线团队' },
        shareId: 'share-1',
        title: '行程讨论',
        topicId: 'topic-1',
        visibility: 'public',
      }),
    ).toBe('西北线团队');
  });
});
