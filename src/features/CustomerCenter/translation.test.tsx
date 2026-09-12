import { act, cleanup, render, screen } from '@testing-library/react';
import i18n from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { translateTravel } from '@/utils/i18n/travel';

import en from '../../../locales/en-US/common.json';
import zh from '../../../locales/zh-CN/common.json';
import SubscriptionWorkspace from './SubscriptionWorkspace';

vi.unmock('react-i18next');
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    customerCenter: {
      getOverview: { useQuery: () => ({ data: {} }) },
      getUsageDetails: { useQuery: () => ({ data: [] }) },
      getDisplayExchangeRate: { useQuery: () => ({ data: { rate: 7 } }) },
    },
  },
}));
vi.mock('./CreditLedger', () => ({ default: () => null }));
vi.mock('./CreditsOrders', () => ({ default: () => null }));

afterEach(cleanup);
beforeEach(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'zh-CN',
    fallbackLng: 'en-US',
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    resources: { 'en-US': { common: en }, 'zh-CN': { common: zh } },
  });
});

it('updates mounted plan headings, descriptions and tables in both directions', async () => {
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <SubscriptionWorkspace section="plans" />
      </MemoryRouter>
    </I18nextProvider>,
  );
  expect(screen.getByRole('heading', { name: '基础版' })).toBeTruthy();
  await act(() => i18n.changeLanguage('en-US'));
  expect(screen.getByRole('heading', { name: en['travelUi.基础版'] })).toBeTruthy();
  expect(screen.getByText('Plan benefits')).toBeTruthy();
  expect(screen.queryByText('套餐权益')).toBeNull();
  expect(screen.getAllByText('AI chat and content creation').length).toBe(3);
  await act(() => i18n.changeLanguage('zh-CN'));
  expect(screen.getByRole('heading', { name: '基础版' })).toBeTruthy();
  expect(screen.getByText('套餐权益')).toBeTruthy();
});

it('resolves every custom English label, including punctuation and interpolation', async () => {
  await i18n.changeLanguage('en-US');
  const keys = Object.keys(zh).filter((key) => key.startsWith('travelUi.'));
  expect(keys.length).toBeGreaterThan(600);
  for (const key of keys) {
    const source = key.slice('travelUi.'.length);
    const english = en[key as keyof typeof en];
    expect(english, key).toBeTruthy();
    expect(english, key).not.toMatch(/[\u4e00-\u9fff]/);
    expect(translateTravel(source), key).toBe(english);
  }
  expect(translateTravel('用户后台管理')).toBe('User management');
  expect(translateTravel('账户管理')).toBe('Account management');
  expect(translateTravel('已同步到 {{v0}} 个默认群', { v0: 12 })).toBe(
    'Synced to 12 default groups',
  );
  expect(translateTravel('https://... （留空可清除）')).toBe('https://... (leave blank to clear)');
});
