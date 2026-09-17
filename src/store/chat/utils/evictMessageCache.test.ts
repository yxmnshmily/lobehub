import { beforeEach, describe, expect, it, vi } from 'vitest';

import { evictMessageCache } from './evictMessageCache';

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  mutate: vi.fn().mockResolvedValue(undefined),
  state: { dbMessagesMap: {} as Record<string, any[]>, messagesMap: {} as Record<string, any[]> },
}));
vi.mock('@/libs/swr', () => ({ mutate: mocks.mutate }));
vi.mock('@/services/message/cache', () => ({ invalidateMessageListClientState: mocks.invalidate }));
vi.mock('@/store/chat', () => ({
  useChatStore: {
    setState: (update: any) => Object.assign(mocks.state, update(mocks.state)),
  },
}));

describe('deleted conversation cache eviction', () => {
  beforeEach(() => vi.clearAllMocks());
  it('drops deleted group timeline and topic buckets while retaining another group', async () => {
    const target = [{ id: 'm', groupId: 'g1', topicId: 't1' }];
    const other = [{ id: 'other', groupId: 'g2', topicId: 't2' }];
    mocks.state = {
      dbMessagesMap: { timeline: target, topic: target, other },
      messagesMap: { timeline: target, topic: target, other },
    };
    const predicate = (ctx: any) => ctx.topicId === 't1' || ctx.groupId === 'g1';
    const pending = evictMessageCache(predicate);
    expect(mocks.invalidate).toHaveBeenCalledWith(predicate);
    await pending;
    expect(mocks.state.dbMessagesMap).toEqual({ other });
    expect(mocks.state.messagesMap).toEqual({ other });
    const filter = mocks.mutate.mock.calls[0][0];
    expect(filter(['message:list', { groupId: 'g1', topicId: null }])).toBe(true);
    expect(filter(['message:list', { groupId: 'g2', topicId: null }])).toBe(false);
  });
});
