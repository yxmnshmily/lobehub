import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FilesTabs } from '@/types/files';

import CategoryMenu from './CategoryMenu';

vi.mock('./CategoryCount', () => ({ default: () => <span>（33）</span> }));

const mocks = vi.hoisted(() => ({
  category: 'home' as string,
  expanded: true,
  navigate: vi.fn(),
  pathname: '/resource',
  setMode: vi.fn(),
}));
vi.mock('@/business/client/features/ResourceCategories', () => ({
  useBusinessResourceCategories: () => [],
}));
vi.mock('@/features/ResourceManager/store', () => ({
  useResourceManagerStore: (selector: any) =>
    selector({ category: mocks.category, setMode: mocks.setMode }),
}));
vi.mock('@/store/global', () => ({ useGlobalStore: () => mocks.expanded }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));
vi.mock('@/hooks/useActiveLocation', () => ({
  useActiveLocation: () => ({ pathname: mocks.pathname }),
}));
vi.mock('react-router', async () => {
  const actual = await vi.importActual<object>('react-router');
  return {
    ...actual,
    Link: ({ children, to, ...props }: any) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  };
});

describe('merged resource categories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.expanded = true;
    mocks.category = FilesTabs.Home;
    mocks.pathname = '/resource';
  });

  it.each([true, false])('opens the actual combined lists directly (expanded=%s)', (expanded) => {
    mocks.expanded = expanded;
    render(<CategoryMenu />);
    for (const legacy of ['tab.pages', 'tab.files', 'tab.audios', 'work.group'])
      expect(screen.queryByText(legacy)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'tab.documents' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'tab.documents' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/resource/documents', { replace: true });
    fireEvent.click(screen.getByRole('link', { name: 'tab.other' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/resource/other', { replace: true });
    expect(screen.getAllByRole('link')).toHaveLength(5);
  });

  it.each(['/resource/other', '/workspace-a/resource/other'])(
    'selects only the current route even when the previous category remains cached: %s',
    (pathname) => {
      mocks.pathname = pathname;
      mocks.category = FilesTabs.Documents;
      render(<CategoryMenu />);
      expect(screen.getByRole('link', { name: 'tab.other' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(screen.getByRole('link', { name: 'tab.documents' })).not.toHaveAttribute(
        'aria-current',
      );
    },
  );
});
