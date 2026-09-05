'use client';

import { Accordion, AccordionItem, Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { memo, useMemo } from 'react';
import { Link } from 'react-router';

import NavItem from '@/features/NavPanel/components/NavItem';
import { getTabUrl, SearchSection } from '@/features/SettingsSearch';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { SettingsTabs } from '@/store/global/initialState';
import { isModifierClick } from '@/utils/navigation';

import { useCategory } from '../../hooks/useCategory';

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
  const navigate = useWorkspaceAwareNavigate();
  const location = useActiveLocation();
  const expandedGroupKeys = useMemo(() => categoryGroups.map(({ key }) => key), [categoryGroups]);

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
        group.items.some(
          (item) => item.href && doesSettingsHrefMatch(item.href, location),
        ),
      ),
    [categoryGroups, location],
  );

  return (
    <Flexbox gap={4} paddingInline={4}>
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
                {group.items.map((item) => {
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
                })}
              </Flexbox>
            </AccordionItem>
          ))}
        </Accordion>
      </SearchSection>
    </Flexbox>
  );
});

export default Body;
