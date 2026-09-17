import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useGroupWorkRequest } from '@/features/SuperGroup/useGroupWorkRequest';

import ChatPortal from './index';

vi.mock('react-router', () => ({ useParams: () => ({ gid: 'group' }) }));
vi.mock('@/routes/(main)/agent/features/Portal/features/Portal', () => ({
  default: ({ children }: any) => children,
}));
vi.mock('@/routes/(main)/agent/features/Portal/features/PortalPanel', () => ({
  default: () => <div>群聊详情宿主</div>,
}));
vi.mock('@/components/Skeleton/Surface', () => ({ default: () => null }));

afterEach(() => useGroupWorkRequest.setState({ request: null }));

describe('group portal ownership', () => {
  it.each(['goals', 'tasks'] as const)(
    'lets embedded %s own details and restores chat on close',
    (kind) => {
      render(<ChatPortal />);
      expect(screen.getByText('群聊详情宿主')).toBeVisible();
      for (let i = 0; i < 2; i++) {
        act(() =>
          useGroupWorkRequest.setState({
            request: { groupId: 'group', kind, detail: { id: 'work' } },
          }),
        );
        expect(screen.queryByText('群聊详情宿主')).not.toBeInTheDocument();
        act(() => useGroupWorkRequest.setState({ request: null }));
        expect(screen.getByText('群聊详情宿主')).toBeVisible();
      }
    },
  );

  it('keeps chat details for lists and requests belonging to another group', () => {
    useGroupWorkRequest.setState({ request: { groupId: 'group', kind: 'goals' } });
    render(<ChatPortal />);
    expect(screen.getByText('群聊详情宿主')).toBeVisible();
    act(() =>
      useGroupWorkRequest.setState({
        request: { groupId: 'other', kind: 'goals', detail: { id: 'work' } },
      }),
    );
    expect(screen.getByText('群聊详情宿主')).toBeVisible();
  });
});
