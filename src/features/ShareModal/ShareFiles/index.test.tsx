import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import ShareFiles from './index';

const mocks = vi.hoisted(() => ({ getDocument: vi.fn(), exportFile: vi.fn() }));
vi.mock('@lobechat/utils/client', () => ({ exportFile: mocks.exportFile }));
vi.mock('@/services/document', () => ({ documentService: { getDocumentById: mocks.getDocument } }));
vi.mock('../ShareDataProvider', () => ({
  useShareData: () => ({
    dbMessages: [
      {
        content: '[行程](/page/docs_trip)',
        createdAt: new Date(2026, 8, 5, 18, 25).getTime(),
        fileList: [{ name: '附件.pdf', url: '/f/1', downloadUrl: '/api/download/1' }],
      },
    ],
    displayMessages: [],
  }),
}));

beforeEach(() => vi.clearAllMocks());

it('renders an original-file download and exports the authorized document content', async () => {
  mocks.getDocument.mockResolvedValue({ content: '# 旅行行程' });
  render(<ShareFiles />);
  expect(screen.getByRole('link')).toHaveAttribute('href', '/api/download/1');
  expect(screen.getByRole('link')).toHaveAttribute('download', '附件.pdf');
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(mocks.exportFile).toHaveBeenCalledWith('# 旅行行程', '行程.md'));
});

it('does not produce an empty export when document access is denied', async () => {
  mocks.getDocument.mockRejectedValue(new Error('FORBIDDEN'));
  render(<ShareFiles />);
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(screen.getByRole('button')).not.toBeDisabled());
  expect(mocks.exportFile).not.toHaveBeenCalled();
});

it('switches content categories without losing the original download destination', () => {
  const { rerender } = render(<ShareFiles category="images" />);
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();

  rerender(<ShareFiles category="documents" />);
  expect(screen.getByRole('link')).toHaveAttribute('href', '/api/download/1');
  expect(screen.getByRole('button')).toBeTruthy();
});

it('shows the source message date and minute for each archived item', () => {
  render(<ShareFiles />);
  expect(screen.getAllByText('2026年09月05日 18:25')).toHaveLength(2);
});
