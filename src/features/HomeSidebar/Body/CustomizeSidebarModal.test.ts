import { describe, expect, it } from 'vitest';

import { SIDEBAR_SPACER_ID } from '@/store/global/selectors/systemStatus';

import { getAvailableSidebarItems, getSortableSidebarItemIds } from './CustomizeSidebarModal';

describe('CustomizeSidebarModal', () => {
  it('keeps admin entries out of personal customization', () => {
    const items = getAvailableSidebarItems(false);
    expect(items.some((item) => item.id === 'community')).toBe(false);
    expect(items.some((item) => item.id === 'pages')).toBe(false);

    expect(items.some((item) => item.id === 'memory')).toBe(false);
  });

  it('allows Projects to be reordered and hidden', () => {
    expect(getAvailableSidebarItems(false).some((item) => item.id === 'project')).toBe(true);
    expect(getSortableSidebarItemIds(false).has('project')).toBe(true);
  });

  it('removes Memory from workspace mode customization', () => {
    const items = getAvailableSidebarItems(true);

    expect(items.some((item) => item.id === 'memory')).toBe(false);
  });

  it('keeps the spacer in the sortable item set', () => {
    expect(getSortableSidebarItemIds(false).has(SIDEBAR_SPACER_ID)).toBe(true);
    expect(getSortableSidebarItemIds(true).has(SIDEBAR_SPACER_ID)).toBe(true);
  });

  it('keeps workspace-only exclusions in the sortable item set', () => {
    expect(getSortableSidebarItemIds(false).has('memory')).toBe(false);
    expect(getSortableSidebarItemIds(true).has('memory')).toBe(false);
  });
});
