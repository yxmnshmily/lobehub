import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LOBE_LOCALE_COOKIE } from '@/const/locale';

import AuthLangButton from './AuthLangButton';

const mocks = vi.hoisted(() => ({
  changeLanguage: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, icon: _icon, iconPosition: _iconPosition, ...props }: any) => (
    <button {...props} type="button">
      {children}
    </button>
  ),
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      changeLanguage: mocks.changeLanguage,
      language: 'zh-CN',
      resolvedLanguage: 'zh-CN',
    },
  }),
}));

afterEach(() => {
  document.cookie = `${LOBE_LOCALE_COOKIE}=; Max-Age=0; path=/`;
  document.documentElement.lang = '';
  mocks.changeLanguage.mockReset();
});

describe('AuthLangButton', () => {
  it('moves focus into the menu and supports arrow navigation and Escape', () => {
    render(<AuthLangButton />);

    const trigger = screen.getByRole('button', { name: /简体中文/ });
    trigger.focus();
    fireEvent.click(trigger);

    const currentItem = screen.getByRole('menuitemradio', { name: '简体中文' });
    const nextItem = screen.getByRole('menuitemradio', { name: '繁體中文' });
    expect(currentItem).toHaveFocus();

    fireEvent.keyDown(currentItem, { key: 'ArrowDown' });
    expect(nextItem).toHaveFocus();

    fireEvent.keyDown(nextItem, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('uses native clickable rows in a height-limited menu and persists the selected language', () => {
    render(<AuthLangButton />);

    fireEvent.click(screen.getByRole('button', { name: /简体中文/ }));

    const menu = screen.getByRole('menu');
    expect(screen.getByTestId('language-menu-overlay').style.position).toBe('fixed');
    expect(menu.style.maxHeight).toBe('min(60dvh, 360px)');
    expect(menu.style.overflowY).toBe('auto');
    expect(menu.style.position).toBe('absolute');

    const englishItem = screen.getByRole('menuitemradio', { name: 'English' });
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({
      bottom: 72,
      height: 72,
      left: 0,
      right: 200,
      top: 0,
      width: 200,
      x: 0,
      y: 0,
    } as DOMRect);
    vi.spyOn(englishItem, 'getBoundingClientRect').mockReturnValue({
      bottom: 36,
      height: 36,
      left: 0,
      right: 200,
      top: 0,
      width: 200,
      x: 0,
      y: 0,
    } as DOMRect);

    const overlay = screen.getByTestId('language-menu-overlay');
    fireEvent.pointerDown(overlay, { clientX: 50, clientY: 18 });
    fireEvent.pointerUp(overlay, { clientX: 50, clientY: 18 });

    expect(mocks.changeLanguage).toHaveBeenCalledWith('en-US');
    expect(document.documentElement.lang).toBe('en-US');
    expect(document.cookie).toContain(`${LOBE_LOCALE_COOKIE}=en-US`);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
