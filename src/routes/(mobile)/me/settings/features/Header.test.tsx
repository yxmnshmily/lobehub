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
  ActionIcon: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement('button', props),
}));

vi.mock('@lobehub/ui/mobile', () => {
  const ChatHeader = ({
    center,
    left,
    showBackButton,
  }: {
    center?: React.ReactNode;
    left?: React.ReactNode;
    showBackButton?: boolean;
  }) =>
    React.createElement(
      'header',
      undefined,
      left ?? (showBackButton ? React.createElement('button') : null),
      center,
    );

  ChatHeader.Title = ({ title }: { title?: React.ReactNode }) =>
    React.createElement(React.Fragment, undefined, title);

  return { ChatHeader };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('mobile me settings Header', () => {
  it('gives the back button an accessible name', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );

    expect(html).toContain('aria-label="back"');
  });
});

