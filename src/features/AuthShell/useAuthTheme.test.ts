import { act, renderHook, waitFor } from '@testing-library/react';
import { ThemeProvider } from 'next-themes';
import { createElement, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useAuthTheme } from './useAuthTheme';

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(ThemeProvider, { attribute: 'data-theme', defaultTheme: 'system' }, children);

beforeEach(() => {
  window.history.replaceState({}, '', '/lobehub/signin');
});

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('useAuthTheme', () => {
  it('uses the public website theme when the auth page opens', async () => {
    window.localStorage.setItem('techarin-color-theme', 'dark');

    renderHook(() => useAuthTheme(), { wrapper });

    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'dark'));
  });

  it('keeps the website theme on the reset-password page', async () => {
    window.history.replaceState({}, '', '/lobehub/reset-password');
    window.localStorage.setItem('techarin-color-theme', 'dark');

    renderHook(() => useAuthTheme(), { wrapper });

    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'dark'));
  });

  it('updates the shared website theme when mobile users choose a theme', async () => {
    window.localStorage.setItem('techarin-color-theme', 'dark');
    const { result } = renderHook(() => useAuthTheme(), { wrapper });

    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'dark'));
    act(() => result.current.updateTheme('light'));

    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'light'));
    expect(window.localStorage.getItem('techarin-color-theme')).toBe('light');
  });
});
