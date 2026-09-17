'use client';

import { Accordion, AccordionItem, Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { SearchIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import CompactListPopover from '@/features/NavPanel/components/CompactListPopover';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useEffectiveNavPanelExpanded } from '@/features/NavPanel/hooks/useEffectiveNavPanelExpanded';
import { getTabUrl, SearchSection } from '@/features/SettingsSearch';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { SettingsTabs } from '@/store/global/initialState';
import { isModifierClick } from '@/utils/navigation';

import { useCategory } from '../../hooks/useCategory';

const styles = createStaticStyles(({ css }) => ({
  expandedMenu: css`
    padding-block: 4px 16px;
    padding-inline: 8px;

    a {
      color: inherit;
      text-decoration: none;
    }

    [data-nav-item] {
      height: 40px !important;
      padding-inline: 8px;
      border-radius: 12px;
    }

    [data-nav-item][data-active='true'],
    [data-nav-item][aria-current='page'] {
      background: ${cssVar.colorFillSecondary};
    }
  `,
}));

interface SettingsCategoryItemLocation {
  pathname: string;
  search: string;
}

interface SettingsCategoryItemIdentity {
  href?: string;
  key: string;
}

const doesSettingsHrefMatch = (href: string, currentLocation: SettingsCategoryItemLocation) => {
  const [pathname, query = ''] = href.split('?');
  if (pathname === '/community' && !query) {
    return (
      currentLocation.pathname === pathname || currentLocation.pathname.startsWith(`${pathname}/`)
    );
  }
  if (pathname !== currentLocation.pathname) return false;

  const expectedParams = new URLSearchParams(query);
  if (!query) return currentLocation.search.length === 0;

  const currentParams = new URLSearchParams(currentLocation.search);
  return [...expectedParams].every(([key, value]) => currentParams.get(key) === value);
};

export const isSettingsCategoryItemActive = ({
  activeTab,
  currentLocation,
  hasCustomHrefMatch,
  item,
}: {
  activeTab: string;
  currentLocation: SettingsCategoryItemLocation;
  hasCustomHrefMatch: boolean;
  item: SettingsCategoryItemIdentity;
}) =>
  item.href
    ? doesSettingsHrefMatch(item.href, currentLocation)
    : !hasCustomHrefMatch && activeTab === item.key;

const Body = memo(() => {
  const categoryGroups = useCategory();
  const { t } = useTranslation('setting');
  /* 与 64px 外壳（NavPanelDraggable）用同一套判定：视口收窄到 lg 以下时自动进入
     图标栏 + CompactListPopover 弹出菜单，而不是把展开菜单塞进 64px 里。 */
  const expanded = useEffectiveNavPanelExpanded();
  const navigate = useWorkspaceAwareNavigate();
  const location = useActiveLocation();
  const [groupExpansion, setGroupExpansion] = useState<Record<string, boolean>>({});
  const defaultExpandedGroupKeys = useMemo(
    () =>
      categoryGroups
        .filter(
          (group) =>
            group.key !== 'developer' ||
            group.items.some(
              (item) =>
                location.pathname === getTabUrl(item.key) ||
                location.pathname.startsWith(`${getTabUrl(item.key)}/`),
            ),
        )
        .map(({ key }) => key),
    [categoryGroups, location.pathname],
  );

  useEffect(() => {
    // Capture each group's first visible default, including groups that arrive
    // after the admin query. Later routes must not move the navigation targets.
    setGroupExpansion((previous) => {
      const missing = categoryGroups.filter(({ key }) => !(key in previous));
      if (!missing.length) return previous;
      return {
        ...previous,
        ...Object.fromEntries(
          missing.map(({ key }) => [key, defaultExpandedGroupKeys.includes(key)]),
        ),
      };
    });
  }, [categoryGroups, defaultExpandedGroupKeys]);

  // Route changes must not remount the accordion and reopen user-collapsed groups.
  const expandedGroupKeys = categoryGroups
    .filter(({ key }) => groupExpansion[key] ?? defaultExpandedGroupKeys.includes(key))
    .map(({ key }) => key);

  // Extract current tab from pathname: /settings/profile -> profile
  const activeTab = useMemo(() => {
    const pathParts = location.pathname.split('/');
    // pathname is like /settings/profile or /settings/provider/xxx
    if (pathParts.length >= 3) {
      return pathParts[2] as SettingsTabs;
    }
    return SettingsTabs.Profile;
  }, [location.pathname]);
  const hasCustomHrefMatch = useMemo(
    () =>
      categoryGroups.some((group) =>
        group.items.some((item) => item.href && doesSettingsHrefMatch(item.href, location)),
      ),
    [categoryGroups, location],
  );

  const renderItem = (item: (typeof categoryGroups)[number]['items'][number]) => {
    const url = item.href ?? getTabUrl(item.key);
    return (
      <Link
        key={item.key}
        to={url}
        onClick={(e) => {
          if (isModifierClick(e)) return;
          e.preventDefault();
          navigate(url);
        }}
      >
        <NavItem
          icon={item.icon}
          title={item.label}
          active={isSettingsCategoryItemActive({
            activeTab,
            currentLocation: location,
            hasCustomHrefMatch,
            item,
          })}
        />
      </Link>
    );
  };

  const groupsMenu = (
    <Accordion
      expandedKeys={expandedGroupKeys}
      gap={8}
      onExpandedChange={(keys) => {
        setGroupExpansion((previous) => {
          const next = { ...previous };
          for (const { key } of categoryGroups) {
            // Store only user changes; newly available groups keep their defaults.
            if (keys.includes(key) !== expandedGroupKeys.includes(key)) {
              next[key] = keys.includes(key);
            }
          }
          return next;
        });
      }}
    >
      {categoryGroups.map((group) => (
        <AccordionItem
          itemKey={group.key}
          key={group.key}
          paddingBlock={4}
          paddingInline={'8px 4px'}
          title={
            <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
              {group.title}
            </Text>
          }
        >
          <Flexbox gap={1} paddingBlock={1}>
            {group.items.map(renderItem)}
          </Flexbox>
        </AccordionItem>
      ))}
    </Accordion>
  );

  if (!expanded) {
    return (
      <Flexbox gap={4} paddingInline={4}>
        {/* 窄屏图标栏：搜索不再依赖展开偏好（自动收窄时 togglePanel 不生效），
            改为与其它图标一致的弹出层——默认展示完整菜单，输入即出搜索结果。 */}
        <CompactListPopover icon={SearchIcon} title={t('settingsSearch.placeholder')}>
          <SearchSection>{groupsMenu}</SearchSection>
        </CompactListPopover>
        {categoryGroups.map((group) => {
          const currentItem =
            group.items.find((item) =>
              isSettingsCategoryItemActive({
                activeTab,
                currentLocation: location,
                hasCustomHrefMatch,
                item,
              }),
            ) ?? group.items[0];
          if (!currentItem) return null;

          return (
            <CompactListPopover icon={currentItem.icon} key={group.key} title={group.title}>
              <Flexbox gap={1}>{group.items.map(renderItem)}</Flexbox>
            </CompactListPopover>
          );
        })}
      </Flexbox>
    );
  }

  return (
    <Flexbox className={styles.expandedMenu} gap={4}>
      <SearchSection>{groupsMenu}</SearchSection>
    </Flexbox>
  );
});

export default Body;
