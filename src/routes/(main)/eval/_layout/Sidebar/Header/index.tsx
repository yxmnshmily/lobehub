'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Gauge } from 'lucide-react';
import { memo, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';

const Header = memo<PropsWithChildren>(() => {
  const { t } = useTranslation('common');
  return (
    <SideBarHeaderLayout
      breadcrumb={[
        {
          href: '/eval',
          title: (
            <Flexbox
              horizontal
              align="center"
              gap={6}
              style={{ color: 'inherit', fontSize: 14, whiteSpace: 'nowrap' }}
            >
              <Icon icon={Gauge} />
              <span>{t('tab.eval')}</span>
            </Flexbox>
          ),
        },
      ]}
    />
  );
});

export default Header;
