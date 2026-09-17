import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import GroupSidebarSections from './GroupSidebarSections';

vi.mock('@/const/version', () => ({ isDesktop: true, CURRENT_VERSION: 'test' }));
vi.mock('@/hooks/useActiveLocation', () => ({
  useActiveLocation: () => ({ pathname: window.location.pathname }),
}));
vi.mock('./GroupWorkLinks', () => ({ default: () => null }));

vi.mock('@/hooks/useQueryRoute', () => ({ useQueryRoute: () => ({ push: vi.fn() }) }));

const state = vi.hoisted(() => ({ count: 10, nextOffset: null as number | null }));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    groupMembership: {
      listParticipants: {
        useQuery: () => ({
          data: {
            items: [{ memberUserId: 'owner', displayName: 'Owner', role: 'owner' }],
            assistants: Array.from({ length: state.count - 1 }, (_, i) => ({
              id: `ai-${i}`,
              title: `AI ${i}`,
            })),
            nextOffset: state.nextOffset,
          },
        }),
      },
    },
  },
}));
vi.mock('@/features/GroupMembership', () => ({
  GroupMembersButton: ({ showLabel, groupId }: any) =>
    showLabel ? <button data-group={groupId}>更多</button> : null,
}));
vi.mock('@/features/GroupMembership/DefaultGroupActions', () => ({ default: () => null }));
vi.mock('@/features/AgentProfileCard/AgentProfilePopup', () => ({
  default: ({ children }: any) => children,
}));
vi.mock('./RecentTopicLinks', () => ({ default: () => <div>话题列表</div> }));

describe('group member preview', () => {
  it.each([10, 11])('shows More only above ten total members (%s)', (count) => {
    state.count = count;
    state.nextOffset = null;
    render(<GroupSidebarSections groupId="current-group" />);
    expect(screen.getByText(`（${count}）`)).toBeInTheDocument();
    expect(screen.queryByText('（…）')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开成员' }));
    expect(screen.getByText('Owner')).toBeVisible();
    expect(screen.getByRole('button', { name: 'AI 8' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'AI 9' })).toBeNull();
    const more = screen.queryByRole('button', { name: '更多' });
    if (count === 10) expect(more).toBeNull();
    else {
      expect(more).toHaveAttribute('data-group', 'current-group');
      expect(screen.getByRole('button', { name: 'AI 8' }).compareDocumentPosition(more!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(more!.compareDocumentPosition(screen.getByText('话题列表'))).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
  });
  it('offers the full list when more people remain on the server', () => {
    state.count = 10;
    state.nextOffset = 50;
    render(<GroupSidebarSections groupId="joined-group" />);
    fireEvent.click(screen.getByRole('button', { name: '展开成员' }));
    expect(screen.getByRole('button', { name: '更多' })).toHaveAttribute(
      'data-group',
      'joined-group',
    );
  });

  it('leaves scrolling to the enclosing sidebar instead of nesting a member scroller', () => {
    state.count = 10;
    state.nextOffset = null;
    render(<GroupSidebarSections groupId="current-group" />);
    fireEvent.click(screen.getByRole('button', { name: '展开成员' }));

    const preview = document.querySelector<HTMLElement>('[data-group-member-preview]');
    expect(preview).not.toBeNull();
    expect(preview?.style.overflowY).toBe('');
    expect(preview?.style.maxHeight).toBe('');
  });
});
