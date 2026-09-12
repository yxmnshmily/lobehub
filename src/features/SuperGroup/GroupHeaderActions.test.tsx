import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';

import GroupHeaderActions from './GroupHeaderActions';

const modal = vi.hoisted(() => vi.fn((_options: unknown) => ({ close: vi.fn() })));
vi.mock('@lobehub/ui/base-ui', async (importOriginal) => {
  const { useState } = await import('react');
  return {
    ...(await importOriginal<object>()),
    createModal: modal,
    Popover: ({
      children,
      content,
      onOpenChange,
    }: {
      children: ReactNode;
      content: ReactNode;
      onOpenChange?: (open: boolean) => void;
    }) => {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <div
            onClick={() => {
              setOpen(true);
              onOpenChange?.(true);
            }}
          >
            {children}
          </div>
          {open && content}
        </div>
      );
    },
  };
});
vi.mock('@/features/GroupMembership/GroupShareButton', () => ({
  default: () => <button type="button">分享聊天记录</button>,
}));
vi.mock('@/features/GroupMembership/MemberPanel', () => ({ default: () => null }));
vi.mock('@/features/WideScreenContainer/WideScreenButton', () => ({ default: () => null }));
vi.mock('./GroupProfileButton', () => ({
  default: () => <button type="button">群组档案</button>,
}));
vi.mock('./GroupSearchButton', () => ({
  default: () => <button type="button">搜索群内容</button>,
}));
vi.mock('./GroupLogs', () => ({ default: () => null }));
vi.mock('./GroupInfoPanel', () => ({
  default: ({ groupId }: { groupId: string }) => <section aria-label="群信息">{groupId}</section>,
}));

it.each(['mine', 'joined'])(
  'opens the shared information panel for the %s group',
  async (groupId) => {
    modal.mockClear();
    render(<GroupHeaderActions groupId={groupId} />);
    fireEvent.click(screen.getByRole('button', { name: '群聊更多操作' }));
    expect(await screen.findByRole('region', { name: '群信息' })).toHaveTextContent(groupId);
    expect(modal).not.toHaveBeenCalled();
  },
);

it('keeps the mobile header compact while preserving secondary actions in more', async () => {
  render(
    <GroupHeaderActions mobile groupId="mine">
      <button type="button">历史会话</button>
    </GroupHeaderActions>,
  );

  expect(screen.getByRole('button', { name: '历史会话' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '群组档案' })).toBeNull();
  expect(screen.queryByRole('button', { name: '搜索群内容' })).toBeNull();
  expect(screen.queryByRole('button', { name: '分享聊天记录' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '群聊更多操作' }));

  expect(await screen.findByRole('button', { name: '群组档案' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '搜索群内容' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '分享聊天记录' })).toBeInTheDocument();
});

it('keeps mobile secondary actions available when the information panel is unavailable', async () => {
  render(<GroupHeaderActions mobile groupId="joined" showMembers={false} />);

  fireEvent.click(screen.getByRole('button', { name: '群聊更多操作' }));

  expect(await screen.findByRole('button', { name: '群组档案' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '搜索群内容' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '分享聊天记录' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '群信息' })).toBeNull();
});

it('keeps secondary actions inline on desktop', () => {
  render(<GroupHeaderActions groupId="mine" />);

  expect(screen.getByRole('button', { name: '群组档案' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '搜索群内容' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '分享聊天记录' })).toBeInTheDocument();
});
