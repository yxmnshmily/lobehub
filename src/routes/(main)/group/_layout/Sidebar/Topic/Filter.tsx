import { ActionIcon, DropdownMenu } from '@lobehub/ui/base-ui';
import { ListFilter } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';

import { useTopicFilterDropdownMenu } from './useFilterMenu';

const Filter = memo<{ mobile?: boolean }>(({ mobile = false }) => {
  const { t } = useTranslation('topic');
  const menuItems = useTopicFilterDropdownMenu();
  const label = t('filter', { defaultValue: '筛选话题' });

  return (
    <DropdownMenu items={menuItems}>
      <ActionIcon
        aria-label={label}
        icon={ListFilter}
        size={mobile ? MOBILE_HEADER_ICON_SIZE : 'small'}
        title={label}
      />
    </DropdownMenu>
  );
});

export default Filter;
