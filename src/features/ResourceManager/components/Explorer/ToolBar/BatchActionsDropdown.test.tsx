import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import BatchActionsDropdown from './BatchActionsDropdown';
import SortDropdown from './SortDropdown';
import ViewSwitcher from './ViewSwitcher';

const state = vi.hoisted(() => ({ allowed: true, setSorter: vi.fn(), setViewMode: vi.fn() }));
vi.mock('../hooks/useViewMode', () => ({ useViewMode: () => ['list', state.setViewMode] }));
vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({
    allowed: state.allowed,
    reason: state.allowed ? undefined : 'Read only',
  }),
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => undefined,
}));
vi.mock('@/features/ResourceManager/components/KnowledgeBaseListProvider', () => ({
  useKnowledgeBaseListContext: () => [],
}));
vi.mock('@/features/ResourceManager/store', () => ({
  useResourceManagerStore: (selector: (s: unknown) => unknown) =>
    selector({
      sorter: 'createdAt',
      setSorter: state.setSorter,
      libraryId: undefined,
      listVisibility: 'private',
      selectAllState: 'none',
      resolveSelectedResourceIds: async () => ['file-1'],
    }),
}));
vi.mock('@/store/library', () => ({
  useKnowledgeBaseStore: (selector: (s: unknown) => unknown) =>
    selector({ addFilesToKnowledgeBase: vi.fn() }),
}));
vi.mock('@/features/WorkspaceDeleteAllModal', () => ({ openWorkspaceDeleteAllModal: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

beforeEach(() => {
  state.allowed = true;
});

describe('resource batch actions trigger', () => {
  it('opens its menu without selected files and keeps actions disabled', async () => {
    const onActionClick = vi.fn();
    render(<BatchActionsDropdown selectCount={0} onActionClick={onActionClick} />);
    fireEvent.click(screen.getByTitle('FileManager.actions.batchActions'));
    expect(await screen.findByRole('menu')).toBeVisible();
    expect(
      screen.getByRole('menuitem', { name: 'FileManager.actions.batchChunking' }),
    ).toHaveAttribute('aria-disabled', 'true');
    expect(onActionClick).not.toHaveBeenCalled();
  });

  it('opens and dispatches an action for selected files', async () => {
    const onActionClick = vi.fn().mockResolvedValue(undefined);
    render(<BatchActionsDropdown selectCount={1} onActionClick={onActionClick} />);
    fireEvent.click(screen.getByTitle('FileManager.actions.batchActions'));
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'FileManager.actions.batchChunking' }),
    );
    expect(onActionClick).toHaveBeenCalledWith('batchChunking');
  });

  it('does not open or dispatch when editing is forbidden', () => {
    const onActionClick = vi.fn();
    state.allowed = false;
    render(<BatchActionsDropdown selectCount={1} onActionClick={onActionClick} />);
    const trigger = screen.getByTitle('FileManager.actions.batchActions');
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onActionClick).not.toHaveBeenCalled();
  });
});

describe('adjacent resource toolbar menus', () => {
  it('opens sorting and selects a different sort order', async () => {
    render(<SortDropdown />);
    fireEvent.click(screen.getByTitle('FileManager.sort.dateAdded'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'FileManager.sort.name' }));
    expect(state.setSorter).toHaveBeenCalledWith('name');
  });

  it('opens the view menu and switches to the grid view', async () => {
    render(<ViewSwitcher />);
    fireEvent.click(screen.getByTitle('FileManager.view.list'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'FileManager.view.masonry' }));
    expect(state.setViewMode).toHaveBeenCalledWith('masonry');
  });
});
