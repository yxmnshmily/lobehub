/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import MobileChatPage from './index';

vi.mock('@/routes/(main)/agent/features/Conversation/ChatHydration', () => ({
  default: () => null,
}));
vi.mock('@/routes/(main)/agent/features/Conversation/ConversationArea', () => ({
  default: ({ mobile }: { mobile?: boolean }) => (
    <div data-mobile={String(Boolean(mobile))}>conversation</div>
  ),
}));
vi.mock('@/routes/(main)/agent/features/Portal/features/PortalPanel', () => ({
  default: () => null,
}));
vi.mock('@/routes/(main)/agent/features/TelemetryNotification', () => ({
  default: () => null,
}));
vi.mock('./features/Topic', () => ({ default: () => null }));

describe('MobileChatPage', () => {
  it('marks the shared conversation surface as mobile so desktop-only overlays stay hidden', () => {
    render(<MobileChatPage />);

    expect(screen.getByText('conversation')).toHaveAttribute('data-mobile', 'true');
  });
});
