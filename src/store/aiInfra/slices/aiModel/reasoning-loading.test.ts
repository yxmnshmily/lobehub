/**
 * @vitest-environment happy-dom
 */
import { renderHook, waitFor } from '@testing-library/react';
import { act, createElement, type PropsWithChildren, Suspense } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { aiModelService } from '@/services/aiModel';

import { useAiInfraStore } from '../../store';

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => undefined,
}));

afterEach(() => vi.restoreAllMocks());

describe('reasoning config suspense loading', () => {
  it('keeps the chat mounted while optional model preferences are still loading', async () => {
    let resolveConfig!: (value: {}) => void;
    vi.spyOn(aiModelService, 'getAiModelReasoningConfig').mockReturnValue(
      new Promise((resolve) => {
        resolveConfig = resolve;
      }),
    );
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(
        SWRConfig,
        { value: { provider: () => new Map(), suspense: true, shouldRetryOnError: false } },
        createElement(Suspense, { fallback: 'Loading entire chat' }, children),
      );
    const { result } = renderHook(
      () => {
        const { data, isLoading } = useAiInfraStore
          .getState()
          .useFetchAiModelReasoningConfig('slow-model', 'openai');
        return { data, isLoading };
      },
      { wrapper },
    );
    const mountedWhilePending = result.current !== null;
    await act(async () => {
      resolveConfig({});
    });
    expect(mountedWhilePending).toBe(true);
    await waitFor(() => expect(result.current.data).toEqual({}));
  });

  it('renders controls when the user has no custom reasoning configuration', async () => {
    vi.spyOn(aiModelService, 'getAiModelReasoningConfig').mockResolvedValue(undefined);

    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(
        SWRConfig,
        { value: { provider: () => new Map(), suspense: true, shouldRetryOnError: false } },
        createElement(Suspense, { fallback: 'Loading reasoning' }, children),
      );
    let result: { current: { data?: unknown } | null } = { current: null };
    await act(async () => {
      result = renderHook(
        () => {
          const { data } = useAiInfraStore
            .getState()
            .useFetchAiModelReasoningConfig('deepseek-v4-flash', 'deepseek');
          return { data };
        },
        { wrapper },
      ).result;
    });
    await waitFor(() => expect(result.current?.data).toEqual({}));
  });
});
