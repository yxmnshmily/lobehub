'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { FolderOpen } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import ResourceModeToggle from '@/features/ResourceManager/components/ResourceModeToggle';

import CategoryMenu from './CategoryMenu';

const Header = memo(() => {
  const { t } = useTranslation('common');

  return (
    <>
      <SideBarHeaderLayout
        right={<ResourceModeToggle />}
        breadcrumb={[
          {
            href: '/resource',
            title: (
              <Flexbox
                horizontal
                align="center"
                gap={6}
                style={{ color: 'inherit', fontSize: 14, whiteSpace: 'nowrap' }}
              >
                <Icon icon={FolderOpen} />
                <span>{t('tab.resource')}</span>
              </Flexbox>
            ),
          },
        ]}
      />
      <CategoryMenu />
    </>
  );
});

export default Header;
