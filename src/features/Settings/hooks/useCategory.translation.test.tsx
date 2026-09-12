import { act, cleanup, renderHook } from '@testing-library/react';
import i18n from 'i18next';
import { type ReactNode } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, expect, it, vi } from 'vitest';

import { SettingsTabs } from '@/store/global/initialState';
import { initServerConfigStore, Provider } from '@/store/serverConfig/store';

import en from '../../../../locales/en-US/common.json';
import zh from '../../../../locales/zh-CN/common.json';
import { useCategory } from './useCategory';

vi.unmock('react-i18next');
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    platformAccess: { isPlatformAdmin: { useQuery: () => ({ data: true, isLoading: false }) } },
  },
}));
afterEach(cleanup);

it('updates the administrator menu on English and Chinese switches without remounting', async () => {
  await i18n.use(initReactI18next).init({
    lng: 'zh-CN',
    defaultNS: 'common',
    fallbackLng: 'en-US',
    resources: { 'en-US': { common: en }, 'zh-CN': { common: zh } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={i18n}>
      <Provider
        createStore={() =>
          initServerConfigStore({
            serverConfig: { aiProvider: {}, enableBusinessFeatures: true, telemetry: {} },
          })
        }
      >
        {children}
      </Provider>
    </I18nextProvider>
  );
  const { result } = renderHook(useCategory, { wrapper });
  const adminGroup = () =>
    result.current.find((group) =>
      group.items.some((item) => item.key === SettingsTabs.ServiceOperations),
    );
  expect(adminGroup()?.title).toBe('用户管理');
  await act(() => i18n.changeLanguage('en-US'));
  expect(adminGroup()?.title).toBe('User management');
  expect(
    adminGroup()?.items.find((item) => item.key === SettingsTabs.ServiceOperations)?.label,
  ).toBe('Account management');
  await act(() => i18n.changeLanguage('zh-CN'));
  expect(adminGroup()?.title).toBe('用户管理');
});
