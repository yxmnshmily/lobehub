import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from 'next-themes';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AuthThemeButton from './AuthThemeButton';

vi.mock('@lobehub/ui/base-ui', () => ({
  ActionIcon: ({ 'aria-label': ariaLabel, onClick }: React.ComponentProps<'button'>) => (
    <button aria-label={ariaLabel} type="button" onClick={onClick} />
  ),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => (key === 'cmdk.theme' ? '主题' : key) }),
}));

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('AuthThemeButton', () => {
  it('switches the theme directly when any user clicks the theme button', async () => {
    window.localStorage.setItem('techarin-color-theme', 'dark');

    render(
      <ThemeProvider attribute="data-theme" defaultTheme="system">
        <AuthThemeButton />
      </ThemeProvider>,
    );

    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'dark'));
    fireEvent.click(screen.getByRole('button', { name: '主题' }));

    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'light'));
    expect(window.localStorage.getItem('techarin-color-theme')).toBe('light');
  });
});
