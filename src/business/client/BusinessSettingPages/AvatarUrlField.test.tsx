import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import AvatarUrlField from './AvatarUrlField';

const upload = vi.hoisted(() => vi.fn());
vi.mock('@/store/file', () => ({
  useFileStore: (selector: any) => selector({ uploadWithProgress: upload }),
}));
beforeEach(() => {
  upload.mockReset();
});

it('fills the uploaded URL without saving the account', async () => {
  upload.mockResolvedValue({ url: 'https://images.example.com/avatar.png' });
  const onChange = vi.fn();
  render(<AvatarUrlField value="" onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('选择头像图片'), {
    target: { files: [new File(['image'], 'avatar.png', { type: 'image/png' })] },
  });
  await waitFor(() =>
    expect(onChange).toHaveBeenCalledWith('https://images.example.com/avatar.png'),
  );
});

it('rejects non-images before uploading', () => {
  render(<AvatarUrlField value="" onChange={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('选择头像图片'), {
    target: { files: [new File(['text'], 'a.txt', { type: 'text/plain' })] },
  });
  expect(upload).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('仅支持');
});

it('keeps the previous URL if upload fails', async () => {
  upload.mockRejectedValue(new Error('failure'));
  const onChange = vi.fn();
  render(<AvatarUrlField value="https://images.example.com/old.png" onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('选择头像图片'), {
    target: { files: [new File(['image'], 'avatar.png', { type: 'image/png' })] },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent('上传失败');
  expect(onChange).not.toHaveBeenCalled();
});
