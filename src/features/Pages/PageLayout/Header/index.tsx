'use client';

import { Flexbox } from '@lobehub/ui';
import { SearchIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import GenerationMediaModeSegment from '@/routes/(main)/(create)/features/GenerationInput/GenerationMediaModeSegment';
import { useGlobalStore } from '@/store/global';

import AddButton from './AddButton';

const Header = memo(() => {
  const { t } = useTranslation('common');
  const toggleCommandMenu = useGlobalStore((s) => s.toggleCommandMenu);

  return (
    <>
      <SideBarHeaderLayout
        breadcrumb={[
          {
            title: <GenerationMediaModeSegment layout="sidebar" mode="page" />,
          },
        ]}
      />
      <Flexbox paddingInline={4}>
        <AddButton showLabel />
        <NavItem
          icon={SearchIcon}
          key={'search'}
          title={t('tab.search')}
          onClick={() => toggleCommandMenu(true)}
        />
      </Flexbox>
    </>
  );
});

export default Header;
