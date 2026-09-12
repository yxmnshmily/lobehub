import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import UploadCard from './UploadCard';

const { mockToastError, mockUploadWithProgress } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockUploadWithProgress: vi.fn(),
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { error: mockToastError },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/libs/next/Image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));

vi.mock('@/store/file', () => ({
  useFileStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ uploadWithProgress: mockUploadWithProgress }),
}));

describe('UploadCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:preview'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('reports an oversized reference instead of silently ignoring it', async () => {
    const { container } = render(
      <UploadCard maxFileSize={100} onRemove={vi.fn()} onUpload={vi.fn()} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const oversized = new File(['a'.repeat(101)], 'large.png', { type: 'image/png' });

    fireEvent.change(input, { target: { files: [oversized] } });

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    expect(mockUploadWithProgress).not.toHaveBeenCalled();
  });

  it('reports a rejected reference upload and restores the card', async () => {
    mockUploadWithProgress.mockRejectedValueOnce(new Error('network'));
    const { container } = render(
      <UploadCard maxFileSize={100} onRemove={vi.fn()} onUpload={vi.fn()} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['ok'], 'ok.png', { type: 'image/png' });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('upload.uploadFailed'));
    expect(screen.getByRole('button', { name: 'addNew' })).toBeInTheDocument();
  });

  it('keeps the remove control labelled and touch-sized without hover', () => {
    render(<UploadCard imageUrl="/reference.png" onRemove={vi.fn()} onUpload={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'delete' })).toHaveStyle({
      minHeight: '44px',
      minWidth: '44px',
    });
  });
});
