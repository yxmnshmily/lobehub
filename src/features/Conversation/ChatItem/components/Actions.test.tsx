/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import Actions from './Actions';

const responsiveMock = vi.hoisted(() => ({ mobile: false }));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({
    children,
    direction: _direction,
    horizontal: _horizontal,
    ...props
  }: ComponentProps<'div'> & { direction?: string; horizontal?: boolean }) => (
    <div {...props}>{children}</div>
  ),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    container: 'action-container',
    menu: 'action-menu',
    menuLeft: 'action-menu-left',
    menuRight: 'action-menu-right',
  }),
  useResponsive: () => ({ mobile: responsiveMock.mobile }),
}));

vi.mock('@/store/agent', () => ({ useAgentStore: () => undefined }));
vi.mock('@/store/agent/selectors', () => ({
  builtinAgentSelectors: { webOnboardingAgentId: vi.fn() },
}));
vi.mock('@/utils/env', () => ({ isDev: true }));
vi.mock('../../store', () => ({
  contextSelectors: { agentId: vi.fn() },
  useConversationStore: () => undefined,
}));

describe('ChatItem Actions', () => {
  it('keeps the compact action footer visible on mobile without hover', () => {
    responsiveMock.mobile = true;

    render(<Actions actions={<button>copy</button>} />);

    expect(screen.getByRole('menubar')).toHaveAttribute('data-mobile-action-footer', 'true');
    expect(screen.getByRole('menubar')).toHaveStyle({
      '--message-action-control-size': '28px',
      opacity: '1',
      pointerEvents: 'auto',
    });
  });

  it('keeps assistant controls in the shared responsive action row', () => {
    responsiveMock.mobile = false;
    render(<Actions actionAddon={<span>reaction</span>} actions={<button>copy</button>} />);

    const menu = screen.getByRole('menubar');
    expect(menu).toHaveClass('action-menu', 'action-menu-left');
    expect(menu.parentElement).toHaveClass('action-container');
    expect(menu.previousElementSibling).toHaveTextContent('reaction');
  });

  it('preserves right alignment and addon order for user messages', () => {
    responsiveMock.mobile = false;
    render(
      <Actions
        actionAddon={<span>reaction</span>}
        actions={<button>copy</button>}
        placement="right"
      />,
    );

    const menu = screen.getByRole('menubar');
    expect(menu).toHaveClass('action-menu', 'action-menu-right');
    expect(menu.nextElementSibling).toHaveTextContent('reaction');
  });
});
