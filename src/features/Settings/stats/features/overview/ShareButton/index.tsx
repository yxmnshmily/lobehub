'use client';

import { ActionIcon } from '@lobehub/ui/base-ui';
import { Share2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SIZE, MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';

import ShareModal from './ShareModal';

const ShareButton = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);

  return (
    <>
      <ActionIcon
        aria-label={t('share')}
        icon={Share2Icon}
        size={mobile ? MOBILE_HEADER_ICON_SIZE : DESKTOP_HEADER_ICON_SIZE}
        title={t('share')}
        style={
          mobile
            ? {
                flex: '0 0 44px',
                height: 44,
                width: 44,
              }
            : undefined
        }
        onClick={() => setOpen(true)}
      />
      <ShareModal mobile={mobile} open={open} onCancel={() => setOpen(false)} />
    </>
  );
});

export default ShareButton;
