'use client';

import { Icon } from '@lobehub/ui';
import { SettingsIcon } from 'lucide-react';
import { type PropsWithChildren } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';

const Header = memo<PropsWithChildren>(() => {
  const { t } = useTranslation('common');

  return (
    <SideBarHeaderLayout
      showTogglePanelButton
      breadcrumb={[
        {
          href: '/settings/appearance',
          title: (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                color: 'inherit',
                fontSize: 14,
                whiteSpace: 'nowrap',
              }}
            >
              <Icon icon={SettingsIcon} />
              <span>{t('tab.setting')}</span>
            </span>
          ),
        },
      ]}
    />
  );
});

export default Header;
