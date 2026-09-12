import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import Header from './Header';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', async () => {
  const { useNavigate } = await import('react-router');
  return { useWorkspaceAwareNavigate: useNavigate };
});

describe('settings sidebar header', () => {
  it('opens the canonical desktop settings home from the settings breadcrumb', () => {
    const LocationProbe = () => <output aria-label="current path">{useLocation().pathname}</output>;

    render(
      <MemoryRouter initialEntries={['/settings/hotkey']}>
        <Header />
        <LocationProbe />
      </MemoryRouter>,
    );

    const breadcrumbLinks = screen.getAllByRole('link');
    fireEvent.click(breadcrumbLinks.at(-1)!);

    expect(screen.getByRole('status', { name: 'current path' })).toHaveTextContent(
      '/settings/appearance',
    );
  });
});
