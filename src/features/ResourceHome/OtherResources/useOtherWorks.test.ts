import { expect, it, vi } from 'vitest';

import { fetchOtherWorks } from './useOtherWorks';

const list = vi.hoisted(() => vi.fn());
vi.mock('@/services/work', () => ({ workService: { listByWorkspace: list } }));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({ useActiveWorkspaceId: vi.fn() }));
vi.mock('@/libs/swr', () => ({ useClientDataSWR: vi.fn() }));
vi.mock('@/libs/swr/useCacheScope', () => ({ useCacheScope: vi.fn() }));
it('collects every page using the same document scope as the Other gallery', async () => {
  list
    .mockResolvedValueOnce({ items: [{ id: 'a' }], nextCursor: 'next' })
    .mockResolvedValueOnce({ items: [{ id: 'b' }], nextCursor: null });
  expect(await fetchOtherWorks()).toEqual([{ id: 'a' }, { id: 'b' }]);
  expect(list).toHaveBeenNthCalledWith(2, {
    type: 'document',
    limit: 100,
    cursor: 'next',
    visibility: undefined,
  });
});
