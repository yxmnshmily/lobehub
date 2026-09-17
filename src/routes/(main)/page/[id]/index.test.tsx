import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePageStore as pageStore } from '@/store/page';

import PagesPage from './index';

vi.mock('@/store/page', async () => {
  const { create } = await import('zustand');
  return {
    usePageStore: create<{ selectedPageId: string | null }>(() => ({ selectedPageId: null })),
  };
});
vi.mock('@/features/PageEditor', () => ({ PageEditor: () => <div>New draft</div> }));
vi.mock('@/features/PageExplorer', () => ({ default: () => <div>Existing page</div> }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', async () => {
  const { useNavigate } = await import('react-router');
  return { useWorkspaceAwareNavigate: useNavigate };
});
vi.mock('@/components/Skeleton/Delayed', () => ({ delayed: () => null }));
vi.mock('@/components/Skeleton/Surface', () => ({ default: () => null }));

beforeEach(() => pageStore.setState({ selectedPageId: null }));
describe('page route selection', () => {
  it('clears an existing selection when navigating to a new draft and when unmounting', async () => {
    const view = render(
      <MemoryRouter initialEntries={['/page/docs_previous']}>
        <Link to="/page/new">New</Link>
        <Routes>
          <Route element={<PagesPage />} path="/page/:id" />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(pageStore.getState().selectedPageId).toBe('docs_previous'));
    fireEvent.click(screen.getByText('New'));
    await screen.findByText('New draft');
    expect(pageStore.getState().selectedPageId).toBeNull();
    pageStore.setState({ selectedPageId: 'docs_other' });
    view.unmount();
    expect(pageStore.getState().selectedPageId).toBeNull();
  });
});
