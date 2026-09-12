/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SponsoredPolicyPanel from './index';

const mocks = vi.hoisted(() => ({
  disablePolicy: vi.fn(),
  enablePolicy: vi.fn(),
  getOwnerPolicy: {
    data: {
      defaultMemberTemplate: {
        billingResponsibility: null as 'group_owner' | null,
        enabled: false,
        maxCreditsPerPeriod: null as number | null,
        maxCreditsPerRequest: null as number | null,
      },
      enabled: false,
      groupPeriodLimitCredits: null as number | null,
      periodDurationSeconds: null as number | null,
      periodEndsAt: null as Date | null,
      periodStartedAt: null as Date | null,
      policyVersion: 0,
    },
    isError: false,
    isLoading: false,
  },
  onMembersChanged: vi.fn(),
  refetchPolicy: vi.fn(),
  revokeMemberPaidAi: vi.fn(),
  setMemberLimits: vi.fn(),
  updatePolicyLimit: vi.fn(),
  updateDefaultMemberTemplate: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Skeleton: () => <div data-testid="policy-loading" />,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, htmlType, loading, ...props }: Record<string, unknown>) => {
    const { danger: _danger, type: _type, ...buttonProps } = props;
    return (
      <button
        disabled={Boolean(loading) || Boolean(buttonProps.disabled)}
        type={(htmlType as 'button' | 'reset' | 'submit') || 'button'}
        {...buttonProps}
      >
        {children as ReactNode}
      </button>
    );
  },
  Input: (props: Record<string, unknown>) => <input {...props} />,
  Switch: ({ checked, onChange, ...props }: Record<string, unknown>) => (
    <input
      checked={Boolean(checked)}
      role="switch"
      type="checkbox"
      {...props}
      onChange={(event) => (onChange as (value: boolean) => void)(event.target.checked)}
    />
  ),
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  confirmModal: vi.fn(({ onOk }: { onOk: () => Promise<void> }) => onOk()),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    groupSponsoredCredit: {
      disablePolicy: {
        useMutation: () => ({ mutateAsync: mocks.disablePolicy }),
      },
      enablePolicy: {
        useMutation: () => ({ mutateAsync: mocks.enablePolicy }),
      },
      getOwnerPolicy: {
        useQuery: () => ({ ...mocks.getOwnerPolicy, refetch: mocks.refetchPolicy }),
      },
      revokeMemberPaidAi: {
        useMutation: () => ({ mutateAsync: mocks.revokeMemberPaidAi }),
      },
      setMemberLimits: {
        useMutation: () => ({ mutateAsync: mocks.setMemberLimits }),
      },
      updatePolicyLimit: {
        useMutation: () => ({ mutateAsync: mocks.updatePolicyLimit }),
      },
      updateDefaultMemberTemplate: {
        useMutation: () => ({ mutateAsync: mocks.updateDefaultMemberTemplate }),
      },
    },
  },
}));

const members = [
  {
    canUsePaidAi: true,
    displayName: '锦绣',
    maxCreditsPerPeriod: 10_000,
    maxCreditsPerRequest: 1000,
    memberUserId: 'member-1',
    membershipVersion: 4,
  },
];

