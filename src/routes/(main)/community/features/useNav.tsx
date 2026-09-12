import { MCP } from '@lobehub/icons';
import { Icon } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { Bot, Brain, BrainCircuit, House } from 'lucide-react';
import { type ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { type MenuProps } from '@/components/Menu';
import { DiscoverTab } from '@/types/discover';

const ICON_SIZE = 16;

export interface CommunityNavItem {
  icon: ReactNode;
  key: DiscoverTab;
  label: ReactNode;
  title: string;
}

const COMMUNITY_LIST_TABS = [
  DiscoverTab.Home,
  DiscoverTab.Assistants,
  DiscoverTab.Skills,
  DiscoverTab.Mcp,
  DiscoverTab.Models,
  DiscoverTab.Providers,
] as const;

export const getCommunityCategoryPath = (key: string) =>
  key === DiscoverTab.Home ? '/community' : `/community/${key}`;

export const useNav = () => {
  const location = useLocation();
  const { t } = useTranslation('discover');
  const activeKey = useMemo(() => {
    const routeSegment = location.pathname.split('/community/').at(1)?.split('/').at(0);
    if (routeSegment === DiscoverTab.Plugins) return DiscoverTab.Mcp;
    if (COMMUNITY_LIST_TABS.includes(routeSegment as (typeof COMMUNITY_LIST_TABS)[number])) {
      return routeSegment as (typeof COMMUNITY_LIST_TABS)[number];
    }
    return DiscoverTab.Home;
  }, [location.pathname]);

  const navItems = useMemo<CommunityNavItem[]>(() => {
    const createItem = (item: Omit<CommunityNavItem, 'label'>): CommunityNavItem => ({
      ...item,
      label: <span style={{ color: 'inherit' }}>{item.title}</span>,
    });

    return [
      createItem({
        icon: <Icon icon={House} size={ICON_SIZE} />,
        key: DiscoverTab.Home,
        title: t('tab.home'),
      }),
      createItem({
        icon: <Icon icon={Bot} size={ICON_SIZE} />,
        key: DiscoverTab.Assistants,
        title: t('tab.assistant'),
      }),
      createItem({
        icon: <SkillsIcon size={ICON_SIZE} />,
        key: DiscoverTab.Skills,
        title: t('tab.skill'),
      }),
      createItem({
        icon: <MCP className={'anticon'} size={ICON_SIZE} />,
        key: DiscoverTab.Mcp,
        title: `MCP ${t('tab.plugin')}`,
      }),
      createItem({
        icon: <Icon icon={Brain} size={ICON_SIZE} />,
        key: DiscoverTab.Models,
        title: t('tab.model'),
      }),
      createItem({
        icon: <Icon icon={BrainCircuit} size={ICON_SIZE} />,
        key: DiscoverTab.Providers,
        title: t('tab.provider'),
      }),
    ];
  }, [t]);

  const activeItem = navItems.find((item) => item.key === activeKey);
  const items = navItems as MenuProps['items'];

  return {
    activeItem,
    activeKey,
    items,
    navItems,
  };
};
