import { act, render, screen, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import useSWR from 'swr';
import { describe, expect, it, vi } from 'vitest';

import { notifyMaterialDeletion } from '@/utils/materialDeletion';

import QueryProvider from './Query';

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => null,
  useActiveWorkspaceId: () => null,
}));
vi.mock('@/libs/swr/cacheHydration', () => ({
  cacheHydration: { markReady: vi.fn() },
}));
vi.mock('@/libs/swr/localStorageProvider', () => ({
  swrCacheProvider: () => () => new Map(),
}));
vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => 'test',
  useCacheScope: () => 'test',
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: { Provider: ({ children }: PropsWithChildren) => children },
  lambdaQueryClient: {},
}));

describe('material deletion reconciliation', () => {
  it.each(['resource:recentPages', 'resource:recentFiles'])(
    'keeps %s cards mounted while fetching the deletion result',
    async (key) => {
      let resolveRefresh!: (items: string[]) => void;
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(['deleted', 'remaining'])
        .mockImplementationOnce(
          () =>
            new Promise<string[]>((resolve) => {
              resolveRefresh = resolve;
            }),
        );
      const List = () => {
        const { data } = useSWR<string[]>([key], fetcher);
        return (
          <div data-testid="scroll">
            {data ? data.map((id) => <div key={id}>{id}</div>) : 'loading'}
          </div>
        );
      };
      const view = render(
        <QueryProvider>
          <List />
        </QueryProvider>,
      );
      const remaining = await screen.findByText('remaining');
      const scroll = screen.getByTestId('scroll');
      scroll.scrollTop = 120;

      act(() => notifyMaterialDeletion());
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
      expect(screen.queryByText('loading')).not.toBeInTheDocument();
      expect(screen.getByText('remaining')).toBe(remaining);

      await act(async () => resolveRefresh(['remaining']));
      expect(screen.queryByText('deleted')).not.toBeInTheDocument();
      expect(screen.getByText('remaining')).toBe(remaining);
      expect(screen.getByTestId('scroll')).toBe(scroll);
      expect(scroll.scrollTop).toBe(120);
      view.unmount();
    },
  );
});
