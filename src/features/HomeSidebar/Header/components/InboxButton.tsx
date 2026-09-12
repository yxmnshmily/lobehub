'use client';

import { ActionIcon } from '@lobehub/ui/base-ui';
import { Badge } from 'antd';
import { BellIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';

import { openInboxModal } from './InboxModal';
import { useInboxUnreadCount } from './useInboxUnreadCount';

const InboxButton = memo(() => {
  const { t } = useTranslation('notification');
  const { enabled, unreadCount } = useInboxUnreadCount();

  const handleOpen = useCallback(() => openInboxModal(), []);

  if (!enabled) return null;

  return (
    <Badge data-nav-expanded-only="" dot={unreadCount > 0} offset={[-6, 6]} size="small">
      <ActionIcon
        aria-label={t('inbox.title')}
        icon={BellIcon}
        size={DESKTOP_HEADER_ICON_SMALL_SIZE}
        title={t('inbox.title')}
        onClick={handleOpen}
      />
    </Badge>
  );
});

export default InboxButton;
