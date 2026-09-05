import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import ThemeButton from './ThemeButton';

vi.mock('@lobehub/ui', () => ({
  DropdownMenu: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, undefined, children),
  Icon: () => null,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  ActionIcon: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement('button', props),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ setTheme: vi.fn(), theme: 'system' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('ThemeButton', () => {
  it('gives the theme menu trigger an accessible name', () => {
    const html = renderToStaticMarkup(<ThemeButton />);

    expect(html).toContain('aria-label="settingCommon.themeMode.title"');
  });
});
