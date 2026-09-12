import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useReferenceImageUpload } from './useReferenceImageUpload';

const { mockToastError, mockUploadWithProgress } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockUploadWithProgress: vi.fn(),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  toast: { error: mockToastError },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/store/file', () => ({
  useFileStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ uploadWithProgress: mockUploadWithProgress }),
}));

const createOptions = () => ({
  addUploadingPreviews: vi.fn(),
  canCreate: true,
  maxFileSize: 100,
  removeUploadingPreviews: vi.fn(),
  slots: [
    {
      capacity: 2,
      getCurrentValues: () => [],
      set: vi.fn(),
      values: [],
    },
  ],
  uploadingPreviews: [],
});

describe('useReferenceImageUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
      revokeObjectURL: vi.fn(),
    });
  });

  it('reports oversized files while keeping valid files eligible for upload', async () => {
    mockUploadWithProgress.mockResolvedValue({ url: '/valid.png' });
    const options = createOptions();
    const { result } = renderHook(() => useReferenceImageUpload(options));

    await act(() =>
      result.current.handleUploadFiles([
        new File(['a'.repeat(101)], 'large.png', { type: 'image/png' }),
        new File(['ok'], 'valid.png', { type: 'image/png' }),
      ]),
    );

    expect(mockToastError).toHaveBeenCalled();
    expect(mockUploadWithProgress).toHaveBeenCalledTimes(1);
    expect(options.slots[0].set).toHaveBeenCalledWith(['/valid.png']);
  });

  it('reports a failed upload while landing the rest of the batch', async () => {
    mockUploadWithProgress
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ url: '/landed.png' });
    const options = createOptions();
    const { result } = renderHook(() => useReferenceImageUpload(options));

    await act(() =>
      result.current.handleUploadFiles([
        new File(['a'], 'failed.png', { type: 'image/png' }),
        new File(['b'], 'landed.png', { type: 'image/png' }),
      ]),
    );

    expect(mockToastError).toHaveBeenCalledWith('upload.uploadFailed');
    expect(options.slots[0].set).toHaveBeenCalledWith(['/landed.png']);
    expect(options.removeUploadingPreviews).toHaveBeenCalled();
  });
});
