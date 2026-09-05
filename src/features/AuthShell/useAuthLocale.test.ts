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

    await act(() => result.current.i18n.instance.changeLanguage('ar'));

    await waitFor(() => expect(result.current.lang).toBe('ar'));
    expect(result.current.documentDir).toBe('ltr');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('ar');
  });

  it('syncs the auth language into the backend language preference', async () => {
    localStorage.setItem(SYSTEM_STATUS_KEY, JSON.stringify({ language: 'en-US' }));

    renderHook(() => useAuthLocale('ar'));

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(SYSTEM_STATUS_KEY) || '{}').language).toBe('ar'),
    );
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('ar');
  });

  it('restores the language selected on the previous auth-page visit', async () => {
    document.cookie = 'LOBE_LOCALE=ja-JP; path=/';

    const { result } = renderHook(() => useAuthLocale('zh-CN'));

    expect(result.current.i18n.instance.language).toBe('ja-JP');
    await waitFor(() => expect(document.documentElement.lang).toBe('ja-JP'));
  });
});
