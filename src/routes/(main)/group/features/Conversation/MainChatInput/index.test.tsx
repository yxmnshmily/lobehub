/**
 * @vitest-environment happy-dom
 */
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MainChatInput from './index';

const mocks = vi.hoisted(() => ({
  chatInputProps: undefined as Record<string, any> | undefined,
  clientId: 'default-travel-service-group' as string | null,
  ids: ['request-1', 'request-2'],
  isMobile: false,
  narrowViewport: false,
  verified: true,
}));

vi.mock('@/libs/better-auth/auth-client', () => ({
  useSession: () => ({
    data: { user: { phoneNumber: '+8613800138000', phoneNumberVerified: mocks.verified } },
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options: { defaultValue: string }) => options.defaultValue,
  }),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
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
    'disabled'?: boolean;
    'min'?: number;
    'onChange'?: (value: number | null) => void;
    'value'?: number | null;
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

vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: { groupConversation: { listTopics: { useQuery: () => ({ data: { items: [] } }) } } },
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
      (groupId: string) => (state: { groupMap: Record<string, { clientId: string | null }> }) =>
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
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mocks.narrowViewport }));

describe('MainChatInput hosted travel group billing', () => {
  it('keeps hosted billing and acceptance when a host supplies the home-style editor', () => {
    const accepted = vi.fn();
    render(
      <MainChatInput onBilledSendAccepted={accepted}>
        <div>工作群输入框</div>
      </MainChatInput>,
    );
    expect(mocks.chatInputProps?.children).toBeDefined();
    let billing: unknown;
    act(() => {
      billing = mocks.chatInputProps?.createBillingForSend();
    });
    expect(billing).toEqual({ idempotencyKey: 'request-1' });
    expect(mocks.chatInputProps?.createBillingForSend()).toBe(false);
    act(() => {
      mocks.chatInputProps?.onBilledSendAccepted();
    });
    expect(accepted).toHaveBeenCalledOnce();
    expect(mocks.chatInputProps?.disableQueue).toBe(true);
  });
  it('blocks group input for an unverified phone and offers account binding', () => {
    mocks.verified = false;
    render(<MainChatInput runtimeProps={{ disableSend: false }} />);
    expect(screen.getByText('请先绑定手机号码')).toBeVisible();
    expect(screen.getByRole('link', { name: '绑定手机号' })).toHaveAttribute(
      'href',
      '/settings/profile#profile-phone',
    );
    expect(screen.getByRole('button', { name: '群聊AI暂不可用，通信管局政策要求' })).toBeDisabled();
    expect(mocks.chatInputProps).toBeUndefined();
  });
  it('restores group input after phone verification refreshes', () => {
    mocks.verified = false;
    const view = render(<MainChatInput />);
    expect(screen.getByRole('button', { name: '群聊AI暂不可用，通信管局政策要求' })).toBeDisabled();
    mocks.verified = true;
    view.rerender(<MainChatInput runtimeProps={{ disableSend: false }} />);
    expect(screen.queryByText('请先绑定手机号码')).not.toBeInTheDocument();
    expect(mocks.chatInputProps?.disableSend).toBe(false);
  });
  it('uses the same group input and action configuration with an authorized runtime', () => {
    render(<MainChatInput runtimeProps={{ disableSend: true, sendAreaPrefix: '服务器群模型' }} />);
    expect(mocks.chatInputProps?.disableSend).toBe(true);
    expect(mocks.chatInputProps?.leftActions.flat()).toContain('fileUpload');
    expect(mocks.chatInputProps?.leftActions.flat()).toContain('mention');
    expect(mocks.chatInputProps?.rightActions).toContain('contextWindow');
    expect(mocks.chatInputProps?.createBillingForSend).toBeUndefined();
    expect(screen.getByText('服务器群模型')).toBeInTheDocument();
  });
  beforeEach(() => {
    mocks.verified = true;
    mocks.chatInputProps = undefined;
    mocks.clientId = 'default-travel-service-group';
    mocks.ids = ['request-1', 'request-2'];
    mocks.isMobile = false;
    mocks.narrowViewport = false;
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(
      () => mocks.ids.shift() as `${string}-${string}-${string}-${string}-${string}`,
    );
  });

  it.each([false, true])('does not require a 积分 input on mobile=%s', (isMobile) => {
    mocks.isMobile = isMobile;
    render(<MainChatInput />);
    expect(mocks.chatInputProps?.leftActions.flat()).toContain('mention');
    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(mocks.chatInputProps?.sendButtonProps).toBeUndefined();
    expect(mocks.chatInputProps?.disableQueue).toBe(true);
  });

  it('keeps ordinary groups on their existing send path', () => {
    mocks.clientId = null;
    render(<MainChatInput />);
    expect(mocks.chatInputProps?.leftActions.flat()).toContain('mention');
    expect(mocks.chatInputProps?.createBillingForSend).toBeUndefined();
  });

  it('mints one key per accepted send, blocks a duplicate start, and allows retry on failure', () => {
    render(<MainChatInput />);

    let firstBilling: unknown;
    act(() => {
      firstBilling = mocks.chatInputProps?.createBillingForSend();
    });
    expect(firstBilling).toEqual({ idempotencyKey: 'request-1' });
    expect(mocks.chatInputProps?.createBillingForSend()).toBe(false);

    act(() => {
      mocks.chatInputProps?.onBilledSendSettled({ accepted: false });
    });
    expect(mocks.chatInputProps?.sendButtonProps).toBeUndefined();

    let retryBilling: unknown;
    act(() => {
      retryBilling = mocks.chatInputProps?.createBillingForSend();
    });
    expect(retryBilling).toEqual({ idempotencyKey: 'request-2' });
  });

  it('allows the next send after acceptance without asking for another ceiling', () => {
    render(<MainChatInput />);

    act(() => {
      mocks.chatInputProps?.createBillingForSend();
      mocks.chatInputProps?.onBilledSendAccepted();
    });
    expect(mocks.chatInputProps?.sendButtonProps).toBeUndefined();

    act(() => {
      mocks.chatInputProps?.onBilledSendSettled({ accepted: true });
    });
    expect(mocks.chatInputProps?.sendButtonProps).toBeUndefined();
    let billing: unknown;
    act(() => {
      billing = mocks.chatInputProps?.createBillingForSend();
    });
    expect(billing).toEqual({ idempotencyKey: 'request-2' });
  });
});
