import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePrefetchGroup } from './usePrefetchGroup';

const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  mutate: vi.fn(),
  topics: vi.fn(),
  participants: vi.fn(),
}));
vi.mock('swr', () => ({ useSWRConfig: () => ({ mutate: mocks.mutate }) }));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => null,
}));
vi.mock('@/services/chatGroup', () => ({ chatGroupService: { getGroupDetail: mocks.detail } }));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    useUtils: () => ({
      groupConversation: { listTopics: { prefetch: mocks.topics } },
      groupMembership: { listParticipants: { prefetch: mocks.participants } },
    }),
  },
}));

describe('group navigation prefetch', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.detail.mockResolvedValue({ id: 'owner' });
    mocks.mutate.mockImplementation(async (_key, data) => data);
    mocks.topics.mockResolvedValue(undefined);
    mocks.participants.mockResolvedValue(undefined);
  });

  it('warms owner detail once for repeated hover/focus without changing active stores', async () => {
    const { result } = renderHook(usePrefetchGroup);
    await act(async () => {
      await Promise.all([result.current('owner', 'owner'), result.current('owner', 'owner')]);
    });
    expect(mocks.detail).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledWith(['group:detail', 'owner'], expect.any(Promise), {
      revalidate: false,
    });
    expect(mocks.topics).not.toHaveBeenCalled();
  });

  it('warms member queries with the exact consumer keys, without fetching private owner config', async () => {
    const { result } = renderHook(usePrefetchGroup);
    await act(async () => {
      await result.current('joined', 'member');
    });
    expect(mocks.topics).toHaveBeenCalledWith(
      { groupId: 'joined', limit: 20, recent: true },
      expect.objectContaining({ retry: false }),
    );
    expect(mocks.participants).toHaveBeenCalledWith(
      { groupId: 'joined', limit: 50, offset: 0 },
      expect.objectContaining({ retry: false }),
    );
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it('swallows speculative failures and allows retry on the next intent', async () => {
    mocks.detail.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(usePrefetchGroup);
    await act(async () => {
      await expect(result.current('owner', 'owner')).resolves.toBeUndefined();
      await result.current('owner', 'owner');
    });
    expect(mocks.detail).toHaveBeenCalledTimes(2);
  });
});
