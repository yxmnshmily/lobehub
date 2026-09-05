import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import Header from './Header';

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  ActionIcon: ({
    size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    size?: { blockSize?: number };
  }) => <button {...props} data-block-size={size?.blockSize} />,
  Drawer: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@lobehub/ui/mobile', () => ({
  ChatHeader: ({ left, right }: { left?: React.ReactNode; right?: React.ReactNode }) => (
    <header>
      {left}
      {right}
    </header>
  ),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({ search: 'search' }),
  cssVar: { colorBgLayout: '#fff', colorSplit: '#ddd', colorText: '#000' },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/Menu', () => ({ default: () => null }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

vi.mock('../../../../(main)/community/features/Search', () => ({ default: () => null }));
vi.mock('../../../../(main)/community/features/useNav', () => ({
  useNav: () => ({ activeItem: { label: 'discover' }, activeKey: 'home', items: [] }),
}));

describe('mobile community header', () => {
  it('names the category menu and search buttons', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );

    expect(html).toContain('aria-label="tab.home"');
    expect(html).toContain('aria-label="search.placeholder"');
    expect(html.match(/data-block-size="44"/g)).toHaveLength(2);
  });
});
