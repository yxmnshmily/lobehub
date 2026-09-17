import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import SearchInput from './SearchInput';

const { mockSetSearchQuery } = vi.hoisted(() => ({
  mockSetSearchQuery: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/ResourceManager/store', () => ({
  useResourceManagerStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ setSearchQuery: mockSetSearchQuery }),
}));

describe('SearchInput', () => {
  it('returns keyboard focus to the search trigger when Escape closes the input', async () => {
    const user = userEvent.setup();
    render(<SearchInput mobile />);
    await user.click(screen.getByRole('button', { name: 'FileManager.search.placeholder' }));
    await user.type(screen.getByRole('textbox'), 'photo');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'FileManager.search.placeholder' })).toHaveFocus();
  });

  it('exposes a labelled 44px clear-search button on mobile', async () => {
    const user = userEvent.setup();
    render(<SearchInput mobile />);

    await user.click(screen.getByRole('button', { name: 'FileManager.search.placeholder' }));
    await user.type(screen.getByRole('textbox'), 'photo');

    const clearButton = screen.getByRole('button', { name: 'FileManager.search.clear' });
    expect(clearButton).toHaveStyle({ minHeight: '44px', minWidth: '44px' });

    await user.click(clearButton);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(mockSetSearchQuery).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('button', { name: 'FileManager.search.placeholder' })).toHaveFocus();
  });
});
