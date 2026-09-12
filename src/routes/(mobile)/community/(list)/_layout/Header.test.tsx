import { fireEvent, render, screen } from '@testing-library/react';
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
  Drawer: ({
    children,
    styles,
    zIndex,
  }: {
    children?: React.ReactNode;
    styles?: { bodyContent?: React.CSSProperties };
    zIndex?: number;
  }) => (
    <aside
      data-padding-bottom={styles?.bodyContent?.paddingBottom}
      data-padding-inline-start={styles?.bodyContent?.paddingInlineStart}
      data-z-index={zIndex}
    >
      {children}
    </aside>
  ),
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
  cx: (...values: unknown[]) => values.filter(Boolean).join(' '),
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
  useNav: () => ({
    activeItem: { key: 'home', label: 'discover', title: 'tab.home' },
    activeKey: 'home',
    items: [],
    navItems: [
      { icon: <span />, key: 'home', label: 'discover', title: 'tab.home' },
      { icon: <span />, key: 'agent', label: 'agents', title: 'tab.assistant' },
      { icon: <span />, key: 'skill', label: 'skills', title: 'tab.skill' },
    ],
  }),
}));

describe('mobile community header', () => {
  it('names the category menu and search buttons', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );

    expect(html).toContain('aria-label="agentViewAll.sidebarSection.expand tab.community"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="search.placeholder"');
    expect(html.match(/data-block-size="44"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="tab.community"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('tab.skill');
    expect(html).toContain('data-padding-bottom="max(16px, env(safe-area-inset-bottom))"');
    expect(html).toContain('data-padding-inline-start="max(16px, env(safe-area-inset-left))"');
    expect(html).toContain('data-z-index="200"');
  });

  it('names the drawer trigger as an open or close action and exposes its state', () => {
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );

    const openButton = screen.getByRole('button', {
      name: 'agentViewAll.sidebarSection.expand tab.community',
    });
    expect(openButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(openButton);

    expect(
      screen.getByRole('button', {
        name: 'agentViewAll.sidebarSection.collapse tab.community',
      }),
    ).toHaveAttribute('aria-expanded', 'true');
  });
});
