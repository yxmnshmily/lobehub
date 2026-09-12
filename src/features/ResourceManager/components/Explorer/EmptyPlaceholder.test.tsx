import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FilesTabs, ResourceSourceFilter } from '@/types/files';

import EmptyPlaceholder from './EmptyPlaceholder';

const mockOpen = vi.fn();
const mockPushDockFileList = vi.fn();
const mockSetSourceFilter = vi.fn();
let canCreate = true;
let category: FilesTabs = FilesTabs.All;
let libraryId: string | undefined;
let mobile = false;
let sourceFilter: ResourceSourceFilter | undefined;

vi.mock('antd-style', async (importOriginal) => ({
  ...(await importOriginal()),
  useResponsive: () => ({ mobile }),
}));

vi.mock('@/features/LibraryModal', () => ({
  useCreateNewModal: () => ({ open: mockOpen }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: canCreate, reason: '' }),
}));

vi.mock('@/features/ResourceManager/hooks/useCurrentFolderId', () => ({
  useCurrentFolderId: () => undefined,
}));

vi.mock('@/features/ResourceManager/store', () => ({
  useResourceManagerStore: (selector: (state: any) => unknown) =>
    selector({ category, libraryId, setSourceFilter: mockSetSourceFilter, sourceFilter }),
}));

vi.mock('@/store/file', () => ({
  useFileStore: (selector: (state: { pushDockFileList: typeof mockPushDockFileList }) => unknown) =>
    selector({ pushDockFileList: mockPushDockFileList }),
}));

describe('EmptyPlaceholder', () => {
  beforeEach(() => {
    canCreate = true;
    category = FilesTabs.All;
    libraryId = undefined;
    mobile = false;
    sourceFilter = undefined;
    vi.clearAllMocks();
  });

  it('should blame the source filter instead of prompting onboarding when it narrows', async () => {
    // Images defaults to AI-generated, so a library of uploads lands here.
    category = FilesTabs.Images;

    render(<EmptyPlaceholder />);

    expect(screen.getByText('FileManager.emptyStatus.filteredTitle')).toBeInTheDocument();
    expect(
      screen.queryByText('FileManager.emptyStatus.actions.knowledgeBase'),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('FileManager.emptyStatus.actions.showAllSources'));

    expect(mockSetSourceFilter).toHaveBeenCalledWith(ResourceSourceFilter.All);
  });

  it('should render create actions when the user can create resources', () => {
    render(<EmptyPlaceholder />);

    expect(screen.getByText('FileManager.emptyStatus.actions.knowledgeBase')).toBeInTheDocument();
    expect(screen.getByText('FileManager.emptyStatus.actions.file')).toBeInTheDocument();
    expect(screen.getByText('FileManager.emptyStatus.actions.folder')).toBeInTheDocument();
  });

  it('lays out all three top-level create actions in one row on mobile', () => {
    mobile = true;

    render(<EmptyPlaceholder />);

    const createLibraryAction = screen.getByText(
      'FileManager.emptyStatus.actions.knowledgeBase',
    );
    const actions = createLibraryAction.parentElement?.parentElement;

    expect(actions).toHaveStyle({
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    });
  });

  it('should hide create actions when the user cannot create resources', () => {
    canCreate = false;

    render(<EmptyPlaceholder />);

    expect(
      screen.queryByText('FileManager.emptyStatus.actions.knowledgeBase'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('FileManager.emptyStatus.actions.file')).not.toBeInTheDocument();
    expect(screen.queryByText('FileManager.emptyStatus.actions.folder')).not.toBeInTheDocument();
  });
});
