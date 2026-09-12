import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import GroupProfileButton from './GroupProfileButton';

const { push, createModal } = vi.hoisted(() => ({ push: vi.fn(), createModal: vi.fn() }));
vi.mock('@/hooks/useQueryRoute', () => ({ useQueryRoute: () => ({ push }) }));
vi.mock('@/libs/trpc/client', () => ({ lambdaQuery: {} }));
vi.mock('@lobehub/ui/base-ui', () => ({
  ActionIcon: ({ onClick, title }: any) => <button onClick={onClick}>{title}</button>,
  createModal,
}));

describe('group profile navigation', () => {
  it('opens the same profile route for joined groups instead of a summary modal', () => {
    render(<GroupProfileButton groupId="joined-group" />);
    fireEvent.click(screen.getByRole('button', { name: '群组档案' }));
    expect(push).toHaveBeenCalledWith('/group/joined-group/profile');
    expect(createModal).not.toHaveBeenCalled();
  });
});
