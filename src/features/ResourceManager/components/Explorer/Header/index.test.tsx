/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import Header from './index';

vi.mock('antd-style', async (importOriginal) => ({
  ...(await importOriginal()),
  useResponsive: () => ({ mobile: true }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => undefined,
}));

vi.mock('@/business/client/hooks/useFileBatchTransferActions', () => ({
  useFileBatchTransferActions: () => [],
}));

vi.mock('@/features/ResourceManager/store', () => ({
  useResourceManagerStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      category: 'all',
      libraryId: undefined,
      onActionClick: vi.fn(),
      selectAllState: 'none',
      selectedFileIds: [],
      selectionTotal: 0,
      viewMode: 'masonry',
    }),
}));

vi.mock('@/features/ResourceManager/store/selectors', () => ({
  getExplorerSelectedCount: () => 0,
}));

vi.mock('@/features/WorkspaceDeleteAllModal', () => ({
  openWorkspaceDeleteAllModal: vi.fn(),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true }),
}));

vi.mock('@/store/file', () => ({
  useFileStore: (selector: (state: { total: number }) => unknown) => selector({ total: 0 }),
}));

vi.mock('../../Header/AddButton', () => ({ default: () => <button>Add</button> }));
vi.mock('../ToolBar/BatchActionsDropdown', () => ({ default: () => null }));
vi.mock('../ToolBar/SortDropdown', () => ({ default: () => null }));
vi.mock('../ToolBar/SourceFilter', () => ({ default: () => null }));
vi.mock('../ToolBar/ViewSwitcher', () => ({ default: () => null }));
vi.mock('./Breadcrumb', () => ({ default: () => null }));
vi.mock('./SelectionSummary', () => ({ default: () => <span>Selection summary</span> }));
vi.mock('./SearchInput', () => ({ default: () => null }));

describe('Resource explorer mobile header', () => {
  it('keeps 8px vertical padding while using the shared 10px horizontal gutter', () => {
    const { container } = render(<Header />);
    const header = container.firstElementChild as HTMLElement;

    expect(header.style.getPropertyValue('--lobe-flex-padding-block')).toBe('8px');
    expect(header.style.getPropertyValue('--lobe-flex-padding-inline')).toBe(
      'var(--mobile-page-gutter, 10px)',
    );
    expect(header.style.getPropertyValue('--lobe-flex-padding')).toBe('');
  });
});
