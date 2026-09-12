'use client';

import { Accordion, AccordionItem, Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { SearchIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import CompactListPopover from '@/features/NavPanel/components/CompactListPopover';
import NavItem from '@/features/NavPanel/components/NavItem';
import { getTabUrl, SearchSection } from '@/features/SettingsSearch';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useGlobalStore } from '@/store/global';
import { SettingsTabs } from '@/store/global/initialState';
import { systemStatusSelectors } from '@/store/global/selectors';
import { isModifierClick } from '@/utils/navigation';

import { useCategory } from '../../hooks/useCategory';

const styles = createStaticStyles(({ css }) => ({
  expandedMenu: css`
    padding: 4px 8px 16px;

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
  const expanded = useGlobalStore(systemStatusSelectors.showLeftPanel);
  const togglePanel = useGlobalStore((s) => s.toggleLeftPanel);
  const navigate = useWorkspaceAwareNavigate();
  const location = useActiveLocation();
  const expandedGroupKeys = useMemo(
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

  if (!expanded) {
    return (
      <Flexbox gap={4} paddingInline={4}>
        <NavItem
          icon={SearchIcon}
          title={t('settingsSearch.placeholder')}
          onClick={() => togglePanel(true)}
        />
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
      <SearchSection>
        <Accordion
          defaultExpandedKeys={expandedGroupKeys}
          gap={8}
          key={expandedGroupKeys.join(':')}
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
      </SearchSection>
    </Flexbox>
  );
});

export default Body;
