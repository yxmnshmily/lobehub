'use client';

import { Tooltip } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { useResponsive } from 'antd-style';
import { PlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE, MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { usePermission } from '@/hooks/usePermission';

import { createCreateNewProviderModal } from '../features/CreateNewProvider';

const AddNewProvider = () => {
  const { t } = useTranslation('modelProvider');
  const { mobile = false } = useResponsive();
  const { allowed: canManageProvider, reason } = usePermission('manage_provider_key');
  const label = canManageProvider
    ? t('menu.addCustomProvider')
    : reason || t('menu.addCustomProvider');

  const button = (
    <ActionIcon
      aria-label={label}
      disabled={!canManageProvider}
      icon={PlusIcon}
      size={mobile ? MOBILE_HEADER_ICON_SIZE : DESKTOP_HEADER_ICON_SMALL_SIZE}
      style={mobile ? { flex: '0 0 44px', minWidth: 44 } : undefined}
      title={label}
      onClick={() => {
        if (!canManageProvider) return;
        createCreateNewProviderModal();
      }}
    />
  );

  return canManageProvider ? button : <Tooltip title={reason}>{button}</Tooltip>;
};

export default AddNewProvider;
