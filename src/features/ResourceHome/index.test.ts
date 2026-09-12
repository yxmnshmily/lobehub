import { describe, expect, it } from 'vitest';

import { FilesTabs } from '@/types/files';

import { CATEGORY_BY_SEGMENT, resolveResourcePathCategory, resourceCategoryPath } from './index';

it('maps old category entrances to the combined right-hand lists', () => {
  for (const category of [FilesTabs.Pages, FilesTabs.Documents])
    expect(resourceCategoryPath(category)).toBe('/resource/documents');
  for (const category of [FilesTabs.Audios, FilesTabs.Files, FilesTabs.Other])
    expect(resourceCategoryPath(category)).toBe('/resource/other');
  for (const segment of ['files', 'audios', 'works', 'other'])
    expect(CATEGORY_BY_SEGMENT[segment]).toBe(FilesTabs.Other);
});

describe('resolveResourcePathCategory', () => {
  it.each(['all', 'documents', 'images', 'videos', 'audios', 'files', 'page'])(
    'recovers the %s category for a static resource route',
    (category) => {
      expect(resolveResourcePathCategory(undefined, `/resource/${category}`)).toBe(category);
    },
  );

  it('preserves a dynamic category param when one exists', () => {
    expect(resolveResourcePathCategory('websites', '/resource/websites')).toBe('websites');
  });

  it('keeps the resource dashboard uncategorized', () => {
    expect(resolveResourcePathCategory(undefined, '/resource')).toBeUndefined();
  });
});
