import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import GroupWorkDraft from './GroupWorkDraft';

it('requires a description and only returns a draft, without creating or sending work', () => {
  const onDraft = vi.fn();
  render(<GroupWorkDraft kind="goals" onDraft={onDraft} />);
  expect(screen.getByRole('button', { name: '填入群聊草稿' })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: '你期望达到的目标' }), {
    target: { value: '整理一份行程' },
  });
  fireEvent.click(screen.getByRole('button', { name: '填入群聊草稿' }));
  expect(onDraft).toHaveBeenCalledOnce();
  expect(onDraft).toHaveBeenCalledWith(expect.stringContaining('整理一份行程'));
});
