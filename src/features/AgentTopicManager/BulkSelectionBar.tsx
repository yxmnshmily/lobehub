import { Flexbox } from '@lobehub/ui';
import { Button, Checkbox } from '@lobehub/ui/base-ui';
import { TrashIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface BulkSelectionBarProps {
  busy?: boolean;
  onClear: () => void;
  onDelete: () => void;
  onSelectAll: () => void;
  selectedCount: number;
  total: number;
}

export default function BulkSelectionBar({
  total,
  selectedCount,
  onSelectAll,
  onClear,
  onDelete,
  busy,
}: BulkSelectionBarProps) {
  const { t } = useTranslation('common');
  const allSelected = total > 0 && selectedCount === total;
  return (
    <Flexbox horizontal align="center" gap={12} wrap="wrap">
      <Checkbox
        checked={allSelected}
        disabled={busy || !total}
        indeterminate={selectedCount > 0 && !allSelected}
        onChange={allSelected ? onClear : onSelectAll}
      >
        {t('bulkDelete.selectVisible')}
      </Checkbox>
      <Button
        danger
        disabled={!selectedCount || busy}
        icon={TrashIcon}
        loading={busy}
        size="small"
        onClick={onDelete}
      >
        {t('bulkDelete.deleteSelected', { count: selectedCount })}
      </Button>
    </Flexbox>
  );
}
