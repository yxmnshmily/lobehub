import { describe, expect, it } from 'vitest';

import { SettingsTabs } from '@/store/global/initialState';

import { resolveMobileSettingsTab } from './resolveActiveTab';

describe('resolveMobileSettingsTab', () => {
  it('uses a dynamic path tab before route metadata', () => {
    expect(
      resolveMobileSettingsTab(SettingsTabs.Connector, [
        { handle: { settingsTab: SettingsTabs.Profile } },
      ]),
    ).toBe(SettingsTabs.Connector);
  });

  it('uses route metadata for literal mobile settings paths', () => {
    expect(
      resolveMobileSettingsTab(undefined, [{ handle: { settingsTab: SettingsTabs.Stats } }]),
    ).toBe(SettingsTabs.Stats);
  });

  it('falls back to profile when the route has no tab', () => {
    expect(resolveMobileSettingsTab(undefined, [])).toBe(SettingsTabs.Profile);
  });
});
