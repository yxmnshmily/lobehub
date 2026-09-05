import { describe, expect, it } from 'vitest';

import { resolveActionAccessibleLabel } from './actionAccessibility';

describe('resolveActionAccessibleLabel', () => {
  it('uses the visible action title when mobile tooltips are hidden', () => {
    expect(resolveActionAccessibleLabel(undefined, '联网搜索')).toBe('联网搜索');
  });

  it('preserves an explicit accessible name', () => {
    expect(resolveActionAccessibleLabel('自定义名称', '联网搜索')).toBe('自定义名称');
  });
});
