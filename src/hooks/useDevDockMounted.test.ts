/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useDevDockMounted } from './useDevDockMounted';

describe('useDevDockMounted', () => {
  it('keeps web development tools disabled', () => {
    const { result } = renderHook(() => useDevDockMounted());

    expect(result.current).toBe(false);
  });
});
