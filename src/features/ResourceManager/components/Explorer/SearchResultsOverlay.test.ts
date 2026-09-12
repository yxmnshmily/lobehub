import { describe, expect, it } from 'vitest';

import { resolveSearchResultsViewMode } from './SearchResultsOverlay';

describe('resolveSearchResultsViewMode', () => {
  it('forces masonry on the mobile runtime when the persisted preference is list', () => {
    expect(resolveSearchResultsViewMode('list', true)).toBe('masonry');
  });

  it('preserves the persisted view on desktop', () => {
    expect(resolveSearchResultsViewMode('list', false)).toBe('list');
    expect(resolveSearchResultsViewMode('masonry', false)).toBe('masonry');
  });
});