describe('SponsoredPolicyPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOwnerPolicy.data = {
      defaultMemberTemplate: {
        billingResponsibility: null,
        enabled: false,
        maxCreditsPerPeriod: null,
        maxCreditsPerRequest: null,
      },
      enabled: false,
      groupPeriodLimitCredits: null,
      periodDurationSeconds: null,
      periodEndsAt: null,
      periodStartedAt: null,
      policyVersion: 0,
    };
    mocks.getOwnerPolicy.isError = false;
    mocks.getOwnerPolicy.isLoading = false;
  });

  it('requires explicit policy limits on first enable and uses policy CAS', async () => {
    mocks.enablePolicy.mockResolvedValue({ enabled: true, policyVersion: 1 });
    render(
      <SponsoredPolicyPanel
        groupId="group-1"
        members={members}
        onMembersChanged={mocks.onMembersChanged}
      />,
    );

    expect(screen.getByText('群代付设置')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '启用群代付' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('群周期积分上限'), {
      target: { value: '1000000' },
    });
    fireEvent.change(screen.getByLabelText('周期天数'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: '启用群代付' }));

    await waitFor(() =>
      expect(mocks.enablePolicy).toHaveBeenCalledWith({
        expectedPolicyVersion: 0,
        groupId: 'group-1',
        groupPeriodLimitCredits: 1_000_000,
        periodDurationSeconds: 2_592_000,
      }),
    );
    expect(mocks.refetchPolicy).toHaveBeenCalledTimes(1);
  });

  it('updates and disables an enabled policy with the latest policy version', async () => {
    mocks.getOwnerPolicy.data = {
      defaultMemberTemplate: {
        billingResponsibility: null,
        enabled: false,
        maxCreditsPerPeriod: null,
        maxCreditsPerRequest: null,
      },
      enabled: true,
      groupPeriodLimitCredits: 1_000_000,
      periodDurationSeconds: 2_592_000,
      periodEndsAt: new Date('2026-10-04T00:00:00.000Z'),
      periodStartedAt: new Date('2026-09-04T00:00:00.000Z'),
      policyVersion: 7,
    };
    mocks.updatePolicyLimit.mockResolvedValue({
      enabled: true,
      groupPeriodLimitCredits: 2_000_000,
      periodDurationSeconds: 2_592_000,
      periodEndsAt: new Date('2026-10-04T00:00:00.000Z'),
      periodStartedAt: new Date('2026-09-04T00:00:00.000Z'),
      policyVersion: 8,
    });
    mocks.disablePolicy.mockResolvedValue({
      enabled: false,
      groupPeriodLimitCredits: 2_000_000,
      periodDurationSeconds: 2_592_000,
      periodEndsAt: new Date('2026-10-04T00:00:00.000Z'),
      periodStartedAt: new Date('2026-09-04T00:00:00.000Z'),
      policyVersion: 9,
    });
    render(
      <SponsoredPolicyPanel
        groupId="group-1"
        members={members}
        onMembersChanged={mocks.onMembersChanged}
      />,
    );

    expect(screen.getByText(/积分由群主承担/)).toBeInTheDocument();
    expect(screen.queryByText(/payer|余额|账单/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('群周期积分上限'), {
      target: { value: '2000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: '更新群上限' }));
    await waitFor(() =>
      expect(mocks.updatePolicyLimit).toHaveBeenCalledWith({
        expectedPolicyVersion: 7,
        groupId: 'group-1',
        groupPeriodLimitCredits: 2_000_000,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: '停用群代付' }));
    await waitFor(() =>
      expect(mocks.disablePolicy).toHaveBeenCalledWith({
        expectedPolicyVersion: 8,
        groupId: 'group-1',
      }),
    );
  });

  it('saves an explicit new-member owner-sponsored template with policy CAS', async () => {
    mocks.getOwnerPolicy.data = {
      defaultMemberTemplate: {
        billingResponsibility: null,
        enabled: false,
        maxCreditsPerPeriod: null,
        maxCreditsPerRequest: null,
      },
      enabled: true,
      groupPeriodLimitCredits: 1_000_000,
      periodDurationSeconds: 2_592_000,
      periodEndsAt: new Date('2026-10-04T00:00:00.000Z'),
      periodStartedAt: new Date('2026-09-04T00:00:00.000Z'),
      policyVersion: 7,
    };
    mocks.updateDefaultMemberTemplate.mockResolvedValue({
      ...mocks.getOwnerPolicy.data,
      defaultMemberTemplate: {
        billingResponsibility: 'group_owner',
        enabled: true,
        maxCreditsPerPeriod: 3000,
        maxCreditsPerRequest: 500,
      },
      policyVersion: 8,
    });
    render(
      <SponsoredPolicyPanel
        groupId="group-1"
        members={members}
        onMembersChanged={mocks.onMembersChanged}
      />,
    );

    expect(screen.getByText('新成员自动由群主代付')).toBeInTheDocument();
    expect(screen.getByText(/仅作用于此后新建的邀请，不会修改已有成员/)).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: '新成员自动由群主代付' });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(mocks.updateDefaultMemberTemplate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('新成员单次积分上限'), {
      target: { value: '500' },
    });
    fireEvent.change(screen.getByLabelText('新成员周期积分上限'), {
      target: { value: '3000' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存新成员代付设置' }));

    await waitFor(() =>
      expect(mocks.updateDefaultMemberTemplate).toHaveBeenCalledWith({
        enabled: true,
        expectedPolicyVersion: 7,
        groupId: 'group-1',
        maxCreditsPerPeriod: 3000,
        maxCreditsPerRequest: 500,
      }),
    );
    expect(mocks.refetchPolicy).toHaveBeenCalledOnce();
  });

  it('keeps the new-member template disabled while the group policy is disabled', () => {
    render(
      <SponsoredPolicyPanel
        groupId="group-1"
        members={members}
        onMembersChanged={mocks.onMembersChanged}
      />,
    );

    expect(screen.getByRole('switch', { name: '新成员自动由群主代付' })).toBeDisabled();
    expect(screen.getByLabelText('新成员单次积分上限')).toBeDisabled();
    expect(screen.getByLabelText('新成员周期积分上限')).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存新成员代付设置' })).toBeDisabled();
  });

  it('sets and revokes explicit member limits with membership CAS', async () => {
    mocks.getOwnerPolicy.data = {
      defaultMemberTemplate: {
        billingResponsibility: null,
        enabled: false,
        maxCreditsPerPeriod: null,
        maxCreditsPerRequest: null,
      },
      enabled: true,
      groupPeriodLimitCredits: 1_000_000,
      periodDurationSeconds: 2_592_000,
      periodEndsAt: new Date('2026-10-04T00:00:00.000Z'),
      periodStartedAt: new Date('2026-09-04T00:00:00.000Z'),
      policyVersion: 2,
    };
    mocks.setMemberLimits.mockResolvedValue({
      canUsePaidAi: true,
      maxCreditsPerPeriod: 10_000,
      maxCreditsPerRequest: 1000,
      membershipVersion: 5,
    });
    mocks.revokeMemberPaidAi.mockResolvedValue({
      canUsePaidAi: false,
      maxCreditsPerPeriod: null,
      maxCreditsPerRequest: null,
      membershipVersion: 6,
    });
    render(
      <SponsoredPolicyPanel
        groupId="group-1"
        members={members}
        onMembersChanged={mocks.onMembersChanged}
      />,
    );

    expect(screen.getByText('已配置额度：单次 1000 / 周期 10000 积分')).toBeInTheDocument();
    expect(screen.getByLabelText('锦绣单次积分上限')).toHaveValue(1000);
    expect(screen.getByLabelText('锦绣周期积分上限')).toHaveValue(10_000);

    fireEvent.change(screen.getByLabelText('锦绣单次积分上限'), {
      target: { value: '1000' },
    });
    fireEvent.change(screen.getByLabelText('锦绣周期积分上限'), {
      target: { value: '10000' },
    });
    fireEvent.click(screen.getByRole('button', { name: '授予 锦绣 代付额度' }));

    await waitFor(() =>
      expect(mocks.setMemberLimits).toHaveBeenCalledWith({
        expectedMembershipVersion: 4,
        groupId: 'group-1',
        maxCreditsPerPeriod: 10_000,
        maxCreditsPerRequest: 1000,
        memberUserId: 'member-1',
      }),
    );
    expect(mocks.onMembersChanged).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '撤销 锦绣 代付额度' }));
    await waitFor(() =>
      expect(mocks.revokeMemberPaidAi).toHaveBeenCalledWith({
        expectedMembershipVersion: 5,
        groupId: 'group-1',
        memberUserId: 'member-1',
      }),
    );
    expect(screen.getByText('未授权代付')).toBeInTheDocument();
  });

  it('renders nothing when the owner policy API is unavailable', () => {
    mocks.getOwnerPolicy.data = undefined as never;
    mocks.getOwnerPolicy.isError = true;

    const { container } = render(
      <SponsoredPolicyPanel
        groupId="group-1"
        members={members}
        onMembersChanged={mocks.onMembersChanged}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/群主|余额|payer/i)).not.toBeInTheDocument();
  });
});
