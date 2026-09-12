import { useActiveLocation } from '@/hooks/useActiveLocation';
import { usePathname, useSearchParams } from '@/libs/router/navigation';
import { ProfileTabs, SettingsTabs, SidebarTabKey } from '@/store/global/initialState';

/**
 * Returns the active tab key (chat/market/settings/...)
 * React Router version for SPA
 */
export const useActiveTabKey = () => {
  const { pathname } = useActiveLocation();
  return resolveActiveTabKey(pathname);
};

const sidebarTabKeys = new Set<string>(Object.values(SidebarTabKey));

export const resolveActiveTabKey = (pathname: string) => {
  const segments = pathname.split('/').filter(Boolean);
  const firstKnownTab = segments.slice(0, 2).find((segment) => sidebarTabKeys.has(segment));

  return (
    (firstKnownTab as SidebarTabKey | undefined) ??
    (segments[0] as SidebarTabKey | undefined) ??
    SidebarTabKey.Home
  );
};

/**
 * Returns the active setting page key (?active=common/sync/agent/...)
 * React Router version for SPA
 */
export const useActiveSettingsKey = () => {
  const [searchParams] = useSearchParams();
  const tabs = searchParams.get('active');
  if (!tabs) return SettingsTabs.Appearance;
  return tabs as SettingsTabs;
};

/**
 * Returns the active profile page key (profile/security/stats/...)
 * React Router version for SPA
 */
export const useActiveProfileKey = () => {
  const pathname = usePathname();

  const tabs = pathname.split('/').at(-1);

  if (tabs === 'profile') return ProfileTabs.Profile;

  return tabs as ProfileTabs;
};
