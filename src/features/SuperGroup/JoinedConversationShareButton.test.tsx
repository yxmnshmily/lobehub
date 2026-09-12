import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import JoinedConversationShareButton from './JoinedConversationShareButton';

const open = vi.hoisted(() => vi.fn().mockResolvedValue({ close: vi.fn() }));
vi.mock('@/features/ShareModal', () => ({ openShareModal: open }));
vi.mock('@/features/GroupMembership/GroupShareButton', () => ({ default: () => null }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));

it.each([false, true])('shares only the joined group snapshot (mobile=%s)', async (mobile) => {
  open.mockClear();
  const messages = [{ id: 'visible', content: '当前群可见消息', role: 'user' } as never];
  render(
    <JoinedConversationShareButton
      groupId="joined"
      topicId="topic"
      messages={messages}
      title="加入的群"
      mobile={mobile}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '分享聊天内容' }));
  await waitFor(() =>
    expect(open).toHaveBeenCalledWith({
      snapshot: {
        context: {
          agentId: '',
          groupId: 'joined',
          topicId: 'topic',
          scope: 'group',
          threadId: null,
        },
        messages,
        title: '加入的群',
      },
    }),
  );
});

it('keeps an empty conversation from opening an unrelated share', () => {
  render(<JoinedConversationShareButton groupId="joined" messages={[]} title="群" />);
  expect(screen.getByRole('button', { name: '分享聊天内容' })).toBeDisabled();
});
