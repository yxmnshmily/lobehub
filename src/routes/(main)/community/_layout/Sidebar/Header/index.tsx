'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Users } from 'lucide-react';
import { type PropsWithChildren } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';

const Header = memo<PropsWithChildren>(() => {
  const { t } = useTranslation('common');
  return (
    <>
      <SideBarHeaderLayout
        breadcrumb={[
          {
            href: '/community',
            title: (
              <Flexbox
                horizontal
                align="center"
                gap={6}
                style={{ color: 'inherit', fontSize: 14, whiteSpace: 'nowrap' }}
              >
                <Icon icon={Users} />
                <span>{t('tab.community')}</span>
              </Flexbox>
            ),
          },
        ]}
      />
    </>
  );
});

export default Header;
