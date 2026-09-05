import { DropdownMenu } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { MoreHorizontal } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';

import { useTopicActionsDropdownMenu } from './useDropdownMenu';

const Actions = memo<{ mobile?: boolean }>(({ mobile = false }) => {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const menuItems = useTopicActionsDropdownMenu({ onUploadClose: () => setOpen(false) });
  const label = t('more');

  return (
    <DropdownMenu items={menuItems} open={open} onOpenChange={setOpen}>
      <ActionIcon
        aria-label={label}
        icon={MoreHorizontal}
        size={mobile ? MOBILE_HEADER_ICON_SIZE : 'small'}
        title={label}
      />
    </DropdownMenu>
  );
});

export default Actions;
