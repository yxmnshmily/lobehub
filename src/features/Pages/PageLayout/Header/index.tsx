'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { FileText, SearchIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import NavItem from '@/features/NavPanel/components/NavItem';
import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import { useGlobalStore } from '@/store/global';

import AddButton from './AddButton';

const Header = memo(() => {
  const { t } = useTranslation('common');
  const toggleCommandMenu = useGlobalStore((s) => s.toggleCommandMenu);
  // In workspace mode the create button lives inside each accordion header
  // (Private / Workspace) so the visibility bucket is picked at the source.
  // Personal mode still has a single unified list, so keep the header entry.
  const activeWorkspaceId = useActiveWorkspaceId();

  return (
    <>
      <SideBarHeaderLayout
        right={activeWorkspaceId ? undefined : <AddButton />}
        breadcrumb={[
          {
            href: '/page',
            title: (
              <Flexbox
                horizontal
                align="center"
                gap={6}
                style={{ color: 'inherit', fontSize: 14, whiteSpace: 'nowrap' }}
              >
                <Icon icon={FileText} />
                <span>{t('tab.pages')}</span>
              </Flexbox>
            ),
          },
        ]}
      />
      <Flexbox paddingInline={4}>
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
