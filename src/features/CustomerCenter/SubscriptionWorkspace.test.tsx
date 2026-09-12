import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SubscriptionWorkspace from './SubscriptionWorkspace';

vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: (selector: any) =>
    selector({ useFetchAiProviderRuntimeState: () => ({ data: { enabledChatModelList: [] } }) }),
}));

const overviewQuery = vi.hoisted(() => ({
  data: {
    credits: {
      account: { availableCredits: 12345, balanceCredits: 12345 } as {
        availableCredits?: number;
        balanceCredits: number;
      } | null,
    },
    usage: null,
  },
  refetch: vi.fn(),
}));
beforeEach(() => {
  overviewQuery.data.credits.account = { availableCredits: 12345, balanceCredits: 12345 };
});

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslation: () => ({
    i18n: { language: 'zh-CN' },
    t: (_key: string, opts: any) => opts?.defaultValue ?? _key,
  }),
}));
vi.mock('@/utils/i18n/travel', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getTravelLocale: () => 'zh-CN',
  translateTravel: (source: string) => source,
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    customerCenter: {
      getOverview: {
        useQuery: () => overviewQuery,
      },
      getDisplayExchangeRate: { useQuery: () => ({ data: undefined }) },
      getUsageDetails: { useQuery: () => ({ data: [] }) },
    },
  },
}));
vi.mock('./CreditsOrders', () => ({ default: () => <div>充值订单</div> }));
vi.mock('./CreditLedger', () => ({ default: () => <div>积分明细列表</div> }));

describe('SubscriptionWorkspace', () => {
  it.each(['usage', 'credits'] as const)(
    'shows a retry when an older API omits spendable credits in %s',
    (section) => {
      overviewQuery.data.credits.account = { balanceCredits: 194_587 };
      render(
        <MemoryRouter>
          <SubscriptionWorkspace section={section} />
        </MemoryRouter>,
      );
      expect(
        screen.getByRole('button', { name: section === 'usage' ? '重新读取余额' : '重试' }),
      ).toBeTruthy();
      expect(screen.queryByText('194,587')).toBeNull();
    },
  );
  it.each(['credits', 'usage'] as const)(
    'uses spendable rather than reserved credits in %s',
    (section) => {
      overviewQuery.data.credits.account = { availableCredits: 100_000, balanceCredits: 1_000_000 };
      render(
        <MemoryRouter>
          <SubscriptionWorkspace section={section} />
        </MemoryRouter>,
      );
      expect(screen.getAllByText(/100,000/).length).toBeGreaterThan(0);
      expect(screen.queryByText('1,000,000')).toBeNull();
    },
  );

  it.each(['plans', 'usage', 'credits', 'billing'] as const)(
    'leaves the %s page title to the surrounding settings navigation',
    (section) => {
      render(
        <MemoryRouter>
          <SubscriptionWorkspace section={section} />
        </MemoryRouter>,
      );
      expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    },
  );
  it.each(['credits', 'billing'] as const)(
    'includes one ledger below recharge orders for %s',
    (section) => {
      render(
        <MemoryRouter>
          <SubscriptionWorkspace section={section} />
        </MemoryRouter>,
      );
      const ledger = screen.getByText('积分明细列表');
      const orders = screen.getByText('充值订单');
      expect(ledger.closest('#credit-ledger')).toBeTruthy();
      expect(
        orders.compareDocumentPosition(ledger) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(screen.getAllByText(/12,345/).length).toBeGreaterThan(0);
    },
  );
  it('shows a retry for a partial account failure instead of claiming a zero balance', () => {
    overviewQuery.data.credits.account = null;
    render(
      <MemoryRouter>
        <SubscriptionWorkspace section="credits" />
      </MemoryRouter>,
    );
    expect(screen.getByText('账户数据暂时无法读取')).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(overviewQuery.refetch).toHaveBeenCalled();
  });
  it('shows the three approved CNY monthly prices without promising an active subscription', () => {
    render(
      <MemoryRouter>
        <SubscriptionWorkspace section="plans" />
      </MemoryRouter>,
    );
    for (const price of ['¥99.00', '¥599.00', '¥999.00'])
      expect(screen.getByText(price)).toBeTruthy();
    for (const credits of ['1000万 / 每月', '6000万 / 每月', '1亿 / 每月'])
      expect(screen.getByText(credits)).toBeTruthy();
    expect(screen.getByRole('row', { name: '每月积分 1000万 6000万 1亿' })).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: '升级' })[0]);
    expect(screen.getByText('套餐支付暂未开通')).toBeTruthy();
    expect(screen.queryByText('开通成功')).toBeNull();
  });
  it.each([
    [0, '基础版', '¥99.00', '1000万'],
    [1, '进阶版', '¥599.00', '6000万'],
    [2, '专业版', '¥999.00', '1亿'],
  ] as const)(
    'confirms plan %s with the matching CNY amount and safe payment channels',
    (index, name, price, credits) => {
      render(
        <MemoryRouter>
          <SubscriptionWorkspace section="plans" />
        </MemoryRouter>,
      );
      fireEvent.click(screen.getAllByRole('button', { name: '升级' })[index]);
      const dialog = within(screen.getByRole('dialog', { name: '确认套餐' }));
      expect(dialog.getByText(name)).toBeTruthy();
      expect(dialog.getByText(price)).toBeTruthy();
      expect(dialog.getByText(credits)).toBeTruthy();
      for (const channel of [/支付宝/, /微信支付/, /网银/]) {
        expect(dialog.getByRole('radio', { name: channel })).toBeDisabled();
      }
      expect(dialog.getByRole('button', { name: '确认支付' })).toBeDisabled();
      expect(dialog.queryByText('开通成功')).toBeNull();
      fireEvent.click(dialog.getByRole('button', { name: '返回选择' }));
      expect(screen.queryByRole('dialog', { name: '确认套餐' })).toBeNull();
    },
  );
  it('shows the real credit balance, not a reference-account quota', () => {
    render(
      <MemoryRouter>
        <SubscriptionWorkspace section="credits" />
      </MemoryRouter>,
    );
    expect(screen.getAllByText(/12,345/).length).toBeGreaterThan(0);
    expect(screen.queryByText('450,339')).toBeNull();
    expect(screen.getByRole('link', { name: '查看使用情况' })).toHaveAttribute(
      'href',
      '/settings/usage',
    );
  });
  it('does not turn unavailable usage into zero or a fake quota percentage', () => {
    render(
      <MemoryRouter>
        <SubscriptionWorkspace section="usage" />
      </MemoryRouter>,
    );
    expect(screen.getByText('暂无用量记录')).toBeTruthy();
    expect(screen.getByText('12,345')).toBeTruthy();
    expect(screen.queryByText('0%')).toBeNull();
  });
});
