import { act, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { expect, it, vi } from 'vitest';

import en from '../../../../../../../../locales/en-US/chat.json';
import zh from '../../../../../../../../locales/zh-CN/chat.json';
import ModelCard from './ModelCard';

vi.unmock('react-i18next');
// Inspect the real card's translated tooltip content without portal/hover timing.
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Tooltip: ({ title, children }: any) => (
    <div>
      {children}
      <span>{title}</span>
    </div>
  ),
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: any) =>
    selector({ status: { isShowCredit: true }, updateSystemStatus: vi.fn() }),
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    customerCenter: {
      getDisplayExchangeRate: {
        useQuery: () => ({
          data: {
            rate: 7,
            month: '2026-09',
            rateDate: '2026-08-31',
            updatedAt: '2026-09-01',
          },
        }),
      },
    },
  },
}));

it('converts tooltip prices on language switch without changing the credit price', async () => {
  const i18n = createInstance();
  await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { chat: zh }, 'en-US': { chat: en } } });
  render(
    <I18nextProvider i18n={i18n}>
      <ModelCard
        abilities={{}}
        id="test"
        provider="test"
        providerId="test"
        type="chat"
        pricing={{
          currency: 'USD',
          units: [
            { name: 'textInput', strategy: 'fixed', unit: 'millionTokens', rate: 2 },
            { name: 'textOutput', strategy: 'fixed', unit: 'millionTokens', rate: 3 },
          ],
        }}
      />
    </I18nextProvider>,
  );
  expect(screen.getByText(/¥14.00\/百万 Token/)).toBeVisible();
  await act(() => i18n.changeLanguage('en-US'));
  expect(screen.getByText(/\$2.00\/M tokens/)).toBeVisible();
  expect(screen.getByText('2')).toBeVisible();
});
