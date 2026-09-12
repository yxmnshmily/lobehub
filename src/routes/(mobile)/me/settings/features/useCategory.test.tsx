import { act, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mapFeatureFlagsEnvToState } from '@/config/featureFlags';
import { SettingsTabs } from '@/store/global/initialState';
import { initServerConfigStore, Provider } from '@/store/serverConfig/store';
import { useUserStore } from '@/store/user';

import { SettingsGroupKey, useCategory } from './useCategory';

const navigate = vi.fn();
const platformAccess = vi.hoisted(() => ({ isLoading: false, isPlatformAdmin: false }));
const initialUserStoreState = useUserStore.getState();

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    platformAccess: {
      isPlatformAdmin: {
        useQuery: () => ({
          data: platformAccess.isPlatformAdmin,
          isLoading: platformAccess.isLoading,
        }),
      },
    },
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider
    createStore={() =>
      initServerConfigStore({
        featureFlags: {
          ...mapFeatureFlagsEnvToState({ provider_settings: true }),
          showProvider: true,
        },
        serverConfig: { aiProvider: {}, enableBusinessFeatures: true, telemetry: {} },
      })
    }
  >
    {children}
  </Provider>
);

afterEach(() => {
  navigate.mockClear();
  platformAccess.isLoading = false;
  platformAccess.isPlatformAdmin = false;
  act(() => useUserStore.setState(initialUserStoreState, true));
});

describe('mobile customer center categories', () => {
  it('moves credentials and storage into advanced without changing their destinations', () => {
    platformAccess.isPlatformAdmin = true;
    const { result } = renderHook(useCategory, { wrapper });
    const advanced = result.current.find((group) => group.key === SettingsGroupKey.Developer)!;
    expect(advanced.items.map((item) => item.key)).toEqual(
      expect.arrayContaining([SettingsTabs.Creds, SettingsTabs.Storage]),
    );
    advanced.items.find((item) => item.key === SettingsTabs.Creds)?.onClick?.();
    expect(navigate).toHaveBeenCalledWith('/settings/credential', { escape: true });
  });
  it('shows only account, service ledger, records, and works', () => {
    act(() =>
      useUserStore.setState({
        isSignedIn: true,
        user: { avatar: '/avatar.png', fullName: '桂林旅行者', id: 'customer-1' } as any,
      }),
    );
    const { result } = renderHook(() => useCategory(), { wrapper });
    const items = result.current.flatMap((group) => group.items);

    expect(items.map((item) => item.key)).toEqual([
      SettingsTabs.Profile,
      SettingsTabs.Security,
      SettingsTabs.Credits,
      SettingsTabs.Usage,
      SettingsTabs.Works,
    ]);
    expect(items[0].label).toBe('桂林旅行者');
    expect(result.current[1].items.map((item) => item.label)).toEqual([
      '积分余额',
      '账户用量',
      '本人生成记录',
    ]);

    items.find((item) => item.key === SettingsTabs.Usage)?.onClick?.();
    items.find((item) => item.key === SettingsTabs.Works)?.onClick?.();
    expect(navigate.mock.calls).toEqual([
      ['/settings/usage', { escape: true }],
      ['/settings/credits?section=my-creations', { escape: true }],
    ]);
    expect(items.some((item) => item.key === ('private-group' as SettingsTabs))).toBe(false);
  });

  it('restores mobile platform settings and the service-operations entry for super_admin', () => {
    platformAccess.isPlatformAdmin = true;
    act(() =>
      useUserStore.setState({
        preference: {
          ...initialUserStoreState.preference,
          lab: { ...initialUserStoreState.preference.lab, enableOAuthApps: true },
        },
      }),
    );
    const { result } = renderHook(() => useCategory(), { wrapper });
    const items = result.current.flatMap((group) => group.items);
    const general = result.current.find((group) => group.key === SettingsGroupKey.General)!;

    expect(general.items.map((item) => item.key)).toEqual([
      SettingsTabs.Appearance,
      SettingsTabs.Devices,
      SettingsTabs.Hotkey,
      SettingsTabs.Notification,
    ]);

    expect(result.current.map((group) => group.key)).toEqual([
      SettingsGroupKey.General,
      SettingsGroupKey.Subscription,
      SettingsGroupKey.Agent,
      SettingsGroupKey.System,
      SettingsGroupKey.Developer,
      SettingsGroupKey.Operations,
    ]);

    expect(items.map((item) => item.key)).toEqual(
      expect.arrayContaining([
        SettingsTabs.Appearance,
        SettingsTabs.Devices,
        SettingsTabs.Hotkey,
        SettingsTabs.Notification,
        SettingsTabs.Provider,
        SettingsTabs.ServiceModel,
        SettingsTabs.Skill,
        SettingsTabs.Community,
        SettingsTabs.Messenger,
        SettingsTabs.Creds,
        SettingsTabs.Storage,
        SettingsTabs.Advanced,
        SettingsTabs.ServiceOperations,
      ]),
    );

    for (const item of items) item.onClick?.();
    expect(navigate.mock.calls).toEqual(
      items.map((item) => [item.href, { escape: true }]),
    );

    navigate.mockClear();

    items.find((item) => item.key === SettingsTabs.Provider)?.onClick?.();
    items.find((item) => item.key === SettingsTabs.ServiceModel)?.onClick?.();
    items.find((item) => item.key === SettingsTabs.Skill)?.onClick?.();
    items.find((item) => item.key === SettingsTabs.Labels)?.onClick?.();
    items.find((item) => item.key === SettingsTabs.ServiceOperations)?.onClick?.();

    expect(navigate.mock.calls).toEqual([
      ['/settings/provider/all', { escape: true }],
      ['/settings/service-model', { escape: true }],
      ['/settings/skill', { escape: true }],
      ['/settings/labels', { escape: true }],
      ['/settings/service-operations', { escape: true }],
    ]);
  });

  it('keeps the mobile admin menu hidden while role loading is unresolved', () => {
    platformAccess.isLoading = true;
    platformAccess.isPlatformAdmin = true;
    const { result } = renderHook(() => useCategory(), { wrapper });
    const keys = result.current.flatMap((group) => group.items.map((item) => item.key));

    expect(keys).not.toContain(SettingsTabs.Provider);
    expect(keys).not.toContain(SettingsTabs.ServiceOperations);
  });
});
