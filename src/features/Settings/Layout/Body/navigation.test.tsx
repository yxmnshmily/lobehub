// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { createContext, type ReactNode, use, useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import Body from './index';

const state = vi.hoisted(() => ({ pathname: '/settings/provider/all', navigate: vi.fn() }));
vi.mock('@/hooks/useActiveLocation', () => ({
  useActiveLocation: () => ({ pathname: state.pathname, search: '' }),
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => state.navigate,
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: any) => selector({ status: { showLeftPanel: true } }),
}));
vi.mock('../../hooks/useCategory', () => ({
  useCategory: () => [
    { key: 'agent', title: 'AI 智能体', items: [{ key: 'provider', label: 'AI 服务商' }] },
    { key: 'developer', title: '高级设置', items: [{ key: 'advanced', label: '工具与诊断' }] },
    {
      key: 'admin',
      title: '用户管理',
      items: [
        { key: 'service-operations', label: '账户管理' },
        { key: 'content-moderation', label: '内容审核' },
      ],
    },
  ],
}));
vi.mock('@/features/SettingsSearch', () => ({
  getTabUrl: (key: string) => (key === 'provider' ? '/settings/provider/all' : `/settings/${key}`),
  SearchSection: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({ title }: { title: ReactNode }) => <span>{title}</span>,
}));
vi.mock('react-router', () => ({
  Link: ({ children, to, onClick }: any) => (
    <a href={to} onClick={onClick}>
      {children}
    </a>
  ),
}));
// Preserve Accordion's controlled/uncontrolled contract so a remount really loses toggles.
vi.mock('@lobehub/ui', () => {
  const Context = createContext<any>(null);
  return {
    Flexbox: ({ children }: any) => <div>{children}</div>,
    Accordion: ({ children, defaultExpandedKeys, expandedKeys, onExpandedChange }: any) => {
      const [internal, setInternal] = useState(defaultExpandedKeys ?? []);
      const keys = expandedKeys ?? internal;
      return (
        <Context
          value={{
            keys,
            toggle: (key: string) => {
              const next = keys.includes(key)
                ? keys.filter((k: string) => k !== key)
                : [...keys, key];
              setInternal(next);
              onExpandedChange?.(next);
            },
          }}
        >
          {children}
        </Context>
      );
    },
    AccordionItem: ({ children, title, itemKey }: any) => {
      const { keys, toggle } = use(Context);
      return (
        <section>
          <button aria-expanded={keys.includes(itemKey)} onClick={() => toggle(itemKey)}>
            {title}
          </button>
          {keys.includes(itemKey) && children}
        </section>
      );
    },
  };
});
vi.mock('@lobehub/ui/base-ui', () => ({ Text: ({ children }: any) => <span>{children}</span> }));
beforeEach(() => {
  state.pathname = '/settings/provider/all';
  state.navigate.mockReset();
});

it('keeps collapsed AI entries out of the click area after entering and leaving diagnostics', () => {
  const { rerender } = render(<Body />);
  fireEvent.click(screen.getByRole('button', { name: 'AI 智能体' }));
  fireEvent.click(screen.getByRole('button', { name: '高级设置' }));
  const diagnostics = screen.getByRole('link', { name: '工具与诊断' });
  fireEvent.click(diagnostics);
  expect(state.navigate).toHaveBeenLastCalledWith('/settings/advanced');
  state.pathname = '/settings/advanced';
  rerender(<Body {...({ routeRevision: 1 } as any)} />);
  expect(screen.queryByRole('link', { name: 'AI 服务商' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '工具与诊断' })).toBe(diagnostics);
  state.pathname = '/settings/profile';
  rerender(<Body {...({ routeRevision: 2 } as any)} />);
  expect(screen.getByRole('link', { name: '工具与诊断' })).toBe(diagnostics);
  fireEvent.click(diagnostics);
  expect(state.navigate).toHaveBeenLastCalledWith('/settings/advanced');
});

it('opens the advanced group on a direct diagnostics entry', () => {
  state.pathname = '/settings/advanced';
  render(<Body />);
  expect(screen.getByRole('link', { name: '工具与诊断' })).toHaveAttribute(
    'href',
    '/settings/advanced',
  );
});

it.each([
  ['内容审核', '/settings/content-moderation'],
  ['账户管理', '/settings/service-operations'],
])('keeps the initial expanded sections stable when navigating to %s', (label, path) => {
  state.pathname = '/settings/advanced';
  const { rerender } = render(<Body />);
  fireEvent.click(screen.getByRole('button', { name: 'AI 智能体' }));
  const target = screen.getByRole('link', { name: label });
  fireEvent.click(target);
  expect(state.navigate).toHaveBeenLastCalledWith(path);
  state.pathname = path;
  rerender(<Body {...({ routeRevision: 1 } as any)} />);
  expect(screen.getByRole('button', { name: '高级设置' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('link', { name: label })).toBe(target);
  expect(screen.queryByRole('link', { name: 'AI 服务商' })).not.toBeInTheDocument();
});
