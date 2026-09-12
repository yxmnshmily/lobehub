import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import Header from './Header';

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, undefined, children),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  ActionIcon: ({
    size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    size?: { blockSize?: number };
  }) => React.createElement('button', { ...props, 'data-block-size': size?.blockSize }),
}));

vi.mock('@lobehub/ui/mobile', () => {
  const ChatHeader = ({ center, left }: { center?: React.ReactNode; left?: React.ReactNode }) =>
    React.createElement('header', undefined, left, center);

  ChatHeader.Title = ({ title }: { title?: React.ReactNode }) =>
    React.createElement(React.Fragment, undefined, title);

  return { ChatHeader };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('mobile profile Header', () => {
  it('uses an accessible 44px back target', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );

    expect(html).toContain('aria-label="back"');
    expect(html).toContain('data-block-size="44"');
  });
});
