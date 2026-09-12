import { cleanup, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mapFeatureFlagsEnvToState } from '@/config/featureFlags';
import { SettingsTabs } from '@/store/global/initialState';
import { initServerConfigStore, Provider } from '@/store/serverConfig/store';
import { useUserStore } from '@/store/user';

import { SettingsGroupKey, useCategory } from './useCategory';

const platformAccess = vi.hoisted(() => ({ isLoading: false, isPlatformAdmin: false }));

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

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    },
  });
});

const createWrapper = (showProvider: boolean) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <Provider
      createStore={() =>
        initServerConfigStore({
          featureFlags: {
            ...mapFeatureFlagsEnvToState({
              provider_settings: true,
            }),
            showProvider,
          },
          serverConfig: { aiProvider: {}, enableBusinessFeatures: true, telemetry: {} },
        })
      }
    >
      {children}
    </Provider>
  );

  return Wrapper;
};

const getItemKeys = () => {
  const { result } = renderHook(() => useCategory(), {
    wrapper: createWrapper(true),
  });

  return result.current.flatMap((group) => group.items.map((item) => item.key));
};

const initialUserStoreState = useUserStore.getState();

afterEach(() => {
  cleanup();
  platformAccess.isLoading = false;
  platformAccess.isPlatformAdmin = false;
  useUserStore.setState(initialUserStoreState, true);
});

describe('settings useCategory', () => {
  it('keeps technical entries together without losing or duplicating navigation targets', () => {
    platformAccess.isPlatformAdmin = true;
    const { result } = renderHook(useCategory, { wrapper: createWrapper(true) });
    const advanced = result.current.find((group) => group.key === SettingsGroupKey.Developer)!;
    const technical = [SettingsTabs.Creds, SettingsTabs.Storage, SettingsTabs.Labs];
    expect(advanced.items.map((item) => item.key)).toEqual(expect.arrayContaining(technical));
    const everyday = result.current
      .filter((group) => group !== advanced)
      .flatMap((group) => group.items.map((item) => item.key));
    for (const key of technical) expect(everyday).not.toContain(key);
    const allKeys = result.current.flatMap((group) => group.items.map((item) => item.key));
    expect(new Set(allKeys).size).toBe(allKeys.length);
  });
  it('limits the customer center to account, security, service ledger, records, and works', () => {
    useUserStore.setState({
      isSignedIn: true,
      user: { avatar: '/avatar.png', fullName: '桂林旅行者', id: 'customer-1' } as any,
    });
    const { result } = renderHook(() => useCategory(), {
      wrapper: createWrapper(true),
    });

    const itemKeys = result.current.flatMap((group) => group.items.map((item) => item.key));

    expect(itemKeys).toEqual([
      SettingsTabs.Notification,
      SettingsTabs.Security,
      SettingsTabs.Plans,
      SettingsTabs.Usage,
      SettingsTabs.Credits,
      SettingsTabs.Works,
    ]);
    expect(result.current.flatMap((group) => group.items.map((item) => item.href))).toEqual(
      expect.arrayContaining(['/settings/usage', '/settings/credits?section=my-creations']),
    );
    expect(result.current.flatMap((group) => group.items.map((item) => item.href))).not.toContain(
      '/settings/credits?section=private-group',
    );
    expect(itemKeys).not.toContain(SettingsTabs.Profile);
    expect(itemKeys).not.toContain(SettingsTabs.Stats);
    expect(result.current[1].items.map((item) => item.label)).toEqual([
      '套餐',
      '用量',
      '积分',
      '本人生成记录',
    ]);
  });

  it('does not expose provider, referrals, or developer settings', () => {
    expect(getItemKeys()).not.toEqual(
      expect.arrayContaining([
        SettingsTabs.Provider,
        SettingsTabs.ServiceModel,
        SettingsTabs.Skill,
        SettingsTabs.Referral,
        SettingsTabs.APIKey,
        SettingsTabs.OAuthApps,
        SettingsTabs.Storage,
        SettingsTabs.Labs,
        SettingsTabs.ServiceOperations,
      ]),
    );
  });

  it('restores the complete platform settings navigation for a super_admin', () => {
    platformAccess.isPlatformAdmin = true;
    const { result } = renderHook(() => useCategory(), { wrapper: createWrapper(true) });
    const items = result.current.flatMap((group) => group.items);
    const itemKeys = items.map((item) => item.key);

    expect(result.current.map((group) => group.key)).toEqual([
      SettingsGroupKey.General,
      SettingsGroupKey.Subscription,
      SettingsGroupKey.Agent,
      SettingsGroupKey.Developer,
      SettingsGroupKey.Operations,
    ]);

    expect(itemKeys).not.toContain(SettingsTabs.About);
    expect(itemKeys).toEqual(
      expect.arrayContaining([
        SettingsTabs.Appearance,
        SettingsTabs.Devices,
        SettingsTabs.Provider,
        SettingsTabs.ServiceModel,
        SettingsTabs.Skill,
        SettingsTabs.Creds,
        SettingsTabs.Storage,
        SettingsTabs.Advanced,
        SettingsTabs.ServiceOperations,
      ]),
    );
    expect(items.find((item) => item.href === '/community')).toBeDefined();
    expect(items.find((item) => item.key === SettingsTabs.Memory)).toBeUndefined();
    expect(items.find((item) => item.key === SettingsTabs.ServiceOperations)).toMatchObject({
      href: '/settings/service-operations',
      label: '账户管理',
    });
  });

  it('does not flash platform navigation while the role is loading', () => {
    platformAccess.isLoading = true;
    platformAccess.isPlatformAdmin = true;

    expect(getItemKeys()).not.toContain(SettingsTabs.Provider);
    expect(getItemKeys()).not.toContain(SettingsTabs.ServiceOperations);
  });
});
