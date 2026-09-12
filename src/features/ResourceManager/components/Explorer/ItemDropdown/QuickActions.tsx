import { Flexbox, stopPropagation } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import type { ItemType } from 'antd/es/menu/interface';
import { useTranslation } from 'react-i18next';

import { useFileItemDropdown } from './useFileItemDropdown';

export const QuickActions = ({ menuItems }: { menuItems: ItemType[] | (() => ItemType[]) }) => {
  const { t } = useTranslation('common');
  const items = typeof menuItems === 'function' ? menuItems() : menuItems;
  return (
    <Flexbox
      horizontal
      gap={4}
      justify="flex-end"
      padding={8}
      wrap="wrap"
      onClick={stopPropagation}
      onPointerDown={stopPropagation}
    >
      {(['copyContent', 'download', 'delete'] as const).map((key) => {
        const item = items.find((entry) => entry && 'key' in entry && entry.key === key);
        if (!item || !('onClick' in item)) return null;
        return (
          <Button
            danger={key === 'delete'}
            disabled={item.disabled}
            key={key}
            size="small"
            style={{ minHeight: 32, paddingInline: 8 }}
            title={typeof item.label === 'string' ? item.label : undefined}
            type="default"
            onClick={async (event) => {
              event.stopPropagation();
              try {
                await item.onClick?.({
                  domEvent: event,
                  item: event.currentTarget,
                  key,
                  keyPath: [key],
                });
              } catch {
                toast.error(t('operationFailed'));
              }
            }}
          >
            {t(key === 'copyContent' ? 'copy' : key)}
          </Button>
        );
      })}
    </Flexbox>
  );
};

export default function ResourceQuickActions(props: Parameters<typeof useFileItemDropdown>[0]) {
  const { menuItems } = useFileItemDropdown(props);
  return <QuickActions menuItems={menuItems} />;
}
