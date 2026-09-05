import { renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { usePageHref } from './usePageHref';

describe('usePageHref', () => {
  it('keeps the LobeHub mount prefix', () => {
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(
        MemoryRouter,
        { basename: '/lobehub', initialEntries: ['/lobehub/page/current'] },
        children,
      );

    const { result } = renderHook(() => usePageHref('next'), { wrapper });

    expect(result.current).toBe('/lobehub/page/next');
  });
});
