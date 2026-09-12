import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import OtherResources from './index';

const mocks = vi.hoisted(() => ({
  works: {} as any,
  loadMore: vi.fn(),
  reload: vi.fn(),
  openWork: vi.fn(),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/features/NavHeader', () => ({ default: () => <div data-testid="nav-header" /> }));
vi.mock('@/hooks/useFetchAgentList', () => ({ useFetchAgentList: () => {} }));
vi.mock('@/features/ResourceManager/hooks/useResourceManagerUrlSync', () => ({
  useResourceManagerUrlSync: () => {},
}));
vi.mock('@/components/AsyncError', () => ({
  default: ({ onRetry }: any) => <button onClick={onRetry}>retry</button>,
}));
vi.mock('@/features/WorkGallery/Skeleton', () => ({
  WorkGalleryCardsSkeleton: () => <div>loading</div>,
}));
vi.mock('@/features/WorkGallery/useOpenWork', () => ({ useOpenWork: () => mocks.openWork }));
vi.mock('@/features/WorkGallery/WorkPreviewCard', () => ({
  default: ({ item, onDeleted, onOpen }: any) => (
    <div>
      <button onClick={() => onOpen(item)}>{item.title}</button>
      <button onClick={onDeleted}>{'delete ' + item.id}</button>
    </div>
  ),
}));
vi.mock('@/features/WorkGallery/hooks', () => ({
  useWorkspaceWorksInfinite: () => ({
    error: mocks.works.error,
    hasMore: mocks.works.hasMore ?? false,
    isLoadingInitial: mocks.works.isLoadingInitial ?? false,
    isLoadingMore: mocks.works.isLoadingMore ?? false,
    isValidating: false,
    items: mocks.works.items ?? [],
    loadMore: mocks.loadMore,
    reload: mocks.reload,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.works = {
    hasMore: false,
    isLoadingInitial: false,
    items: [
      { id: 'w1', title: 'T-30 交付归档' },
      { id: 'w2', title: '西藏7日游文案 · 10条（终稿）' },
    ],
  };
});

it('renders the agent works with a single page header', () => {
  render(<OtherResources />);
  expect(screen.getByText('T-30 交付归档')).toBeInTheDocument();
  expect(screen.getByText('西藏7日游文案 · 10条（终稿）')).toBeInTheDocument();
  expect(screen.getAllByTestId('nav-header')).toHaveLength(1);
});

it('opens the work that was clicked', () => {
  render(<OtherResources />);
  fireEvent.click(screen.getByText('T-30 交付归档'));
  expect(mocks.openWork).toHaveBeenCalledWith(expect.objectContaining({ id: 'w1' }));
});

it('keeps loaded works mounted while the first page is still loading', () => {
  const { rerender } = render(<OtherResources />);
  const card = screen.getByText('T-30 交付归档');
  mocks.works.isLoadingInitial = true;
  rerender(<OtherResources />);
  expect(screen.getByText('T-30 交付归档')).toBe(card);
  expect(screen.queryByText('loading')).not.toBeInTheDocument();
});

it('shows a skeleton only before any work is loaded', () => {
  mocks.works.items = [];
  mocks.works.isLoadingInitial = true;
  render(<OtherResources />);
  expect(screen.getByText('loading')).toBeInTheDocument();
});

it('shows the empty label when there is no work at all', () => {
  mocks.works.items = [];
  render(<OtherResources />);
  expect(screen.getByText('empty')).toBeInTheDocument();
});

it('offers 加载更多 only while more works remain, and pages on click', () => {
  mocks.works.hasMore = true;
  render(<OtherResources />);
  fireEvent.click(screen.getByRole('button', { name: 'loadMore' }));
  expect(mocks.loadMore).toHaveBeenCalledOnce();
});

it('reloads after a work is deleted', () => {
  render(<OtherResources />);
  fireEvent.click(screen.getByText('delete w1'));
  expect(mocks.reload).toHaveBeenCalledOnce();
});

it('shows retry instead of paging when the feed fails', () => {
  mocks.works.error = new Error('failed');
  mocks.works.hasMore = true;
  render(<OtherResources />);
  expect(screen.queryByRole('button', { name: 'loadMore' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'retry' }));
  expect(mocks.reload).toHaveBeenCalledOnce();
});
