import { expect, it, vi } from 'vitest';

import { resolveLocalReference } from './localReference';

it('preserves external reference URLs even when their path was normalized as a storage key', async () => {
  const files = {
    getFullFileUrl: vi
      .fn()
      .mockResolvedValue('http://localhost:9000/lobe/dc/ops-assets/image.webp'),
    getFileMetadata: vi.fn().mockRejectedValue(new Error('NotFound')),
    getFileByteArray: vi.fn(),
  };
  expect(
    await resolveLocalReference(
      files,
      'dc/ops-assets/image.webp',
      'https://assets.example/dc/ops-assets/image.webp',
    ),
  ).toBe('https://assets.example/dc/ops-assets/image.webp');
  expect(files.getFileMetadata).not.toHaveBeenCalled();
});

it('sends local storage images as data instead of URLs unreachable by the provider', async () => {
  const files = {
    getFullFileUrl: vi.fn().mockResolvedValue('http://localhost:9000/lobe/image.webp'),
    getFileMetadata: vi.fn().mockResolvedValue({ contentType: 'image/webp', contentLength: 3 }),
    getFileByteArray: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  };
  expect(await resolveLocalReference(files, 'image.webp')).toBe('data:image/webp;base64,AQID');
});

it('preserves public URLs without reading image bytes', async () => {
  const files = {
    getFullFileUrl: vi.fn().mockResolvedValue('https://storage.example/image.webp'),
    getFileMetadata: vi.fn(),
    getFileByteArray: vi.fn(),
  };
  expect(await resolveLocalReference(files, 'image.webp')).toBe(
    'https://storage.example/image.webp',
  );
  expect(files.getFileByteArray).not.toHaveBeenCalled();
});
