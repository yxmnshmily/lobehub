'use client';

import { McpIcon, ProviderIcon, SkillsIcon } from '@lobehub/ui/icons';
import { createStaticStyles } from 'antd-style';
import { Bot, Brain, ShapesIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type NavItemProps } from '@/features/NavPanel/components/NavItem';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { DiscoverTab } from '@/types/discover';
import { isModifierClick } from '@/utils/navigation';

const styles = createStaticStyles(({ css }) => ({
  nav: css`
    overflow-x: auto;
    display: flex;
    flex: 1;
    flex-wrap: nowrap;
    min-width: 0;
    align-items: center;
    gap: 2px;

    /* Wrapping would grow past the fixed 64px header and overlap the content,
       so the tabs scroll horizontally instead (same pattern as the memory and
       group-profile tab strips). */
    overscroll-behavior-x: none;
    scrollbar-width: none;

    [data-nav-item] > :first-child {
      width: 20px;
      height: 24px;
    }

    > a {
      flex: none;
      white-space: nowrap;
    }
  `,
}));

interface Item {
  icon: NavItemProps['icon'];
  key: string;
  onClick?: () => void;
  title: NavItemProps['title'];
  url?: string;
}

const useActiveTabKey = () => {
  const { pathname } = useActiveLocation();
  if (pathname.endsWith('/community')) return DiscoverTab.Home;
  return (pathname.split('/community/').at(1) as DiscoverTab) || DiscoverTab.Home;
};

const Nav = memo(() => {
  const tab = useActiveTabKey();
  const navigate = useWorkspaceAwareNavigate();
  const { t } = useTranslation('discover');

  const items: Item[] = useMemo(
    () =>
      [
        {
          icon: ShapesIcon,
          key: DiscoverTab.Home,
          title: t('tab.home'),
          url: '/community',
        },
        {
          icon: Bot,
          key: DiscoverTab.Assistants,
          title: t('tab.assistant'),
          url: '/community/agent',
        },
        {
          icon: SkillsIcon,
          key: DiscoverTab.Skills,
          title: t('tab.skill'),
          url: '/community/skill',
        },
        {
          icon: McpIcon,
          key: DiscoverTab.Mcp,
          title: `MCP`,
          url: '/community/mcp',
        },
        {
          icon: Brain,
          key: DiscoverTab.Models,
          title: t('tab.model'),
          url: '/community/model',
        },
        {
          icon: ProviderIcon,
          key: DiscoverTab.Providers,
          title: t('tab.provider'),
          url: '/community/provider',
        },
      ] as Item[],
    [t],
  );

  return (
    <nav aria-label={t('tab.community', { ns: 'common' })} className={styles.nav}>
      {items.map((item) => {
        const content = (
          <NavItem
            active={tab.startsWith(item.key)}
            icon={item.icon}
            key={item.key}
            title={item.title}
            onClick={item.onClick}
          />
        );
        if (!item.url) return content;

        return (
          <WorkspaceLink
            aria-current={tab.startsWith(item.key) ? 'page' : undefined}
            key={item.key}
            to={item.url}
            onClick={(e) => {
              if (isModifierClick(e)) return;
              e.preventDefault();
              item?.onClick?.();
              if (item.url) {
                navigate(item.url);
              }
            }}
          >
            <NavItem
              active={tab.startsWith(item.key)}
              gap={4}
              height={32}
              icon={item.icon}
              iconSize={16}
              paddingInline={6}
              title={item.title}
            />
          </WorkspaceLink>
        );
      })}
    </nav>
  );
});

export default Nav;
