import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import Header from './Header';

vi.mock('@lobehub/ui/base-ui', () => ({
  ActionIcon: ({
    size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    size?: { blockSize?: number };
  }) => React.createElement('button', { ...props, 'data-block-size': size?.blockSize }),
}));

vi.mock('@lobehub/ui/mobile', () => ({
  ChatHeader: ({ right }: { right?: React.ReactNode }) =>
    React.createElement('header', undefined, right),
}));

vi.mock('next-themes', () => ({ useTheme: () => ({ setTheme: vi.fn() }) }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/useIsDark', () => ({ useIsDark: () => false }));

describe('mobile me home Header', () => {
  it('gives the theme toggle an accessible name', () => {
    const html = renderToStaticMarkup(<Header />);

    expect(html).toContain('aria-label="cmdk.themeDark"');
    expect(html).toContain('data-block-size="44"');
  });
});
