import { Flexbox } from '@lobehub/ui';
import { Checkbox } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';

import { useFileStore } from '@/store/file';

import {
  useExplorerSelectionActions,
  useExplorerSelectionSummary,
} from '../hooks/useExplorerSelection';

export default function SelectionSummary() {
  const { t } = useTranslation('components');
  const data = useFileStore((s) => s.resourceList) ?? [];
  const hasMore = useFileStore((s) => s.hasMore);
  const { handleSelectAll, handleSelectAllResources } = useExplorerSelectionActions(data);
  const { allSelected, indeterminate, hasSelectableItems, selectedCount, selectAllState, total } =
    useExplorerSelectionSummary({ data, hasMore });
  const selected = selectedCount > 0 || selectAllState === 'all';
  const label = t(
    selected
      ? selectAllState === 'all' && selectedCount === total
        ? 'FileManager.total.allSelectedCount'
        : 'FileManager.total.selectedCount'
      : 'FileManager.total.fileCount',
    { count: selected ? selectedCount : total || data.length },
  );

  return (
    <Flexbox
      horizontal
      align="center"
      data-resource-selection-summary=""
      gap={8}
      style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
    >
      <Checkbox
        aria-label={label}
        checked={allSelected}
        disabled={!hasSelectableItems}
        indeterminate={indeterminate}
        onChange={(checked) => {
          if (checked !== false) void handleSelectAllResources();
          else handleSelectAll(false);
        }}
      />
      <span aria-live="polite">{label}</span>
    </Flexbox>
  );
}
