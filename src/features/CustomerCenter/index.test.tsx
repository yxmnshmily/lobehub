import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CustomerCenter, { type CustomerCenterCopy, type CustomerCenterData } from '.';
import { formatCustomerDateTime } from './model';

vi.mock('@/features/Settings/profile/features/AvatarRow', () => ({ default: () => null }));
vi.mock('@/features/Settings/profile/features/FullNameRow', () => ({ default: () => null }));
vi.mock('@/features/Settings/profile/features/PasswordRow', () => ({ default: () => null }));
vi.mock('./LoginSessions', () => ({
  default: ({ locale }: { locale: string }) => <div>{`登录设备会话组件 ${locale}`}</div>,
}));
vi.mock('./GroupInvitations', () => ({
  default: ({ locale }: { locale: string }) => <div>{`群组邀请与协作组件 ${locale}`}</div>,
}));
vi.mock('./CreditsOrders', () => ({
  default: ({ locale }: { locale: string }) => <div>{`Credits 充值订单组件 ${locale}`}</div>,
}));

const copy: CustomerCenterCopy = {
  accountSecurityTitle: '账号与安全',
  balancesTitle: '余额',
  balanceUnavailable: '余额不可用',
  creationStatus: {
    failed: '失败',
    processing: '制作中',
    succeeded: '已完成',
    unavailable: '当前不可用',
    unknown: '未知',
  },
  creationsUnavailable: '生成记录暂时无法读取',
  creditBalanceLabel: '可用 Credits',
  creditsChangeLabel: 'Credits 变动',
  defaultRechargeSource: '余额变动',
  generationTasksEmpty: '暂无生成任务',
  generationTasksTitle: '生成任务',
  inputTokensLabel: '输入',
  outputTokensLabel: '输出',
  rechargeEmpty: '暂无记录',
  rechargeTitle: '充值记录',
  sections: {
    'account-security': '账号与安全',
    'balance-usage': '余额与用量',
    'my-creations': '我的生成',
    'recharge-history': '充值记录',
  },
  title: '个人中心',
  totalTokensLabel: '合计',
  usageEmpty: '暂无用量',
  worksEmpty: '暂无作品',
  worksTitle: '作品',
};

const data = (
  creations: CustomerCenterData['creations'],
  orders: CustomerCenterData['orders'] = { isUnavailable: true },
): CustomerCenterData => ({
  balances: { isUnavailable: true },
  creations,
  orders,
  recharges: { isUnavailable: true },
  usage: { isUnavailable: true },
});

const renderCreations = (creations: CustomerCenterData['creations'], width: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  return render(
    <MemoryRouter initialEntries={['/settings/credits?section=my-creations']}>
      <CustomerCenter
        copy={copy}
        data={data(creations)}
        generationFilters={{}}
        locale="zh-CN"
        onGenerationFiltersChange={vi.fn()}
      />
    </MemoryRouter>,
  );
};

const renderSection = (section: string, width: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  return render(
    <MemoryRouter initialEntries={[`/settings/credits?section=${section}`]}>
      <CustomerCenter
        copy={copy}
        data={data({ data: { generationTasks: [], works: [] } })}
        generationFilters={{}}
        locale="zh-CN"
        onGenerationFiltersChange={vi.fn()}
      />
    </MemoryRouter>,
  );
};

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
});

describe.each([
  ['mobile light', 390, 'light'],
  ['mobile dark', 390, 'dark'],
  ['desktop light', 1280, 'light'],
  ['desktop dark', 1280, 'dark'],
])('CustomerCenter accessible structure on %s', (_, width, theme) => {
  it('keeps the personal-generation filters semantically named', () => {
    document.documentElement.dataset.theme = theme;
    renderCreations({ data: { generationTasks: [], works: [] } }, width);

    expect(screen.getByRole('heading', { name: '个人中心' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: '生成类型' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: '生成状态' })).toBeTruthy();
    expect(screen.getByLabelText('开始日期')).toBeTruthy();
    expect(screen.getByLabelText('结束日期')).toBeTruthy();
  });
});

describe('CustomerCenter generation states', () => {
  it.each([
    ['mobile', 390],
    ['desktop', 1280],
  ])('keeps filters visible while %s generation data is loading or locally failed', (_, width) => {
    const view = renderCreations({ isLoading: true }, width);
    expect(screen.getByText('全部类型')).toBeTruthy();
    expect(view.container.querySelector('.ant-skeleton')).not.toBeNull();

    view.rerender(
      <MemoryRouter initialEntries={['/settings/credits?section=my-creations']}>
        <CustomerCenter
          copy={copy}
          data={data({ error: '生成记录暂时无法读取' })}
          generationFilters={{}}
          locale="zh-CN"
          onGenerationFiltersChange={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('全部类型')).toBeTruthy();
    expect(screen.getByText('生成记录暂时无法读取')).toBeTruthy();
  });

  it.each([
    ['mobile', 390],
    ['desktop', 1280],
  ])('renders at most one bounded 20-row page on %s', (_, width) => {
    renderCreations(
      {
        data: {
          generationTasks: Array.from({ length: 80 }, (_, index) => ({
            id: `task-${index}`,
            status: 'succeeded',
            title: `生成任务 ${index + 1}`,
            type: 'copy',
            updatedAt: new Date('2026-09-03T00:00:00.000Z'),
          })),
          works: [],
        },
      },
      width,
    );

    expect(screen.getByText('生成任务 20')).toBeTruthy();
    expect(screen.queryByText('生成任务 21')).toBeNull();
  });
});

describe.each([
  ['mobile', 390],
  ['desktop', 1280],
])('CustomerCenter service orders on %s', (_, width) => {
  it('renders only the customer-safe order fields in recharge history', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    render(
      <MemoryRouter initialEntries={['/settings/billing?section=recharge-history']}>
        <CustomerCenter
          copy={copy}
          locale="zh-CN"
          data={data(
            { data: { generationTasks: [], works: [] } },
            {
              data: [
                {
                  amountFen: 128_800,
                  id: 'order-1',
                  occurredAt: new Date('2026-09-03T08:00:00.000Z'),
                  status: 'completed',
                  title: '九寨沟私家团',
                },
              ],
            },
          )}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('九寨沟私家团')).toBeTruthy();
    expect(screen.getByText('¥1,288.00')).toBeTruthy();
  });
});

