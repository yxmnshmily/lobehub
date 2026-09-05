import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import ListConfig from './ListConfig';

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Form: () => null,
  Icon: () => null,
  Popover: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  ActionIcon: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  Select: () => null,
  Switch: () => null,
  Tabs: () => null,
}));

vi.mock('antd-style', () => ({ createStaticStyles: () => ({ form: 'form' }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('AgentViewAll ListConfig', () => {
  it('names the view settings button', () => {
    const html = renderToStaticMarkup(
      <ListConfig
        options={{
          groupBy: 'none',
          orderBy: 'updatedAt',
          orderDirection: 'desc',
          showSidebarHidden: false,
        }}
        setOptions={() => {}}
        setViewMode={() => {}}
        viewMode="card"
      />,
    );

    expect(html).toContain('aria-label="setting"');
  });
});
