import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { USD_TO_CNY } from '@lobechat/const/currency';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { displayMoney } from '@/utils/currencyDisplay';

import GenerationModelItem from './GenerationModelItem';

const state = vi.hoisted(() => ({ business: false }));
vi.mock('@lobehub/icons', () => ({ ModelIcon: () => null }));
vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: any) => <div>{children}</div>,
  Popover: ({ children, content }: any) => (
    <div>
      {children}
      {content}
    </div>
  ),
}));
vi.mock('@lobehub/ui/base-ui', () => ({ Text: ({ children }: any) => <span>{children}</span> }));
vi.mock('@/components/ModelSelect/NewModelBadge', () => ({ default: () => null }));
vi.mock('@/hooks/useIsDark', () => ({ useIsDark: () => false }));
vi.mock('@/store/serverConfig', () => ({ useServerConfigStore: () => state.business }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_: string, values: { amount: string }) => `${values.amount} 积分` }),
}));
vi.mock('@/features/CustomerCenter/useMonthlyExchangeRate', () => ({
  useMonthlyExchangeRate: () => ({
    format: (amount: number, digits: number) => displayMoney(amount, 'USD', 'zh-CN', 6.711, digits),
    money: (amount: number, source: string, digits: number) =>
      displayMoney(amount, source, 'zh-CN', 6.711, digits),
  }),
}));

describe('generation model price display', () => {
  it('preserves the original CNY per-image quote instead of round-tripping exchange rates', () => {
    state.business = false;
    render(
      <GenerationModelItem
        showPrice
        abilities={{}}
        id="cny-image"
        pricePerImage={0.06 / USD_TO_CNY}
        pricing={{
          currency: 'CNY',
          units: [{ name: 'imageGeneration', strategy: 'fixed', unit: 'image', rate: 0.06 }],
        }}
      />,
    );
    expect(screen.getByText('¥0.06 / image')).toBeTruthy();
  });
  it('uses settlement rounding for exact branded credits rather than rounding down', () => {
    state.business = true;
    render(
      <GenerationModelItem
        showPrice
        abilities={{}}
        id="credits-image"
        pricePerImage={0.0001234}
        providerId={BRANDING_PROVIDER}
      />,
    );
    expect(screen.getByText('124 积分')).toBeTruthy();
  });
});
