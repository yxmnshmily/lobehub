/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import SendButton from './SendButton';

const mocks = vi.hoisted(() => ({
  state: {
    handleSendButton: vi.fn(),
    handleStop: vi.fn(),
    mobile: true,
    sendButtonProps: { disabled: false, size: 32 as number | undefined },
    sendMenu: { items: [{ key: 'send-all', label: '发送全部', onClick: vi.fn() }] },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({ more: '更多', send: '发送', stop: '停止' })[key] || key,
  }),
}));

vi.mock('@lobehub/editor/react', () => ({
  SendButton: ({
    generating,
    onStop,
    size,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    generating?: boolean;
    onStop?: () => void;
    size?: number;
  }) => (
    <button
      {...props}
      data-control-size={size}
      type="button"
      onClick={generating ? onStop : props.onClick}
    />
  ),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ActionIcon: ({
    icon: _icon,
    size,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    icon: unknown;
    size?: number | { blockSize?: number };
  }) => (
    <button
      {...props}
      data-control-size={typeof size === 'object' ? size.blockSize : size}
      type="button"
    />
  ),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true }),
}));

vi.mock('../hooks/useChatInputResourceAccess', () => ({
  useChatInputResourceAccess: () => ({ canUseResource: true }),
}));

vi.mock('../store', () => ({
  selectors: { sendButtonProps: (state: typeof mocks.state) => state.sendButtonProps },
  useChatInputStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
}));

describe('SendButton accessibility', () => {
  it('opens the send options and runs the selected action', async () => {
    render(<SendButton />);
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '发送全部' }));
    expect(mocks.state.sendMenu.items[0].onClick).toHaveBeenCalledOnce();
  });

  it('gives both the send action and its options trigger an accessible name', () => {
    render(<SendButton />);

    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更多' })).toBeInTheDocument();
  });

  it('uses one 44px control height for the mobile send group', () => {
    mocks.state.sendButtonProps.size = undefined;

    render(<SendButton />);

    expect(screen.getByRole('button', { name: '发送' })).toHaveAttribute('data-control-size', '44');
    expect(screen.getByRole('button', { name: '更多' })).toHaveAttribute('data-control-size', '44');
  });
});
