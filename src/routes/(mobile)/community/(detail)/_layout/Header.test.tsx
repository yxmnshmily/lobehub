import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Header from './Header';

const navigate = vi.fn();

vi.mock('@lobehub/ui/base-ui', () => ({
  ActionIcon: ({
    size,
    ...props
  }: React.ComponentProps<'button'> & { size?: { blockSize?: number } }) => (
    <button data-block-size={size?.blockSize} type="button" {...props} />
  ),
}));
vi.mock('@lobehub/ui/mobile', () => ({
  ChatHeader: ({ left }: { left?: React.ReactNode }) => <header>{left}</header>,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));

describe('mobile community detail Header', () => {
  beforeEach(() => navigate.mockClear());

  it.each([
    ['/community/agent/guide', '/community'],
    ['/acme/community/agent/guide', '/acme/community'],
  ])('returns from %s to the matching community root', (pathname, destination) => {
    render(
      <MemoryRouter initialEntries={[pathname]}>
        <Header />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'back' }));
    expect(screen.getByRole('button', { name: 'back' })).toHaveAttribute('data-block-size', '44');
    expect(navigate).toHaveBeenCalledWith(destination, { escape: true });
  });
});
