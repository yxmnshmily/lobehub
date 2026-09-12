/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MobileChatInput from './index';

const layout = vi.hoisted(() => ({ expand: false }));
beforeEach(() => {
  layout.expand = false;
});

vi.mock('@lobehub/editor/react', () => ({
  ChatInput: ({
    children,
    className,
    footer,
    header,
    maxHeight,
    minHeight,
    resize,
  }: {
    children: ReactNode;
    className?: string;
    footer?: ReactNode;
    header?: ReactNode;
    maxHeight?: number;
    minHeight?: number;
    resize?: boolean;
  }) => (
    <section
      className={className}
      data-max-height={maxHeight}
      data-min-height={minHeight}
      data-resize={String(resize)}
      data-testid="mobile-chat-input"
    >
      {header}
      {children}
      {footer}
    </section>
  ),
  ChatInputActionBar: ({ left, right }: { left?: ReactNode; right?: ReactNode }) => (
    <div role="toolbar">
      {left}
      {right}
    </div>
  ),
}));
vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));
vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    actionRow: 'action-row',
    editorWrapper: 'editor-wrapper',
    footerRow: 'footer-row',
    headerRow: 'header-row',
    inputRoot: 'input-root',
    leftSlot: 'left-slot',
  }),
  cssVar: {},
  cx: (...values: string[]) => values.filter(Boolean).join(' '),
}));
vi.mock('@/libs/next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/features/ChatInput/store', () => ({
  useChatInputStore: (
    selector: (state: { expand: boolean; leftActions: string[]; slashMenuRef: null }) => unknown,
  ) => selector({ expand: layout.expand, leftActions: [], slashMenuRef: null }),
}));
vi.mock('../ActionBar', () => ({
  default: ({ disableCollapse }: { disableCollapse?: boolean }) => (
    <div data-disable-collapse={String(Boolean(disableCollapse))} data-testid="mobile-action-bar" />
  ),
}));
vi.mock('../InputEditor', () => ({ default: () => <div data-testid="mobile-input-editor" /> }));
vi.mock('../SendArea', () => ({ default: () => <button>发送</button> }));
vi.mock('../ChatInputNotice', () => ({ default: () => null }));

describe('MobileChatInput', () => {
  it('does not constrain the fullscreen editor with the attached banner wrapper', () => {
    layout.expand = true;
    render(<MobileChatInput inputBanner={<button>提示词</button>} />);
    expect(screen.getByTestId('mobile-chat-input').parentElement).toHaveStyle({
      display: 'contents',
    });
    expect(screen.queryByRole('button', { name: '提示词' })).not.toBeInTheDocument();
  });
  it('keeps the billing prefix outside the send controls row without losing either control', () => {
    render(<MobileChatInput sendAreaPrefix={<input aria-label="积分" />} />);
    expect(screen.getByRole('textbox', { name: '积分' }).closest('[role="toolbar"]')).toBeNull();
    expect(screen.getByRole('button', { name: '发送' }).closest('[role="toolbar"]')).not.toBeNull();
  });
  it('wraps the contenteditable host in a non-flex element', () => {
    render(<MobileChatInput />);

    expect(screen.getByTestId('mobile-input-editor').parentElement).toHaveClass('editor-wrapper');
  });

  it('keeps overflowing mobile actions collapsible instead of clipping them', () => {
    render(<MobileChatInput />);

    const actionBar = screen.getByTestId('mobile-action-bar');

    expect(actionBar).toHaveAttribute('data-disable-collapse', 'false');
    expect(actionBar.parentElement).toHaveClass('left-slot');
  });

  it('uses a stable compact editor surface on mobile', () => {
    render(<MobileChatInput />);

    expect(screen.getByTestId('mobile-chat-input')).toHaveClass('input-root');
    expect(screen.getByTestId('mobile-chat-input')).toHaveAttribute('data-resize', 'false');
    expect(screen.getByTestId('mobile-chat-input')).toHaveAttribute('data-min-height', '64');
    expect(screen.getByTestId('mobile-chat-input')).toHaveAttribute('data-max-height', '160');
  });
});
