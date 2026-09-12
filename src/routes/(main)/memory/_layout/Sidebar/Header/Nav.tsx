'use client';

import { Flexbox } from '@lobehub/ui';
import {
  BrainCircuitIcon,
  BubblesIcon,
  CalendarClockIcon,
  HeartPulseIcon,
  LightbulbIcon,
  SearchIcon,
  SignatureIcon,
} from 'lucide-react';
import { memo, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { type NavItemProps } from '@/features/NavPanel/components/NavItem';
import NavItem from '@/features/NavPanel/components/NavItem';
import ToggleLeftPanelButton from '@/features/NavPanel/ToggleLeftPanelButton';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useGlobalStore } from '@/store/global';
import { isModifierClick } from '@/utils/navigation';

import { styles } from '../../style';

interface Item {
  icon: NavItemProps['icon'];
  key: string;
  onClick?: () => void;
  title: NavItemProps['title'];
  url?: string;
}

enum MemoryTabKey {
  Activities = 'activities',
  Contexts = 'contexts',
  Experiences = 'experiences',
  Home = 'home',
  Identities = 'identities',
  Preferences = 'preferences',
}

const useActiveTabKey = () => {
  const { pathname } = useActiveLocation();
  if (pathname === '/memory') return MemoryTabKey.Home;
  return (pathname.split('/memory/').find(Boolean)! as MemoryTabKey) || MemoryTabKey.Home;
};

const Nav = memo(({ horizontal = false }: { horizontal?: boolean }) => {
  const tab = useActiveTabKey();
  const navigate = useWorkspaceAwareNavigate();
  const tabsRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation('memory');
  const toggleCommandMenu = useGlobalStore((s) => s.toggleCommandMenu);

  const items: Item[] = useMemo(
    () => [
      {
        icon: BrainCircuitIcon,
        key: MemoryTabKey.Home,
        title: t('tab.home'),
        url: '/memory',
      },
      {
        icon: SignatureIcon,
        key: MemoryTabKey.Identities,
        title: t('tab.identities'),
        url: '/memory/identities',
      },
      {
        icon: BubblesIcon,
        key: MemoryTabKey.Contexts,
        title: t('tab.contexts'),
        url: '/memory/contexts',
      },
      {
        icon: HeartPulseIcon,
        key: MemoryTabKey.Preferences,
        title: t('tab.preferences'),
        url: '/memory/preferences',
      },
      {
        icon: LightbulbIcon,
        key: MemoryTabKey.Experiences,
        title: t('tab.experiences'),
        url: '/memory/experiences',
      },
      {
        icon: CalendarClockIcon,
        key: MemoryTabKey.Activities,
        title: t('tab.activities'),
        url: '/memory/activities',
      },
    ],
    [t],
  );

  const search = (
    <NavItem icon={SearchIcon} title={t('tab.search')} onClick={() => toggleCommandMenu(true)} />
  );

  useEffect(() => {
    if (!horizontal || !tabsRef.current) return;

    const activeItem = tabsRef.current.querySelector<HTMLElement>('[aria-current="page"]');
    if (!activeItem) return;

    const tabsRect = tabsRef.current.getBoundingClientRect();
    const activeItemRect = activeItem.getBoundingClientRect();
    const isVisible = activeItemRect.left >= tabsRect.left && activeItemRect.right <= tabsRect.right;

    if (!isVisible) {
      activeItem.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
    }
  }, [horizontal, tab]);

  return (
    <Flexbox
      className={horizontal ? styles.navigationRow : undefined}
      gap={4}
      horizontal={horizontal}
      paddingInline={4}
    >
      {horizontal ? <ToggleLeftPanelButton /> : search}
      <Flexbox
        className={horizontal ? styles.navigationTabs : undefined}
        gap={4}
        horizontal={horizontal}
        ref={tabsRef}
      >
        {items.map((item) => {
          const content = (
            <NavItem
              active={tab === item.key}
              icon={item.icon}
              key={item.key}
              title={item.title}
              onClick={item.onClick}
            />
          );
          if (!item.url) return content;

          return (
            <Link
              aria-current={tab === item.key ? 'page' : undefined}
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
              <NavItem active={tab === item.key} icon={item.icon} title={item.title} />
            </Link>
          );
        })}
      </Flexbox>
      {horizontal && <div className={styles.navigationSearch}>{search}</div>}
    </Flexbox>
  );
});

export default Nav;
