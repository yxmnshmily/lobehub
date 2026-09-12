import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useAuthLocale } from './useAuthLocale';

const SYSTEM_STATUS_KEY = 'LOBE_SYSTEM_STATUS';

afterEach(() => {
  localStorage.removeItem(SYSTEM_STATUS_KEY);
  document.cookie = 'LOBE_LOCALE=; Max-Age=0; path=/';
});

describe('useAuthLocale', () => {
  it('keeps the requested auth language active when the locale changes', async () => {
    const { result } = renderHook(() => useAuthLocale('zh-CN'));

    expect(result.current.i18n.instance.language).toBe('zh-CN');

    await act(() => result.current.i18n.instance.changeLanguage('en-US'));

    await waitFor(() => expect(result.current.lang).toBe('en-US'));
    expect(result.current.documentDir).toBe('ltr');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en-US');
  });

  it('syncs the auth language into the backend language preference', async () => {
    localStorage.setItem(SYSTEM_STATUS_KEY, JSON.stringify({ language: 'en-US' }));

    renderHook(() => useAuthLocale('en-US'));

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(SYSTEM_STATUS_KEY) || '{}').language).toBe('en-US'),
    );
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en-US');
  });

  it('falls back to the page language when the saved language has been retired', async () => {
    document.cookie = 'LOBE_LOCALE=ja-JP; path=/';

    const { result } = renderHook(() => useAuthLocale('zh-CN'));

    expect(result.current.i18n.instance.language).toBe('zh-CN');
    await waitFor(() => expect(document.documentElement.lang).toBe('zh-CN'));
  });
});
