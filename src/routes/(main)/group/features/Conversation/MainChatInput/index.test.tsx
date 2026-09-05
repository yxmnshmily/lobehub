/**
 * @vitest-environment happy-dom
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MainChatInput from './index';

const mocks = vi.hoisted(() => ({
  chatInputProps: undefined as Record<string, any> | undefined,
  clientId: 'default-travel-service-group' as string | null,
  ids: ['request-1', 'request-2'],
  isMobile: false,
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  InputNumber: ({
    'aria-label': ariaLabel,
    disabled,
    min,
    onChange,
    value,
  }: {
    'aria-label': string;
    disabled?: boolean;
    min?: number;
    onChange?: (value: number | null) => void;
    value?: number | null;
  }) => (
    <input
      aria-label={ariaLabel}
      disabled={disabled}
      min={min}
      type="number"
      value={value ?? ''}
      onChange={(event) =>
        onChange?.(event.currentTarget.value === '' ? null : Number(event.currentTarget.value))
      }
    />
  ),
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/Conversation', () => ({
  ChatInput: (props: Record<string, any>) => {
    mocks.chatInputProps = props;
    return <div>{props.sendAreaPrefix}</div>;
  },
}));

vi.mock('@/store/agentGroup', () => ({
  useAgentGroupStore: (selector: (state: Record<string, any>) => unknown) =>
    selector({
      activeGroupId: 'group-1',
      groupMap: { 'group-1': { clientId: mocks.clientId, id: 'group-1' } },
    }),
}));

vi.mock('@/store/agentGroup/selectors', () => ({
  agentGroupSelectors: {
    getGroupById:
      (groupId: string) =>
      (state: { groupMap: Record<string, { clientId: string | null }> }) =>
        state.groupMap[groupId],
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: { setState: vi.fn() },
}));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: { isMobile: boolean }) => unknown) =>
    selector({ isMobile: mocks.isMobile }),
}));

vi.mock('./useSendMenuItems', () => ({ useSendMenuItems: () => [] }));

describe('MainChatInput hosted travel group billing', () => {
  beforeEach(() => {
    mocks.chatInputProps = undefined;
    mocks.clientId = 'default-travel-service-group';
    mocks.ids = ['request-1', 'request-2'];
    mocks.isMobile = false;
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(
      () => mocks.ids.shift() as `${string}-${string}-${string}-${string}-${string}`,
    );
  });

  it('uses a compact Credits label on mobile so the send button stays inside the composer', () => {
    mocks.isMobile = true;

    render(<MainChatInput />);

    expect(screen.getByText('最高 Credits')).toBeInTheDocument();
    expect(screen.queryByText('本次最高消费 Credits')).toBeNull();
  });

  it('requires a positive integer Credits ceiling only for the managed travel group', () => {
    const { unmount } = render(<MainChatInput />);

    const input = screen.getByRole('spinbutton', { name: '本次最高消费 Credits' });
    expect(input).toHaveAttribute('min', '1');
    expect(mocks.chatInputProps?.disableQueue).toBe(true);
    expect(mocks.chatInputProps?.sendButtonProps).toEqual({ disabled: true });

    fireEvent.change(input, { target: { value: '12.5' } });
    expect(mocks.chatInputProps?.sendButtonProps).toEqual({ disabled: true });

    unmount();
    mocks.clientId = null;
    render(<MainChatInput />);

    expect(screen.queryByRole('spinbutton', { name: '本次最高消费 Credits' })).toBeNull();
    expect(mocks.chatInputProps?.disableQueue).toBeUndefined();
    expect(mocks.chatInputProps?.createBillingForSend).toBeUndefined();
  });

  it('mints one key per accepted send, blocks a duplicate start, and retains the ceiling on failure', () => {
    render(<MainChatInput />);
    const input = screen.getByRole('spinbutton', { name: '本次最高消费 Credits' });
    fireEvent.change(input, { target: { value: '24' } });

    let firstBilling: unknown;
    act(() => {
      firstBilling = mocks.chatInputProps?.createBillingForSend();
    });
    expect(firstBilling).toEqual({ idempotencyKey: 'request-1', maxCredits: 24 });
    expect(mocks.chatInputProps?.createBillingForSend()).toBe(false);

    act(() => {
      mocks.chatInputProps?.onBilledSendSettled({ accepted: false });
    });
    expect(input).toHaveValue(24);

    let retryBilling: unknown;
    act(() => {
      retryBilling = mocks.chatInputProps?.createBillingForSend();
    });
    expect(retryBilling).toEqual({ idempotencyKey: 'request-2', maxCredits: 24 });
  });

  it('releases the start lock on acceptance and clears the ceiling after the accepted send settles', () => {
    render(<MainChatInput />);
    const input = screen.getByRole('spinbutton', { name: '本次最高消费 Credits' });
    fireEvent.change(input, { target: { value: '8' } });

    act(() => {
      mocks.chatInputProps?.createBillingForSend();
      mocks.chatInputProps?.onBilledSendAccepted();
    });
    expect(mocks.chatInputProps?.sendButtonProps).toBeUndefined();

    act(() => {
      mocks.chatInputProps?.onBilledSendSettled({ accepted: true });
    });
    expect(input).toHaveValue(null);
    expect(mocks.chatInputProps?.sendButtonProps).toEqual({ disabled: true });
  });
});
