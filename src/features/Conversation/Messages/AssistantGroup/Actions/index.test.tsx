/**
 * @vitest-environment happy-dom
 */
import type { UIChatMessage } from '@lobechat/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GroupActionsBar, GroupActionsSlot } from './index';

const storeMock = vi.hoisted(() => ({ isGenerating: false }));
const responsiveMock = vi.hoisted(() => ({ mobile: false }));

vi.mock('antd-style', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useResponsive: () => ({ mobile: responsiveMock.mobile }),
}));

// Stub the action bar to expose the resolved `bar` / `menu` slots verbatim.
vi.mock('../../components/MessageActionBar', () => ({
  MessageActionBar: ({
    bar,
    leading,
    menu,
  }: {
    bar?: string[];
    leading?: React.ReactNode;
    menu?: string[];
  }) => (
    <div
      data-bar={(bar ?? []).join(',')}
      data-has-leading={!!leading}
      data-menu={(menu ?? []).join(',')}
      data-testid="action-bar"
    >
      {leading}
    </div>
  ),
}));

vi.mock('../../../components/Reaction', () => ({
  ReactionPicker: () => <span data-testid="reaction-picker" />,
}));

// isAssistantGroupItemGenerating(id) is called through useConversationStore; the
// mocked hook feeds the selector our controllable flag.
vi.mock('../../../store', () => ({
  messageStateSelectors: {
    isAssistantGroupItemGenerating: () => (isGenerating: boolean) => isGenerating,
  },
  useConversationStore: (selector: (v: boolean) => unknown) => selector(storeMock.isGenerating),
}));

const data = { id: 'group-1', role: 'assistantGroup', tools: [] } as unknown as UIChatMessage;

const renderBar = (props: { contentId?: string }) =>
  render(<GroupActionsBar data={data} id="group-1" {...props} />);

describe('GroupActionsBar — hetero (assistantGroup) forward/select gating', () => {
  it('renders each group message action bar inline on mobile instead of waiting for hover', () => {
    responsiveMock.mobile = true;
    const { container } = render(<GroupActionsSlot contentId="block-text" data={data} id="group-1" />);

    expect(screen.getByTestId('action-bar')).toBeInTheDocument();
    expect(container.querySelector('[data-assistant-group-action-bar-portal]')).toBeNull();
  });

  it('keeps the singleton portal placeholder on desktop', () => {
    responsiveMock.mobile = false;
    const { container } = render(<GroupActionsSlot contentId="block-text" data={data} id="group-1" />);

    expect(screen.queryByTestId('action-bar')).toBeNull();
    expect(container.querySelector('[data-assistant-group-action-bar-portal]')).toBeInTheDocument();
  });

  it('still generating with no text block → only delete', () => {
    storeMock.isGenerating = true;
    renderBar({ contentId: undefined });

    const bar = screen.getByTestId('action-bar');
    expect(bar).toHaveAttribute('data-bar', 'del');
    expect(bar).toHaveAttribute('data-menu', '');
  });

  it('finished but last block is a tool call → exposes share, select, and delete', () => {
    storeMock.isGenerating = false;
    renderBar({ contentId: undefined });

    const bar = screen.getByTestId('action-bar');
    const menu = bar.getAttribute('data-menu') ?? '';
    expect(menu.split(',')).toContain('select');
    expect(menu.split(',')).toContain('share');
    expect(menu.split(',')).toContain('del');
    expect(menu.split(',')).toContain('copy');
    expect(menu.split(',')).toContain('regenerate');
    expect(menu.split(',')).not.toContain('branching');
    expect(menu.split(',')).not.toContain('tts');
    expect(menu.split(',')).not.toContain('edit');
    expect(bar).toHaveAttribute('data-bar', 'delAndRegenerate,copy,download');
  });

  it('finished with a trailing text block → full menu', () => {
    storeMock.isGenerating = false;
    renderBar({ contentId: 'block-text' });

    const bar = screen.getByTestId('action-bar');
    const menu = bar.getAttribute('data-menu') ?? '';
    expect(menu.split(',')).toContain('select');
    expect(menu.split(',')).toContain('share');
    expect(menu.split(',')).toContain('edit');
    expect(menu.split(',')).toContain('tts');
    expect(menu.split(',')).toContain('translate');
    expect(menu.split(',')).toContain('delAndRegenerate');
    expect(menu.split(',')).not.toContain('branching');
    expect(bar).toHaveAttribute('data-has-leading', 'true');
    expect(screen.getByTestId('reaction-picker')).toBeInTheDocument();
  });
});
