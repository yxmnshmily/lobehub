import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import SelectionSummary from './SelectionSummary';

const state = vi.hoisted(() => ({
  all: vi.fn(),
  clear: vi.fn(),
  selectedCount: 0,
  selectAllState: 'none',
}));
vi.mock('@/store/file', () => ({
  useFileStore: (s: any) => s({ resourceList: [{ id: '1' }], hasMore: true }),
}));
vi.mock('../hooks/useExplorerSelection', () => ({
  useExplorerSelectionActions: () => ({
    handleSelectAll: state.clear,
    handleSelectAllResources: state.all,
  }),
  useExplorerSelectionSummary: () => ({
    allSelected: state.selectAllState === 'all',
    indeterminate: false,
    hasSelectableItems: true,
    selectedCount: state.selectedCount,
    selectAllState: state.selectAllState,
    total: 33,
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, args: any) => `${key}:${args.count}` }),
}));
beforeEach(() => {
  state.selectedCount = 0;
  state.selectAllState = 'none';
  vi.clearAllMocks();
});
it('shows the total in the header and selects every result across pages', () => {
  render(<SelectionSummary />);
  expect(screen.getByText('FileManager.total.fileCount:33')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(state.all).toHaveBeenCalledOnce();
});
it('shows selected total once and clears selection from the same checkbox', () => {
  state.selectedCount = 33;
  state.selectAllState = 'all';
  render(<SelectionSummary />);
  expect(screen.getAllByText('FileManager.total.allSelectedCount:33')).toHaveLength(1);
  fireEvent.click(screen.getByRole('checkbox'));
  expect(state.clear).toHaveBeenCalledWith(false);
});
