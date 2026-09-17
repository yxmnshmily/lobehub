import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

import BulkSelectionBar from './BulkSelectionBar';

it('selects, clears and disables destructive action while busy', async () => {
  const onSelectAll = vi.fn();
  const onClear = vi.fn();
  const onDelete = vi.fn();
  const props = { onSelectAll, onClear, onDelete, total: 2, selectedCount: 0 };
  const view = render(<BulkSelectionBar {...props} />);
  expect(screen.getByRole('button')).toBeDisabled();
  await userEvent.click(screen.getByRole('checkbox'));
  expect(onSelectAll).toHaveBeenCalledOnce();
  view.rerender(<BulkSelectionBar {...props} selectedCount={2} />);
  await userEvent.click(screen.getByRole('checkbox'));
  expect(onClear).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole('button'));
  expect(onDelete).toHaveBeenCalledOnce();
  view.rerender(<BulkSelectionBar {...props} busy selectedCount={2} />);
  expect(screen.getByRole('checkbox')).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByRole('button')).toBeDisabled();
});
