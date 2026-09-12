import { describe, expect, it } from 'vitest';

import { toStableAssetUrl } from './stableAssetUrl';

const SIGNED =
  'http://localhost:9000/lobe/files/496903/6c3aec6a-2f9c-4215-af6e-3dd493772fbb.webp?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=admin%2F20260909%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260909T095305Z&X-Amz-Expires=7200&X-Amz-Signature=e3df7528b534c7f6b77dc9d61ae5a1800f8be318ad51f4f65d821fbb1d722a64&X-Amz-SignedHeaders=host&x-id=GetObject';

describe('toStableAssetUrl', () => {
  it('strips the expiring signature so the asset URL stays stable', () => {
    expect(toStableAssetUrl(SIGNED)).toBe(
      'http://localhost:9000/lobe/files/496903/6c3aec6a-2f9c-4215-af6e-3dd493772fbb.webp',
    );
  });

  it('keeps non-expiring query params untouched', () => {
    const url = 'https://cdn.example.com/a.webp?w=256&h=256';

    expect(toStableAssetUrl(url)).toBe(url);
  });

  it('keeps stable and non-URL values unchanged', () => {
    expect(toStableAssetUrl('https://cdn.example.com/a.webp')).toBe(
      'https://cdn.example.com/a.webp',
    );
    expect(toStableAssetUrl('/webapi/user/avatar/u1/a.webp')).toBe('/webapi/user/avatar/u1/a.webp');
    expect(toStableAssetUrl('🐱')).toBe('🐱');
  });

  it('preserves null and undefined so response shapes stay the same', () => {
    expect(toStableAssetUrl(null)).toBeNull();
    expect(toStableAssetUrl(undefined)).toBeUndefined();
    expect(toStableAssetUrl('')).toBe('');
  });
});
