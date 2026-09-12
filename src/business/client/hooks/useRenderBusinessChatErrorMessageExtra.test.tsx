import type { ChatMessageError } from '@lobechat/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import useRenderBusinessChatErrorMessageExtra from './useRenderBusinessChatErrorMessageExtra';

const openDialog = vi.hoisted(() => vi.fn());
vi.mock('@/features/ChatInput/SendArea/openCreditDialog', () => ({ openCreditDialog: openDialog }));
vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock('@/utils/i18n/travel', () => ({
  getTravelLocale: () => 'zh-CN',
  useTravelTranslation: () => (text: string, values?: Record<string, string>) =>
    text.replaceAll(/\{\{(\w+)\}\}/g, (_, key) => values?.[key] ?? ''),
}));
const View = ({ error, retry }: { error: ChatMessageError; retry?: () => void }) =>
  useRenderBusinessChatErrorMessageExtra(error, 'm1', { onRetry: retry });

describe('site credit error card', () => {
  beforeEach(() => openDialog.mockClear());
  it('shows the actual shortfall and opens our recharge dialog without retrying', async () => {
    const retry = vi.fn();
    render(
      <View
        error={{ type: 'InsufficientBudgetForModel', body: { budget: { shortfallCredits: 1645 } } }}
        retry={retry}
      />,
    );
    expect(screen.getByText(/1,645/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '充值积分' }));
    expect(openDialog).toHaveBeenCalledWith('credits');
    expect(retry).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '已充值，重试本次请求' }));
    });
    expect(retry).toHaveBeenCalledOnce();
  });
  it('uses site pricing and honestly exposes the existing plan status', () => {
    render(<View error={{ type: 'FreePlanLimit' }} />);
    expect(screen.getByText(/¥10/)).toBeVisible();
    expect(screen.getByText(/套餐支付暂未开通/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /查看套餐/ }));
    expect(openDialog).toHaveBeenCalledWith('plans');
    expect(screen.queryByText(/邀请好友/)).not.toBeInTheDocument();
  });
  it('recognizes local platform balance errors without inventing a missing amount', () => {
    render(
      <View
        error={{
          type: 500,
          body: { message: '[BALANCE_EMPTY] Credits 余额不足' },
        }}
      />,
    );
    expect(screen.getByText('积分不够啦')).toBeVisible();
    expect(screen.queryByText(/本次请求还差/)).not.toBeInTheDocument();
  });
  it('does not sell the viewer credits for a group-owner balance error', () => {
    render(<View error={{ type: 500, message: '[GROUP_OWNER_CREDITS_EMPTY] 群主余额不足' }} />);
    expect(screen.getByText('群主积分不足')).toBeVisible();
    expect(screen.queryByRole('button', { name: '充值积分' })).not.toBeInTheDocument();
  });
  it('does not intercept upstream provider quota or unrelated failures', () => {
    const { container } = render(
      <View error={{ type: 'InsufficientQuota', body: { message: 'provider quota' } }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
  it('ignores non-finite and negative credit values', () => {
    render(
      <View
        error={{
          type: 'InsufficientBudgetForModel',
          body: { budget: { shortfallCredits: -12, requiredCredits: NaN } },
        }}
      />,
    );
    expect(screen.queryByText(/还差|-12|NaN/)).not.toBeInTheDocument();
  });
  it('labels an estimated shortfall as an estimate', () => {
    render(
      <View
        error={{
          type: 'InsufficientBudgetForModel',
          body: { budget: { shortfallCredits: 100, pricingBasis: 'estimated' } },
        }}
      />,
    );
    expect(screen.getByText(/预计还差 100/)).toBeVisible();
  });
  it('prevents duplicate retries and surfaces a rejected retry', async () => {
    let rejectRetry: (error: Error) => void = () => {};
    const retry = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          rejectRetry = reject;
        }),
    );
    render(<View error={{ type: 'InsufficientBudgetForModel' }} retry={retry} />);
    const button = screen.getByRole('button', { name: '已充值，重试本次请求' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(retry).toHaveBeenCalledOnce();
    expect(button).toBeDisabled();
    await act(async () => {
      rejectRetry(new Error('network'));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('重试未成功');
    await waitFor(() => expect(button).not.toBeDisabled());
  });
});
