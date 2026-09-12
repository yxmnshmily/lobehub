/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMyTravelGroupReadiness } from './useMyTravelGroupReadiness';

const mocks = vi.hoisted(() => ({
  activeWorkspaceId: undefined as string | undefined,
  ensure: vi.fn(),
  get: vi.fn(),
  isLogin: true,
  mutate: vi.fn(),
  refreshAgentList: vi.fn(),
  swr: { data: undefined as any, error: undefined as unknown },
  swrCall: vi.fn(),
  userId: 'user-a' as string | undefined,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => mocks.activeWorkspaceId,
}));
vi.mock('@/libs/swr', () => ({
  useClientDataSWR: (key: unknown, fetcher: unknown) => {
    mocks.swrCall(key, fetcher);
    return { ...mocks.swr, mutate: mocks.mutate };
  },
}));
vi.mock('@/services/home', () => ({
  homeService: {
    ensureMyTravelServiceReady: mocks.ensure,
    getMyTravelGroupReadiness: mocks.get,
  },
}));
vi.mock('@/store/home', () => ({
  getHomeStoreState: () => ({ refreshAgentList: mocks.refreshAgentList }),
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) =>
    selector({ isSignedIn: mocks.isLogin, user: mocks.userId ? { id: mocks.userId } : undefined }),
}));
vi.mock('@/store/user/selectors', () => ({
  authSelectors: { isLogin: (state: any) => state.isSignedIn },
  userProfileSelectors: { userId: (state: any) => state.user?.id },
}));

describe('useMyTravelGroupReadiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeWorkspaceId = undefined;
    mocks.isLogin = true;
    mocks.userId = 'user-a';
    mocks.swr = { data: undefined, error: undefined };
    mocks.ensure.mockResolvedValue({ groupId: 'group-a', status: 'ready' });
    mocks.mutate.mockResolvedValue(undefined);
    mocks.refreshAgentList.mockResolvedValue(undefined);
  });

  it('partitions the query by user and disables it after logout or in a workspace', () => {
    const { rerender } = renderHook(() => useMyTravelGroupReadiness());
    expect(mocks.swrCall).toHaveBeenLastCalledWith(
      ['home:my-travel-group-readiness', 'user-a'],
      expect.any(Function),
    );

    mocks.userId = 'user-b';
    rerender();
    expect(mocks.swrCall).toHaveBeenLastCalledWith(
      ['home:my-travel-group-readiness', 'user-b'],
      expect.any(Function),
    );

    mocks.isLogin = false;
    rerender();
    expect(mocks.swrCall).toHaveBeenLastCalledWith(null, expect.any(Function));

    mocks.isLogin = true;
    mocks.activeWorkspaceId = 'workspace-1';
    rerender();
    expect(mocks.swrCall).toHaveBeenLastCalledWith(null, expect.any(Function));
  });

  it('automatically prepares once and coalesces repeated retries', async () => {
    let release!: (value: any) => void;
    mocks.swr.data = { status: 'preparing' };
    mocks.ensure.mockImplementation(() => new Promise((resolve) => (release = resolve)));

    const { result, rerender } = renderHook(() => useMyTravelGroupReadiness());
    await waitFor(() => expect(mocks.ensure).toHaveBeenCalledTimes(1));
    rerender();
    expect(mocks.ensure).toHaveBeenCalledTimes(1);

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = result.current.retry();
      second = result.current.retry();
    });
    expect(first).toBe(second);
    expect(mocks.ensure).toHaveBeenCalledTimes(1);

    await act(async () => release({ groupId: 'group-a', status: 'ready' }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mocks.refreshAgentList).toHaveBeenCalledTimes(1);
  });

  it('can prepare an embedded group without refreshing the unrelated agent list', async () => {
    mocks.swr.data = { groupId: 'group-a', status: 'ready' };

    const { result } = renderHook(() => useMyTravelGroupReadiness({ refreshAgentList: false }));

    await waitFor(() => expect(result.current.groupId).toBe('group-a'));
    expect(mocks.refreshAgentList).not.toHaveBeenCalled();
  });

  it('turns a list/query failure into a retryable state instead of endless preparation', () => {
    mocks.swr.error = new Error('network down');
    const { result } = renderHook(() => useMyTravelGroupReadiness());

    expect(result.current.status).toBe('retryable_error');
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it('does not refresh the next account when an old account retry resolves late', async () => {
    let release!: (value: any) => void;
    mocks.swr.data = { status: 'preparing' };
    mocks.ensure.mockImplementation(() => new Promise((resolve) => (release = resolve)));

    const { rerender } = renderHook(() => useMyTravelGroupReadiness());
    await waitFor(() => expect(mocks.ensure).toHaveBeenCalledTimes(1));
    mocks.userId = 'user-b';
    mocks.swr.data = { status: 'review_required' };
    rerender();

    await act(async () => release({ groupId: 'group-a', status: 'ready' }));
    expect(mocks.refreshAgentList).not.toHaveBeenCalled();
  });

  it('clears local lifecycle state on logout before the same account signs in again', async () => {
    mocks.swr.data = { status: 'preparing' };
    const { rerender, result } = renderHook(() => useMyTravelGroupReadiness());
    await waitFor(() => expect(mocks.ensure).toHaveBeenCalledTimes(1));

    mocks.isLogin = false;
    rerender();
    expect(result.current.status).toBeUndefined();

    mocks.isLogin = true;
    rerender();
    await waitFor(() => expect(mocks.ensure).toHaveBeenCalledTimes(2));
  });
});
