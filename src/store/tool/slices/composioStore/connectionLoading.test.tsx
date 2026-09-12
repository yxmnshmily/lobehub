import { renderHook, waitFor } from '@testing-library/react';
import { Suspense, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, expect, it, vi } from 'vitest';

import { ComposioStoreActionImpl } from './action';

const state = vi.hoisted(() => ({ configured: false, query: vi.fn() }));
vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: { enableComposio: (s: any) => s.configured },
  useServerConfigStore: (selector: any) => selector(state),
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { composio: { getComposioPlugins: { query: state.query } } },
  toolsClient: {},
}));

const actions = new ComposioStoreActionImpl(vi.fn(), () => ({}) as any);
const wrapper = ({ children }: PropsWithChildren) => (
  <SWRConfig value={{ provider: () => new Map(), suspense: true, shouldRetryOnError: false }}>
    <Suspense fallback={null}>{children}</Suspense>
  </SWRConfig>
);
beforeEach(() => {
  state.configured = false;
  state.query.mockReset().mockResolvedValue([]);
});

it('does not query an unconfigured optional provider even when templates request it', async () => {
  const { result } = renderHook(() => actions.useFetchUserComposioConnections(true), { wrapper });
  expect(result.current).not.toBeNull();
  expect(state.query).not.toHaveBeenCalled();
});

it('keeps connection failures local even inside a suspense route', async () => {
  state.configured = true;
  const error = new Error('optional provider unavailable');
  state.query.mockRejectedValue(error);
  const { result } = renderHook(() => actions.useFetchUserComposioConnections(true), { wrapper });
  await waitFor(() => expect(result.current.error).toBe(error));
});

it('loads configured connections but respects a disabled caller', async () => {
  state.configured = true;
  const { result, rerender } = renderHook(
    (enabled) => actions.useFetchUserComposioConnections(enabled),
    { wrapper, initialProps: false },
  );
  expect(state.query).not.toHaveBeenCalled();
  rerender(true);
  await waitFor(() => expect(result.current.data).toEqual([]));
  expect(state.query).toHaveBeenCalledOnce();
});