describe.each([
  ['mobile', 390],
  ['desktop', 1280],
])('CustomerCenter settlement gate on %s', (_, width) => {
  it('does not render an artifact link before Credits settlement completes', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    render(
      <MemoryRouter initialEntries={['/settings/credits?section=my-creations']}>
        <CustomerCenter
          copy={copy}
          data={data({ data: { generationTasks: [], works: [] } })}
          locale="zh-CN"
          generationDetail={{
            data: {
              artifacts: [{ id: 'must-stay-hidden', type: 'image', url: '/f/unsettled-image.png' }],
              createdAt: new Date('2026-09-03T08:00:00.000Z'),
              id: 'unsettled-generation',
              isVideoUnavailable: false,
              settlementStatus: 'pending',
              status: 'succeeded',
              type: 'image',
              updatedAt: new Date('2026-09-03T09:00:00.000Z'),
            },
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('结算完成后可查看成果')).toBeTruthy();
    expect(
      screen.getByText(formatCustomerDateTime(new Date('2026-09-03T08:00:00.000Z'), 'zh-CN')),
    ).toBeTruthy();
    expect(
      screen.queryByText(formatCustomerDateTime(new Date('2026-09-03T09:00:00.000Z'), 'zh-CN')),
    ).toBeNull();
    expect(screen.queryByRole('link', { name: 'must-stay-hidden' })).toBeNull();
  });
});

describe.each([
  ['mobile', 390],
  ['desktop', 1280],
])('CustomerCenter retry entry on %s', (_, width) => {
  it('offers a keyboard-accessible retry for a local generation failure', () => {
    const onRetryCreations = vi.fn();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    render(
      <MemoryRouter initialEntries={['/settings/credits?section=my-creations']}>
        <CustomerCenter
          copy={copy}
          data={data({ error: '生成记录暂时无法读取' })}
          locale="zh-CN"
          onRetryCreations={onRetryCreations}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetryCreations).toHaveBeenCalledOnce();
  });
});

describe.each([
  ['mobile', 390],
  ['desktop', 1280],
])('CustomerCenter refresh entry on %s', (_, width) => {
  it('offers a keyboard-accessible refresh without changing the current section', () => {
    const onRefresh = vi.fn();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    render(
      <MemoryRouter initialEntries={['/settings/credits?section=my-creations']}>
        <CustomerCenter
          copy={copy}
          data={data({ data: { generationTasks: [], works: [] } })}
          locale="zh-CN"
          onRefresh={onRefresh}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(screen.getByText('暂无生成任务')).toBeTruthy();
  });
});

describe.each([
  ['mobile', 390],
  ['desktop', 1280],
])('CustomerCenter refreshed sections on %s', (_, width) => {
  it('mounts the current-user login session manager in account security', () => {
    renderSection('account-security', width);

    expect(screen.getByText('登录设备会话组件 zh-CN')).toBeTruthy();
    expect(screen.getByText('群组邀请与协作组件 zh-CN')).toBeTruthy();
  });

  it('mounts the current-user Credits order manager only in recharge history', () => {
    const view = renderSection('recharge-history', width);

    expect(screen.getByText('Credits 充值订单组件 zh-CN')).toBeTruthy();

    view.unmount();
    renderSection('balance-usage', width);
    expect(screen.queryByText('Credits 充值订单组件 zh-CN')).toBeNull();
  });

  it('explains how password changes protect the customer\'s other login sessions', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    render(
      <MemoryRouter initialEntries={['/settings/security?section=account-security']}>
        <CustomerCenter
          data={data({ data: { generationTasks: [], works: [] } })}
          locale="zh-CN"
          copy={{
            ...copy,
            sessionSecurityNotice: '修改或重置密码后，其他设备上的登录会话会自动退出。',
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('修改或重置密码后，其他设备上的登录会话会自动退出。')).toBeTruthy();
  });

  it.each([
    ['account-security', ['账号与安全']],
    ['balance-usage', ['余额不可用', '暂无用量']],
    ['recharge-history', ['暂无记录']],
    ['my-creations', ['暂无生成任务', '暂无作品']],
  ])('restores %s without falling back to another section', (section, expectedTexts) => {
    renderSection(section, width);

    for (const expectedText of expectedTexts) {
      expect(screen.getAllByText(expectedText).length).toBeGreaterThan(0);
    }
  });

  it('rejects the removed private-group deep link', () => {
    renderSection('private-group', width);

    expect(screen.getAllByText('账号与安全').length).toBeGreaterThan(0);
    expect(screen.queryByText('我的群组')).toBeNull();
  });

  it.each([
    'account-security',
    'balance-usage',
    'recharge-history',
    'my-creations',
  ])('keeps %s free of platform-administration controls', (section) => {
    renderSection(section, width);

    expect(document.body.textContent).not.toMatch(
      /服务运营|客户账户|用户管理|封禁|IP 地址|全局账单|模型设置|服务模型|AI 服务商|Provider|Skill|API Key|密钥管理|平台定价|管理员生成目录/iu,
    );
  });
});
