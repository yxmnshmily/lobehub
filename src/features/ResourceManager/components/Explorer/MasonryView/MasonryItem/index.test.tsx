import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MasonryFileItem from './index';

const { mockHandleItemClick } = vi.hoisted(() => ({
  mockHandleItemClick: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/ResourceManager/DndContextWrapper', () => ({
  getTransparentDragImage: () => null,
  useDragActive: () => false,
  useSetCurrentDrag: () => vi.fn(),
}));

vi.mock('@/features/ResourceManager/components/Explorer/hooks/useFileItemClick', () => ({
  useFileItemClick: () => mockHandleItemClick,
}));

vi.mock('@/features/ResourceManager/components/Explorer/ItemDropdown/useFileItemDropdown', () => ({
  useFileItemDropdown: () => ({ menuItems: () => [] }),
}));

vi.mock('@/features/ResourceManager/components/Explorer/ItemDropdown/DropdownMenu', () => ({
  default: () => null,
}));

vi.mock('@/features/ResourceManager/components/Explorer/ItemDropdown/QuickActions', () => ({
  QuickActions: () => null,
}));

vi.mock('@/libs/contextMenu', () => ({ showContextMenu: vi.fn() }));

vi.mock('@/store/file', () => ({
  getChunkTargetId: ({ id }: { id: string }) => id,
  useFileStore: {
    getState: () => ({ queryParams: {} }),
  },
}));

vi.mock('./DefaultFileItem', () => ({
  default: ({ name }: { name: string }) => <span>{name}</span>,
}));
vi.mock('./AudioFileItem', () => ({ default: () => null }));
vi.mock('./ImageFileItem', () => ({ default: () => null }));
vi.mock('./MarkdownFileItem', () => ({ default: () => null }));
vi.mock('./NoteFileItem', () => ({ default: () => null }));
vi.mock('./VideoFileItem', () => ({ default: () => null }));
vi.mock('./WebpageFileItem', () => ({ default: () => null }));

describe('MasonryFileItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        disconnect = vi.fn();
        observe = vi.fn();
      },
    );
  });

  it('opens the resource from the keyboard through the card click surface', () => {
    render(
      <MasonryFileItem
        createdAt={new Date('2026-09-09')}
        fileType="text/plain"
        id="resource-1"
        name="Trip plan.txt"
        onSelectedChange={vi.fn()}
        size={1024}
        sourceType="file"
        updatedAt={new Date('2026-09-09')}
      />,
    );

    const card = screen.getByRole('button', { name: 'Trip plan.txt' });
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });

    expect(mockHandleItemClick).toHaveBeenCalledTimes(2);
  });
});
