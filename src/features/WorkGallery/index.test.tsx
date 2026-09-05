import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import WorkGallery from './index';

const mocks = vi.hoisted(() => ({
  gallery: {
    error: undefined as Error | undefined,
    hasMore: true,
    isLoadingInitial: false,
    isLoadingMore: false,
    items: [] as any[],
    loadMore: vi.fn(),
    reload: vi.fn(),
  },
}));

vi.mock('./hooks', () => ({
  useWorkspaceWorksInfinite: () => mocks.gallery,
}));

vi.mock('./useOpenWork', () => ({
  useOpenWork: () => vi.fn(),
}));

vi.mock('./WorkPreviewCard', () => ({
  default: ({ item }: { item: { id: string } }) => <div data-testid={`work-${item.id}`} />,
}));

vi.mock('@/features/AgentTasks/shared/useAgentDisplayMeta', () => ({
  useAgentDisplayMeta: () => null,
}));

vi.mock('@/hooks/useFetchAgentList', () => ({
  useFetchAgentList: vi.fn(),
}));

vi.mock('@/utils/workVersionCost', () => ({
  formatWorkVersionCost: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'zh-CN' },
    t: (key: string) => key,
  }),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: (factory: (input: { css: () => string }) => Record<string, string>) =>
    factory({ css: () => 'className' }),
  cssVar: new Proxy({}, { get: () => 'var(--test)' }),
  cx: (...values: unknown[]) => values.filter(Boolean).join(' '),
}));

vi.mock('@lobehub/ui', () => ({
  Center: ({ children, ...props }: ComponentProps<'div'>) => <div {...props}>{children}</div>,
  Empty: ({ description, title }: { description?: ReactNode; title?: ReactNode }) => (
    <div>
      {title}
      {description}
    </div>
  ),
  Flexbox: ({ children, horizontal: _horizontal, ...props }: ComponentProps<'div'> & { horizontal?: boolean }) => (
    <div {...props}>{children}</div>
  ),
  Skeleton: () => <div data-testid={'skeleton'} />,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Avatar: () => <div />,
  Button: ({ children, icon, ...props }: ComponentProps<'button'> & { icon?: ReactNode }) => (
    <button {...props}>
      {icon}
      {children}
    </button>
  ),
}));

describe('WorkGallery', () => {
  let intersectionCallback: IntersectionObserverCallback | undefined;

  beforeEach(() => {
    mocks.gallery.error = undefined;
    mocks.gallery.hasMore = true;
    mocks.gallery.isLoadingInitial = false;
    mocks.gallery.isLoadingMore = false;
    mocks.gallery.items = [
      { id: 'work-1', originAgentId: undefined, updatedAt: new Date().toISOString() },
    ];
    mocks.gallery.loadMore.mockReset();
    mocks.gallery.reload.mockReset();
    intersectionCallback = undefined;

    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersectionCallback = callback;
        }

        disconnect = vi.fn();
        observe = vi.fn();
        unobserve = vi.fn();
      },
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('does not request the same next page twice before loading state is updated', () => {
    render(<WorkGallery galleryKey={'all'} />);

    act(() => {
      const entry = { isIntersecting: true } as IntersectionObserverEntry;
      intersectionCallback?.([entry], {} as IntersectionObserver);
      intersectionCallback?.([entry], {} as IntersectionObserver);
    });

    expect(mocks.gallery.loadMore).toHaveBeenCalledTimes(1);
  });

  it('renders the initial loading state without an empty-state flash', () => {
    mocks.gallery.items = [];
    mocks.gallery.isLoadingInitial = true;

    render(<WorkGallery galleryKey={'all'} />);

    expect(screen.getAllByTestId('skeleton')).toHaveLength(8);
    expect(screen.queryByText('work.empty.title')).not.toBeInTheDocument();
  });

  it('keeps loaded works visible when loading a later page fails', () => {
    mocks.gallery.error = new Error('page failed');
    mocks.gallery.hasMore = false;

    render(<WorkGallery galleryKey={'all'} />);

    expect(screen.getByTestId('work-work-1')).toBeInTheDocument();
    expect(screen.getByText('work.loadMoreError')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'work.retry' }));
    expect(mocks.gallery.reload).toHaveBeenCalledTimes(1);
  });

  it('coalesces rapid retry clicks while the failed request is being retried', () => {
    mocks.gallery.error = new Error('initial page failed');
    mocks.gallery.hasMore = false;
    mocks.gallery.items = [];

    render(<WorkGallery galleryKey={'all'} />);

    const retry = screen.getByRole('button', { name: 'work.retry' });
    fireEvent.click(retry);
    fireEvent.click(retry);

    expect(mocks.gallery.reload).toHaveBeenCalledTimes(1);
  });

  it('reconnects the sentinel after a failed page has recovered', () => {
    mocks.gallery.error = new Error('page failed');
    mocks.gallery.hasMore = false;

    const { rerender } = render(<WorkGallery galleryKey={'all'} />);
    expect(intersectionCallback).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'work.retry' }));
    mocks.gallery.error = undefined;
    mocks.gallery.hasMore = true;
    rerender(<WorkGallery galleryKey={'task'} />);

    act(() => {
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    expect(mocks.gallery.loadMore).toHaveBeenCalledTimes(1);
  });
});
