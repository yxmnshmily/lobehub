/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ChatConversation from './index';

const mocks = vi.hoisted(() => ({ isMobile: true }));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/DragUploadZone', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  useUploadFiles: () => ({ handleUploadFiles: vi.fn() }),
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: object) => unknown) => selector({}),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    currentAgentModel: () => '',
    currentAgentModelProvider: () => '',
  },
}));
vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: { isMobile: boolean }) => unknown) =>
    selector({ isMobile: mocks.isMobile }),
}));
vi.mock('./ConversationArea', () => ({
  default: ({ mobile }: { mobile?: boolean }) => (
    <div data-mobile={String(Boolean(mobile))}>group conversation</div>
  ),
}));
vi.mock('./Header', () => ({ default: () => null }));

describe('Group ChatConversation', () => {
  it('marks the shared conversation area as mobile on the mobile router', () => {
    mocks.isMobile = true;
    render(<ChatConversation />);

    expect(screen.getByText('group conversation')).toHaveAttribute('data-mobile', 'true');
  });
});
