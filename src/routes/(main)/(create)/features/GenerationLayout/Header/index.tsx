'use client';

import { Flexbox } from '@lobehub/ui';
import { ImagePlus, SearchIcon, Video } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { getRouteById } from '@/config/routes';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useMobileNavPanelController } from '@/features/NavPanel/MobileNavPanel';
import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useGlobalStore } from '@/store/global';

import type { GenerationLayoutCommonProps } from '../types';

const Header = memo<GenerationLayoutCommonProps>((props) => {
  const { t } = useTranslation('common');
  const { t: tGeneration } = useTranslation(props.namespace);
  const { breadcrumb, useStore } = props;
  const toggleCommandMenu = useGlobalStore((s) => s.toggleCommandMenu);
  const mobileNavPanel = useMobileNavPanelController();
  const openNewGenerationTopic = useStore((s: any) => s.openNewGenerationTopic);
  const navigate = useWorkspaceAwareNavigate();
  const { pathname } = useActiveLocation();

  return (
    <>
      <SideBarHeaderLayout breadcrumb={breadcrumb} />
      <Flexbox paddingInline={4}>
        <WorkspaceLink to="/page">
          <NavItem
            active={/(?:^|\/)page(?:\/|$)/.test(pathname)}
            icon={getRouteById('page')!.icon}
            title={t('tab.pages')}
          />
        </WorkspaceLink>
        <NavItem
          icon={props.namespace === 'image' ? ImagePlus : Video}
          key={'new-topic'}
          title={tGeneration('topic.createNew')}
          onClick={() => {
            openNewGenerationTopic();
            if (!pathname.endsWith(`/${props.namespace}`)) navigate(`/${props.namespace}`);
          }}
        />
        <NavItem
          icon={SearchIcon}
          key={'search'}
          title={t('tab.search')}
          onClick={() => {
            mobileNavPanel?.close();
            toggleCommandMenu(true);
          }}
        />
      </Flexbox>
    </>
  );
});

Header.displayName = 'GenerationLayoutHeader';

export default Header;
