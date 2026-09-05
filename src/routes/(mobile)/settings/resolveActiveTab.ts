import { SettingsTabs } from '@/store/global/initialState';

interface SettingsRouteHandle {
  settingsTab?: SettingsTabs;
}

interface SettingsRouteMatch {
  handle?: unknown;
}

export const resolveMobileSettingsTab = (
  routeTab: string | undefined,
  matches: SettingsRouteMatch[],
) => {
  if (routeTab) return routeTab as SettingsTabs;

  for (const match of [...matches].reverse()) {
    const handle = match.handle as SettingsRouteHandle | undefined;
    if (handle?.settingsTab) return handle.settingsTab;
  }

  return SettingsTabs.Profile;
};
